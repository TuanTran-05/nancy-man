/**
 * READ-ONLY audit + full backup, phase 1 of the finance delete-and-recreate.
 *
 * Answers the only question that matters before a wipe: if every ledger,
 * receipt and wallet transaction disappeared right now, could the money be put
 * back exactly? It writes a verbatim copy of every finance document to disk,
 * then reconciles what was billed against what was collected and lists the
 * students whose paid money would have to survive the rebuild.
 *
 * Writes NOTHING to DocumentStore. The only side effect is files on local disk.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type QuerySnapshot } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  databaseId
);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = `backups/finance-rebuild-${stamp}`;
await mkdir(outDir, { recursive: true });

const money = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
/** Net billable after discounts, matching ledgerRemaining() in the app. */
const net = (l: any) => Math.max(0, money(l.amount) - money(l.discountTotal));
const remaining = (l: any) => Math.max(0, net(l) - money(l.paidTotal));

/**
 * Collections that carry money or are needed to rebuild it. The first three are
 * the wipe targets; the rest are read to prove the rebuild is possible.
 */
const WIPE_TARGETS = ['course_fee_ledgers', 'receipts', 'wallet_transactions'];
const REGENERATED = ['accounting_student_summaries'];
const CONTEXT = [
  'students',
  'classes',
  'student_course_enrollments',
  'invoices',
  'payment_requests',
];

const names = [...WIPE_TARGETS, ...REGENERATED, ...CONTEXT];
const snaps: Record<string, QuerySnapshot> = {};
for (const name of names) {
  process.stdout.write(`reading ${name}... `);
  snaps[name] = await db.collection(name).get();
  console.log(String(snaps[name].size));
}

// ---------------------------------------------------------------- backup
// Verbatim, one file per collection, before any analysis can lose detail.
const counts: Record<string, number> = {};
for (const name of names) {
  const rows = snaps[name].docs.map((d) => ({ __id: d.id, ...(d.data() || {}) }));
  counts[name] = rows.length;
  await writeFile(
    `${outDir}/${name}.json`,
    JSON.stringify(rows, null, 2),
    'utf8'
  );
}

// ---------------------------------------------------------------- indexes
const students = snaps.students.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
const studentById = new Map(students.map((s) => [s.id, s]));
const classNameById = new Map(
  snaps.classes.docs.map((d) => [d.id, String((d.data() as any)?.name || '')])
);

const ledgers = snaps.course_fee_ledgers.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
const ledgerById = new Map(ledgers.map((l) => [l.id, l]));
const receipts = snaps.receipts.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
const walletTx = snaps.wallet_transactions.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

const enrollByStudent = new Map<string, any[]>();
for (const d of snaps.student_course_enrollments.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const k = String(e.studentId || '');
  if (!enrollByStudent.has(k)) enrollByStudent.set(k, []);
  enrollByStudent.get(k)!.push(e);
}

// --------------------------------------------------- duplicate student codes
// A code owned by two ids means this student's money is split in two places;
// a rebuild keyed on one id silently drops the other half.
const idsByCode = new Map<string, string[]>();
for (const s of students) {
  const code = String(s.studentId || s.code || '').trim().toUpperCase();
  if (!code) continue;
  if (!idsByCode.has(code)) idsByCode.set(code, []);
  idsByCode.get(code)!.push(s.id);
}
const duplicateCodes = [...idsByCode.entries()]
  .filter(([, ids]) => ids.length > 1)
  .map(([code, ids]) => ({ code, ids }));

// ------------------------------------------------------- money actually paid
// Posted receipts are the record of collection. Allocations attribute money to
// a ledger; a receipt with none is money we can see but cannot re-attribute.
const postedByLedger = new Map<string, number>();
const paidByStudent = new Map<string, number>();
let postedTotal = 0;
let voidedTotal = 0;
let draftTotal = 0;
const unallocatedReceipts: any[] = [];
const receiptsPointingAtMissingLedger: any[] = [];

for (const r of receipts) {
  const status = String(r.status || '');
  const amt = money(r.amountReceived);
  if (status === 'void') {
    voidedTotal += amt;
    continue;
  }
  if (status === 'draft') {
    draftTotal += amt;
    continue;
  }
  if (status !== 'posted') continue;
  postedTotal += amt;

  const sid = String(r.studentId || '');
  paidByStudent.set(sid, (paidByStudent.get(sid) || 0) + amt);

  const allocs = Array.isArray(r.allocations) ? r.allocations : [];
  if (!allocs.length) {
    if (r.ledgerId) {
      const id = String(r.ledgerId);
      postedByLedger.set(id, (postedByLedger.get(id) || 0) + amt);
      if (!ledgerById.has(id))
        receiptsPointingAtMissingLedger.push({ receiptId: r.id, receiptNo: r.receiptNo, ledgerId: id, amount: amt });
    } else if (!r.walletDeposit) {
      unallocatedReceipts.push({
        receiptId: r.id,
        receiptNo: r.receiptNo,
        studentId: sid,
        studentName: studentById.get(sid)?.name || '(unknown)',
        amount: amt,
      });
    }
    continue;
  }
  for (const a of allocs) {
    const id = String(a.ledgerId || '');
    if (!id) continue;
    postedByLedger.set(id, (postedByLedger.get(id) || 0) + money(a.amount));
    if (!ledgerById.has(id))
      receiptsPointingAtMissingLedger.push({ receiptId: r.id, receiptNo: r.receiptNo, ledgerId: id, amount: money(a.amount) });
  }
}

