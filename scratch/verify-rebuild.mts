/** READ-ONLY xác minh sau khi chạy: tiền có còn khớp không, và 6 học sinh
 * dựng summary thất bại thì ledger của họ ra sao. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const FAILED = [
  'TATENjEGwtbCbLNz4anV',
  'b9C4QhZ1h7qQEFp8ChId',
  'ro186kHKX03bxIHGv7z9',
  '5g9pL8su6oTJPP8b9aPu',
  '42DjKQ0LRk4UQvmlC4rp',
  'YVfEWfDxz1QgHbkexGpH',
];

const [ledgerSnap, receiptsSnap, walletSnap, studentsSnap, summarySnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('receipts').get(),
  db.collection('wallet_transactions').get(),
  db.collection('students').get(),
  db.collection('accounting_student_summaries').get(),
]);

const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const summaryIds = new Set(summarySnap.docs.map((d) => d.id));

// money reconciliation, recomputed from scratch
const postedByLedger = new Map<string, number>();
let posted = 0;
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  if (String(r.status || '') !== 'posted') continue;
  posted += m(r.amountReceived);
  const allocs = Array.isArray(r.allocations) ? r.allocations : [];
  if (!allocs.length && r.ledgerId)
    postedByLedger.set(String(r.ledgerId), (postedByLedger.get(String(r.ledgerId)) || 0) + m(r.amountReceived));
  for (const a of allocs) {
    const id = String(a.ledgerId || '');
    if (!id) continue;
    postedByLedger.set(id, (postedByLedger.get(id) || 0) + m(a.amount));
  }
}

let billed = 0, paid = 0, mismatches = 0;
const mismatchDetail: any[] = [];
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  billed += m(l.amount);
  paid += m(l.paidTotal);
  const fromReceipts = postedByLedger.get(d.id) || 0;
  if (Math.abs(fromReceipts - m(l.paidTotal)) > 1) {
    mismatches += 1;
    if (mismatchDetail.length < 10)
      mismatchDetail.push({ ledgerId: d.id, ledgerPaid: m(l.paidTotal), receipts: fromReceipts });
  }
}

let walletBalance = 0;
for (const d of walletSnap.docs) {
  const t = d.data() as any;
  walletBalance += /deposit/i.test(String(t.type)) ? m(t.amount) : -m(t.amount);
}

const failedDetail = FAILED.map((sid) => {
  const ledgers = ledgerSnap.docs.filter((d) => String((d.data() as any).studentId) === sid);
  return {
    studentId: sid,
    name: studentById.get(sid)?.name || '(KHÔNG CÓ HỒ SƠ students)',
    studentDocExists: studentById.has(sid),
    hasSummary: summaryIds.has(sid),
    ledgers: ledgers.length,
    billed: ledgers.reduce((s, d) => s + m((d.data() as any).amount), 0),
    paid: ledgers.reduce((s, d) => s + m((d.data() as any).paidTotal), 0),
  };
});

console.log(JSON.stringify({
  ledgers: ledgerSnap.size,
  billed,
  paidOnLedgers: paid,
  receiptsPosted: posted,
  allocatedToLedgers: [...postedByLedger.values()].reduce((s, v) => s + v, 0),
  walletBalanceOutstanding: walletBalance,
  moneyCheck: posted - paid - walletBalance,
  ledgerVsReceiptMismatches: mismatches,
  mismatchDetail,
  summariesTotal: summarySnap.size,
  failedStudents: failedDetail,
}, null, 2));
