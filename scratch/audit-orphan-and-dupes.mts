/** READ-ONLY follow-up: are the 44 flagged students real debtors, and are the 11 duplicate ledger groups double-counting? */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);
const money = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const remaining = (l: any) =>
  Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));

const [studentsSnap, enrollSnap, ledgerSnap, classesSnap, receiptsSnap, walletSnap] =
  await Promise.all([
    db.collection('students').get(),
    db.collection('student_course_enrollments').get(),
    db.collection('course_fee_ledgers').get(),
    db.collection('classes').get(),
    db.collection('receipts').get(),
    db.collection('wallet_transactions').get(),
  ]);

const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const enrollByStudent = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const k = String(e.studentId || '');
  if (!enrollByStudent.has(k)) enrollByStudent.set(k, []);
  enrollByStudent.get(k)!.push(e);
}

// ---- overall money picture ----
let totalBilled = 0;
let totalPaid = 0;
let totalDiscount = 0;
let totalRemaining = 0;
const byStatus = new Map<string, number>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  totalBilled += money(l.amount);
  totalPaid += money(l.paidTotal);
  totalDiscount += money(l.discountTotal);
  totalRemaining += remaining(l);
  const s = String(l.status || '(none)');
  byStatus.set(s, (byStatus.get(s) || 0) + 1);
}

// ---- orphan ledgers: ledger.classId has no enrollment row for that student ----
const orphans: any[] = [];
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ...(d.data() as any) };
  const sid = String(l.studentId || '');
  const enrolls = enrollByStudent.get(sid) || [];
  if (enrolls.some((e) => String(e.classId || '') === String(l.classId || ''))) continue;
  const student = studentById.get(sid);
  const cls = classById.get(String(l.classId || ''));
  orphans.push({
    ledgerId: l.id,
    studentId: sid,
    studentExists: Boolean(student),
    studentName: String(student?.name || '(missing student doc)'),
    studentCode: String(student?.studentId || student?.code || ''),
    studentLifecycle: String(student?.studentLifecycle || ''),
    studentCurrentClassId: String(student?.classId || ''),
    studentIsInThisClass: String(student?.classId || '') === String(l.classId || ''),
    ledgerClassId: String(l.classId || ''),
    className: String(cls?.name || '(missing class)'),
    classStatus: String(cls?.status || ''),
    termStart: String(l.termStart || ''),
    termEnd: String(l.termEnd || ''),
    amount: money(l.amount),
    paidTotal: money(l.paidTotal),
    remaining: remaining(l),
    status: String(l.status || ''),
    source: String(l.source || ''),
    createdAt: String(l.createdAt || ''),
    enrollmentCount: enrolls.length,
    enrollmentClassIds: enrolls.map((e) => String(e.classId || '')),
  });
}

// ---- duplicate ledgers ----
const tuple = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ...(d.data() as any) };
  const k = `${l.studentId}|${l.classId}|${l.termStart || ''}`;
  if (!tuple.has(k)) tuple.set(k, []);
  tuple.get(k)!.push(l);
}
const dupes = [...tuple.entries()]
  .filter(([, g]) => g.length > 1)
  .map(([k, g]) => {
    const sid = k.split('|')[0];
    return {
      key: k,
      studentName: String(studentById.get(sid)?.name || ''),
      className: String(classById.get(k.split('|')[1])?.name || ''),
      ledgers: g.map((l) => ({
        id: l.id,
        amount: money(l.amount),
        paidTotal: money(l.paidTotal),
        remaining: remaining(l),
        status: String(l.status || ''),
        source: String(l.source || ''),
        createdAt: String(l.createdAt || ''),
        migrationRunId: String(l.migrationRunId || ''),
      })),
      duplicatedDebt: g.slice(1).reduce((s, l) => s + remaining(l), 0),
    };
  });

// ---- receipts / wallet reality check ----
const receiptRows = receiptsSnap.docs.map((d) => {
  const r = d.data() as any;
  return {
    id: d.id,
    receiptNo: r.receiptNo,
    studentId: r.studentId,
    studentName: String(studentById.get(String(r.studentId))?.name || ''),
    status: r.status,
    amountReceived: money(r.amountReceived),
    allocations: (r.allocations || []).length,
    walletDeposit: Boolean(r.walletDeposit),
    receivedDate: r.receivedDate,
  };
});
const walletByStatus = new Map<string, number>();
for (const d of walletSnap.docs) {
  const w = d.data() as any;
  const k = `${w.type}/${w.status}`;
  walletByStatus.set(k, (walletByStatus.get(k) || 0) + 1);
}
let walletBalanceTotal = 0;
let studentsWithWallet = 0;
for (const d of studentsSnap.docs) {
  const b = money((d.data() as any).walletBalance);
  if (b !== 0) {
    walletBalanceTotal += b;
    studentsWithWallet += 1;
  }
}

const orphanByClass = new Map<string, { count: number; debt: number }>();
for (const o of orphans) {
  const cur = orphanByClass.get(o.className) || { count: 0, debt: 0 };
  cur.count += 1;
  cur.debt += o.remaining;
  orphanByClass.set(o.className, cur);
}

const report = {
  generatedAt: new Date().toISOString(),
  ledgerTotals: {
    ledgerCount: ledgerSnap.size,
    totalBilled,
    totalPaid,
    totalDiscount,
    totalRemaining,
    byStatus: Object.fromEntries(byStatus),
  },
  receipts: { count: receiptsSnap.size, rows: receiptRows },
  wallet: {
    transactionCount: walletSnap.size,
    byTypeStatus: Object.fromEntries(walletByStatus),
    studentsWithNonZeroBalance: studentsWithWallet,
    walletBalanceTotal,
  },
  orphanLedgers: {
    count: orphans.length,
    totalRemaining: orphans.reduce((s, o) => s + o.remaining, 0),
    stillInThatClass: orphans.filter((o) => o.studentIsInThisClass).length,
    byClass: Object.fromEntries([...orphanByClass].sort((a, b) => b[1].debt - a[1].debt)),
    rows: orphans,
  },
  duplicateLedgers: {
    groupCount: dupes.length,
    duplicatedDebtTotal: dupes.reduce((s, g) => s + g.duplicatedDebt, 0),
    groups: dupes,
  },
};

const out = process.argv[2] || 'orphan-dupes-report.json';
await writeFile(out, JSON.stringify(report, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      ledgerTotals: report.ledgerTotals,
      receipts: { count: report.receipts.count },
      wallet: report.wallet,
      orphanLedgers: {
        count: report.orphanLedgers.count,
        totalRemaining: report.orphanLedgers.totalRemaining,
        stillInThatClass: report.orphanLedgers.stillInThatClass,
        byClass: report.orphanLedgers.byClass,
      },
      duplicateLedgers: {
        groupCount: report.duplicateLedgers.groupCount,
        duplicatedDebtTotal: report.duplicateLedgers.duplicatedDebtTotal,
      },
      out,
    },
    null,
    2
  )
);
