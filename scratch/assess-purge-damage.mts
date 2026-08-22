/** READ-ONLY: đợt purge đã xóa nhầm bao nhiêu khoản của lớp học sinh VẪN đang học?
 *
 * Sổ nợ bị xóa được coi là "khóa cũ" chỉ vì id của nó không khớp id mà planner
 * sinh ra. Nhưng id gồm cả termStart/termEnd, nên một khóa đang học mà ngày
 * term bị sửa cũng sinh id khác — và bị xếp nhầm. Phân biệt bằng enrollment:
 * học sinh còn enrollment đang mở ở đúng lớp đó thì đấy là khóa đang học. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const manifest = JSON.parse(
  await readFile('migration-manifest-purge-old-course-finance-2026-08-10T13-45-24-362Z.json', 'utf8')
);
const deletedLedgers: any[] = manifest.deletedDocs.course_fee_ledgers;
const deletedReceipts: any[] = manifest.deletedDocs.receipts;
const deletedWallet: any[] = manifest.deletedDocs.wallet_transactions;

const [enrollSnap, ledgerSnap, studentsSnap, classesSnap] = await Promise.all([
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
  db.collection('students').get(),
  db.collection('classes').get(),
]);
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const className = (id: string) =>
  String((classesSnap.docs.find((d) => d.id === id)?.data() as any)?.name || id);

const OPEN = new Set(['active', 'trial', 'on_leave']);
const openPairs = new Set<string>();
for (const d of enrollSnap.docs) {
  const e = d.data() as any;
  if (OPEN.has(String(e.status))) openPairs.add(`${e.studentId}|${e.classId}`);
}
// ledger đang tồn tại cho từng cặp học sinh|lớp
const currentByPair = new Map<string, any>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  currentByPair.set(`${l.studentId}|${l.classId}`, { id: d.id, ...l });
}

const wrongly: any[] = [];
const legitimately: any[] = [];
for (const l of deletedLedgers) {
  const pair = `${l.studentId}|${l.classId}`;
  const row = {
    ledgerId: l.__id,
    student: studentById.get(String(l.studentId))?.name || '(không có hồ sơ)',
    studentId: l.studentId,
    class: className(String(l.classId)),
    termStart: l.termStart,
    termEnd: l.termEnd,
    amount: m(l.amount),
    paidTotal: m(l.paidTotal),
    replacementLedger: currentByPair.get(pair)?.id || null,
    replacementPaid: m(currentByPair.get(pair)?.paidTotal),
  };
  if (openPairs.has(pair)) wrongly.push(row);
  else legitimately.push(row);
}

const wronglyWithMoney = wrongly.filter((r) => r.paidTotal > 0);
const affectedStudents = new Set(wronglyWithMoney.map((r) => r.studentId));

// phiếu thu bị xóa mà thuộc về các sổ xóa nhầm
const wrongLedgerIds = new Set(wrongly.map((r) => r.ledgerId));
const receiptsToRestore = deletedReceipts.filter((r) =>
  (r.allocations || []).some((a: any) => wrongLedgerIds.has(String(a.ledgerId)))
);
const receiptNosToRestore = new Set(receiptsToRestore.map((r) => String(r.receiptNo)));
const walletToRestore = deletedWallet.filter((t) => receiptNosToRestore.has(String(t.receiptNo)));

console.log(JSON.stringify({
  deletedLedgersTotal: deletedLedgers.length,
  wronglyDeleted: wrongly.length,
  wronglyDeletedHoldingMoney: wronglyWithMoney.length,
  moneyWronglyErased: wronglyWithMoney.reduce((s, r) => s + r.paidTotal, 0),
  studentsAffected: affectedStudents.size,
  legitimatelyDeleted: legitimately.length,
  legitimateMoney: legitimately.reduce((s, r) => s + r.paidTotal, 0),
  receiptsToRestore: receiptsToRestore.length,
  receiptMoneyToRestore: receiptsToRestore.reduce((s, r) => s + m(r.amountReceived), 0),
  walletRowsToRestore: walletToRestore.length,
  detail: wronglyWithMoney.sort((a, b) => b.paidTotal - a.paidTotal),
}, null, 2));