// ------------------------------------------------------------ ledger health
let billedTotal = 0;
let discountTotal = 0;
let paidTotalOnLedgers = 0;
let debtTotal = 0;
const paidMismatch: any[] = [];
const orphanLedgers: any[] = [];

for (const l of ledgers) {
  billedTotal += money(l.amount);
  discountTotal += money(l.discountTotal);
  paidTotalOnLedgers += money(l.paidTotal);
  debtTotal += remaining(l);

  const fromReceipts = postedByLedger.get(l.id) || 0;
  const diff = money(l.paidTotal) - fromReceipts;
  if (Math.abs(diff) > 1) {
    paidMismatch.push({
      ledgerId: l.id,
      studentId: l.studentId,
      studentName: studentById.get(String(l.studentId))?.name || '(unknown)',
      className: classNameById.get(String(l.classId)) || String(l.classId || ''),
      ledgerPaidTotal: money(l.paidTotal),
      sumPostedReceipts: fromReceipts,
      diff,
    });
  }

  const enrolledClassIds = new Set(
    (enrollByStudent.get(String(l.studentId)) || []).map((e) => String(e.classId || ''))
  );
  if (l.classId && !enrolledClassIds.has(String(l.classId))) {
    orphanLedgers.push({
      ledgerId: l.id,
      studentId: l.studentId,
      studentName: studentById.get(String(l.studentId))?.name || '(unknown)',
      classId: l.classId,
      className: classNameById.get(String(l.classId)) || '',
      paidTotal: money(l.paidTotal),
      remaining: remaining(l),
    });
  }
}

// ------------------------------------------------------------------- wallet
let walletCredit = 0;
let walletDebit = 0;
for (const t of walletTx) {
  const amt = money(t.amount);
  if (amt >= 0) walletCredit += amt;
  else walletDebit += Math.abs(amt);
}

// ------------------------------------------- students whose money must survive
const paidStudents = [...paidByStudent.entries()]
  .filter(([, amt]) => amt > 0)
  .map(([sid, amt]) => {
    const s = studentById.get(sid);
    const code = String(s?.studentId || s?.code || '');
    return {
      studentId: sid,
      studentCode: code,
      studentName: String(s?.name || '(STUDENT DOC MISSING)'),
      studentDocExists: Boolean(s),
      codeIsDuplicated: idsByCode.get(code.trim().toUpperCase())?.length! > 1 || false,
      paidTotal: amt,
    };
  })
  .sort((a, b) => b.paidTotal - a.paidTotal);

const paidButNoStudentDoc = paidStudents.filter((p) => !p.studentDocExists);
const paidWithDuplicateCode = paidStudents.filter((p) => p.codeIsDuplicated);

// --------------------------------------------------------------- the report
const report = {
  generatedAt: new Date().toISOString(),
  databaseId,
  projectId: sa.project_id,
  mode: 'READ-ONLY audit — nothing was written to DocumentStore',
  backupDir: outDir,
  counts,
  money: {
    billedTotal,
    discountTotal,
    paidTotalOnLedgers,
    debtTotal,
    receiptsPostedTotal: postedTotal,
    receiptsDraftTotal: draftTotal,
    receiptsVoidTotal: voidedTotal,
    walletCredit,
    walletDebit,
    ledgerPaidVsReceiptsDiff: paidTotalOnLedgers - postedTotal,
  },
  rebuildRisk: {
    studentsWithPaidMoney: paidStudents.length,
    paidButStudentDocMissing: paidButNoStudentDoc.length,
    paidWithDuplicatedCode: paidWithDuplicateCode.length,
    duplicateStudentCodes: duplicateCodes.length,
    unallocatedPostedReceipts: unallocatedReceipts.length,
    unallocatedPostedReceiptsAmount: unallocatedReceipts.reduce((s, r) => s + r.amount, 0),
    receiptsPointingAtMissingLedger: receiptsPointingAtMissingLedger.length,
    ledgerPaidMismatchCount: paidMismatch.length,
    orphanLedgers: orphanLedgers.length,
    orphanLedgerPaidMoney: orphanLedgers.reduce((s, l) => s + l.paidTotal, 0),
    invoicesPresent: counts.invoices,
    paymentRequestsPresent: counts.payment_requests,
  },
  duplicateCodes,
  paidButNoStudentDoc,
  paidWithDuplicateCode,
  unallocatedReceipts: unallocatedReceipts.slice(0, 50),
  receiptsPointingAtMissingLedger: receiptsPointingAtMissingLedger.slice(0, 50),
  paidMismatchSamples: paidMismatch.slice(0, 50),
  orphanLedgerSamples: orphanLedgers.slice(0, 50),
};

await writeFile(`${outDir}/AUDIT-REPORT.json`, JSON.stringify(report, null, 2), 'utf8');
await writeFile(`${outDir}/paid-students.json`, JSON.stringify(paidStudents, null, 2), 'utf8');

console.log('\n' + JSON.stringify({
  backupDir: outDir,
  counts,
  money: report.money,
  rebuildRisk: report.rebuildRisk,
}, null, 2));
