/** READ-ONLY: nếu xóa nốt 113 ledger khóa cũ thì kéo theo những gì?
 *
 * Nguy hiểm nhất là receipt "hỗn hợp": một phiếu thu vừa gán tiền cho khóa cũ
 * vừa gán cho khóa đang học. Xóa nguyên phiếu đó sẽ cuốn theo tiền của khóa
 * hiện tại; giữ nguyên nó lại để tham chiếu treo. Đếm chính xác trước đã. */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const [ledgerSnap, receiptsSnap, walletSnap, studentsSnap, classesSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('receipts').get(),
  db.collection('wallet_transactions').get(),
  db.collection('students').get(),
  db.collection('classes').get(),
]);

const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const classNameById = new Map(classesSnap.docs.map((d) => [d.id, String((d.data() as any)?.name || '')]));

// The rebuild stamped every ledger it created, so anything without the stamp is
// a survivor of the old world — exactly the 113 in question.
const OLD = new Set<string>();
const CURRENT = new Set<string>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  if (String(l.migrationRunId || '') === 'rebuild_open_course_ledgers') CURRENT.add(d.id);
  else OLD.add(d.id);
}

const oldLedgers = ledgerSnap.docs.filter((d) => OLD.has(d.id)).map((d) => ({ id: d.id, ...(d.data() as any) }));
const oldBilled = oldLedgers.reduce((s, l) => s + m(l.amount), 0);
const oldPaid = oldLedgers.reduce((s, l) => s + m(l.paidTotal), 0);
const oldDebt = oldLedgers.reduce((s, l) => s + Math.max(0, m(l.amount) - m(l.discountTotal) - m(l.paidTotal)), 0);

// ---- receipts touching old ledgers, and whether they are mixed ----
let pureOldReceipts = 0, pureOldAmount = 0;
const mixedReceipts: any[] = [];
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  if (String(r.status || '') !== 'posted') continue;
  const allocs = Array.isArray(r.allocations) ? r.allocations : [];
  const ids = allocs.map((a: any) => String(a.ledgerId || '')).filter(Boolean);
  if (r.ledgerId && !ids.length) ids.push(String(r.ledgerId));
  const hitsOld = ids.filter((id) => OLD.has(id));
  const hitsCurrent = ids.filter((id) => CURRENT.has(id));
  if (!hitsOld.length) continue;

  const oldMoney = allocs
    .filter((a: any) => OLD.has(String(a.ledgerId || '')))
    .reduce((s: number, a: any) => s + m(a.amount), 0);

  if (hitsCurrent.length) {
    mixedReceipts.push({
      receiptNo: r.receiptNo,
      studentName: studentById.get(String(r.studentId))?.name || '(không có hồ sơ)',
      amountReceived: m(r.amountReceived),
      toOldCourse: oldMoney,
      toCurrentCourse: allocs
        .filter((a: any) => CURRENT.has(String(a.ledgerId || '')))
        .reduce((s: number, a: any) => s + m(a.amount), 0),
    });
  } else {
    pureOldReceipts += 1;
    pureOldAmount += m(r.amountReceived);
  }
}

// ---- wallet transactions referencing old ledgers ----
let walletAllocOld = 0, walletAllocOldCount = 0;
for (const d of walletSnap.docs) {
  const t = d.data() as any;
  if (!t.ledgerId || !OLD.has(String(t.ledgerId))) continue;
  walletAllocOldCount += 1;
  walletAllocOld += m(t.amount);
}

// ---- who loses a paid record ----
const affected = new Map<string, { name: string; paid: number; ledgers: number }>();
for (const l of oldLedgers) {
  if (m(l.paidTotal) <= 0) continue;
  const sid = String(l.studentId);
  const cur = affected.get(sid) || { name: studentById.get(sid)?.name || '(không có hồ sơ)', paid: 0, ledgers: 0 };
  cur.paid += m(l.paidTotal);
  cur.ledgers += 1;
  affected.set(sid, cur);
}

const out = {
  oldLedgers: oldLedgers.length,
  oldBilled,
  oldPaid,
  oldDebtThatWouldDisappear: oldDebt,
  receipts: {
    pureOldReceipts,
    pureOldAmount,
    mixedReceiptCount: mixedReceipts.length,
    mixedReceipts,
  },
  walletAllocationsReferencingOld: walletAllocOldCount,
  walletAllocationAmount: walletAllocOld,
  studentsLosingAPaidRecord: affected.size,
  affectedDetail: [...affected.entries()]
    .map(([studentId, v]) => ({ studentId, ...v }))
    .sort((a, b) => b.paid - a.paid),
  oldLedgerDetail: oldLedgers.map((l) => ({
    ledgerId: l.id,
    student: studentById.get(String(l.studentId))?.name || '(không có hồ sơ)',
    className: classNameById.get(String(l.classId)) || String(l.classId),
    termStart: l.termStart,
    termEnd: l.termEnd,
    amount: m(l.amount),
    paidTotal: m(l.paidTotal),
    status: l.status,
  })),
};
await writeFile('scratch/old-course-purge-analysis.json', JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ ...out, affectedDetail: `${affected.size} em`, oldLedgerDetail: `${oldLedgers.length} dòng -> scratch/old-course-purge-analysis.json` }, null, 2));
