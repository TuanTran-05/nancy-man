/**
 * Gán nốt 200.000 ₫ số dư ví của NGUYỄN LƯƠNG MAI LY vào sổ nợ lớp Advanced 6.
 *
 * Em nộp 1.400.000 ₫ bằng phiếu PT-260808-133 nhưng lúc đó sổ mới ghi nhận
 * 1.200.000, phần dư nằm lại trong ví. Học phí lớp hiện là 1.400.000 nên khoản
 * dư này thuộc về chính sổ đó.
 *
 * Ba nơi phải đổi cùng lúc, lệch một chỗ là đối chiếu vỡ:
 *   - wallet_transactions: thêm một dòng allocation 200.000
 *   - receipts: thêm allocation tương ứng, để tổng allocation khớp số đã thu
 *   - course_fee_ledgers: paidTotal 1.200.000 -> 1.400.000, status -> paid
 *
 * Chạy trong transaction. Dry run mặc định, `--apply` mới ghi.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const manifestPath = `migration-manifest-allocate-mai-ly-remainder-${stamp}.json`;

const STUDENT = 'b9C4QhZ1h7qQEFp8ChId';
const RECEIPT = 'gqYhopq73bbhPQY9tPYF';
const RECEIPT_NO = 'PT-260808-133';
const LEDGER = 'b9C4QhZ1h7qQEFp8ChId_187uCU8mzdnrWpziZrDe_2026-07-08_2026-08-28';
const CLASS = '187uCU8mzdnrWpziZrDe';
const AMOUNT = 200000;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const [ledgerDoc, receiptDoc, walletSnap] = await Promise.all([
  db.collection('course_fee_ledgers').doc(LEDGER).get(),
  db.collection('receipts').doc(RECEIPT).get(),
  db.collection('wallet_transactions').where('studentId', '==', STUDENT).get(),
]);

const guards: string[] = [];
if (!ledgerDoc.exists) guards.push('không tìm thấy sổ nợ Advanced 6');
if (!receiptDoc.exists) guards.push('không tìm thấy phiếu thu PT-260808-133');

const ledger = ledgerDoc.data() as any;
const receipt = receiptDoc.data() as any;
let walletBalance = 0;
for (const d of walletSnap.docs) {
  const t = d.data() as any;
  walletBalance += /deposit/i.test(String(t.type)) ? m(t.amount) : -m(t.amount);
}
if (walletBalance !== AMOUNT) guards.push(`số dư ví là ${walletBalance}, không phải ${AMOUNT}`);
const remaining = m(ledger?.amount) - m(ledger?.discountTotal) - m(ledger?.paidTotal);
if (remaining !== AMOUNT) guards.push(`sổ còn thiếu ${remaining}, không phải ${AMOUNT}`);
if (String(receipt?.status) !== 'posted') guards.push('phiếu thu không ở trạng thái posted');
const allocSum = (receipt?.allocations || []).reduce((s: number, a: any) => s + m(a.amount), 0);
if (m(receipt?.amountReceived) - allocSum !== AMOUNT)
  guards.push(`phiếu thu còn dư ${m(receipt?.amountReceived) - allocSum}, không phải ${AMOUNT}`);

const now = new Date().toISOString();
const manifest: Record<string, unknown> = {
  migration: 'allocate_mai_ly_wallet_remainder',
  generatedAt: now,
  mode: APPLY ? 'apply' : 'dry-run',
  databaseId,
  guards,
  before: {
    ledgerPaidTotal: m(ledger?.paidTotal),
    ledgerAmount: m(ledger?.amount),
    ledgerStatus: ledger?.status,
    walletBalance,
    receiptAllocations: receipt?.allocations || [],
  },
  planned: {
    newWalletAllocation: AMOUNT,
    ledgerPaidTotalAfter: m(ledger?.paidTotal) + AMOUNT,
    ledgerStatusAfter: 'paid',
    walletBalanceAfter: 0,
  },
  applied: false,
};

if (APPLY) {
  if (guards.length) throw new Error(`Dừng lại vì guard: ${guards.join(' | ')}`);
  await db.runTransaction(async (tx) => {
    const allocRef = db.collection('wallet_transactions').doc();
    tx.create(allocRef, {
      schemaVersion: 2,
      transactionGroupId: `receipt:${RECEIPT}`,
      groupSequence: 2,
      source: 'manual_receipt',
      studentId: STUDENT,
      type: 'allocation',
      amount: AMOUNT,
      status: 'posted',
      receiptId: RECEIPT,
      receiptNo: RECEIPT_NO,
      ledgerId: LEDGER,
      classId: CLASS,
      note: 'Gán nốt số dư ví còn lại của phiếu PT-260808-133 vào học phí Advanced 6',
      createdBy: 'migration:allocate_mai_ly_wallet_remainder',
      createdByRole: 'accounting',
      createdByName: 'migration',
      createdAt: now,
      postedAt: now,
    });
    tx.update(db.collection('receipts').doc(RECEIPT), {
      allocations: [
        ...(receipt.allocations || []),
        { ledgerId: LEDGER, classId: CLASS, amount: AMOUNT },
      ],
      updatedAt: now,
    });
    tx.update(db.collection('course_fee_ledgers').doc(LEDGER), {
      paidTotal: m(ledger.paidTotal) + AMOUNT,
      status: 'paid',
      updatedAt: now,
    });
  });
  manifest.applied = true;

  const { rebuildAccountingStudentSummary } = await import(
    '../server/api/lib/services/accountingStudentSummaryService.js'
  );
  const summary = await rebuildAccountingStudentSummary(db, STUDENT);
  manifest.badgeAfter = (summary as any)?.currentCoursePaymentStatus ?? null;

  const after = await db.collection('course_fee_ledgers').where('studentId', '==', STUDENT).get();
  manifest.after = {
    ledgers: after.docs.map((d) => {
      const l = d.data() as any;
      return { class: l.classId, amount: m(l.amount), paidTotal: m(l.paidTotal), status: l.status };
    }),
  };
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
