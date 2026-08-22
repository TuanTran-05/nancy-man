/**
 * ⛔ KHÔNG CHẠY LẠI. Script này đã chạy một lần ngày 2026-08-10 và XÓA SAI:
 * 109 trong 112 sổ nó xóa thuộc về lớp học sinh vẫn đang học, kéo theo
 * 44.470.000 ₫ tiền thật của 32 em. Đã khôi phục bằng
 * `restore-purged-finance.ts`. File giữ lại làm bằng chứng kiểm toán, không
 * phải để dùng — phần thân đã bị chặn cứng ở dưới.
 *
 * Sai lầm gốc: nó phân loại "khóa cũ" bằng cách xem DOC ID của sổ có nằm trong
 * tập id mà planner sinh ra không. Nhưng doc id chứa termStart/termEnd, còn
 * danh tính thật của sổ là bộ ba (studentId, classId, termStart) trong TRƯỜNG
 * dữ liệu — xem `courseLedgerIdentity.ts`. Một lớp đang học mà ngày term từng
 * bị sửa sẽ mang doc id lạc hậu và bị gắn nhãn "khóa cũ" oan.
 *
 * ---- mô tả gốc, giữ nguyên ----
 * Xóa nốt tài chính của các khóa đã kết thúc (duyệt 2026-08-10, tiếp sau
 * `rebuild-open-course-ledgers.ts`).
 *
 * Xóa ledger cũ mà để receipt lại sẽ tạo tham chiếu treo và phá vỡ đối chiếu
 * tiền, nên phiếu thu và giao dịch ví của chúng bị xóa cùng một lượt. Ví được
 * giữ trung hòa bằng cách xóa cả `deposit` lẫn `allocation` của cùng một phiếu:
 * bỏ allocation mà giữ deposit sẽ biến tiền trung tâm đã thu thành số dư học
 * sinh có quyền đòi lại.
 *
 * Một ngoại lệ: phiếu vừa trả khóa cũ vừa trả khóa đang học không bị đụng tới,
 * và ledger cũ của phiếu đó được giữ lại — xóa nó sẽ hủy luôn tiền của khóa
 * hiện tại.
 *
 * Dry run mặc định. `--apply` mới ghi.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';

// Chặn trước khi mở kết nối DocumentStore: script này phân loại "khóa cũ" bằng doc
// id, và đã chứng minh là xóa nhầm tiền thật. Không có cờ nào bỏ qua được.
throw new Error(
  'purge-old-course-finance.ts đã bị vô hiệu hóa vĩnh viễn. Nó phân loại sổ ' +
    'bằng doc id nên đã xóa nhầm 109/112 sổ của lớp đang học (44.470.000 ₫, ' +
    'đã khôi phục ngày 2026-08-10). Danh tính sổ nằm ở bộ ba (studentId, ' +
    'classId, termStart) trong trường dữ liệu — dùng courseLedgerIdentity.ts.'
);

const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const manifestPath =
  process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1] ||
  `migration-manifest-purge-old-course-finance-${stamp}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db: DocumentStore = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  databaseId
);
const m = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const [ledgerSnap, receiptsSnap, walletSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('receipts').get(),
  db.collection('wallet_transactions').get(),
]);

/** The rebuild stamped what it created; anything unstamped is an old-course row. */
const OLD = new Set<string>();
const CURRENT = new Set<string>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  if (String(l.migrationRunId || '') === 'rebuild_open_course_ledgers') CURRENT.add(d.id);
  else OLD.add(d.id);
}

const allocIdsOf = (r: any): string[] => {
  const allocs = Array.isArray(r.allocations) ? r.allocations : [];
  const ids = allocs.map((a: any) => String(a.ledgerId || '')).filter(Boolean);
  if (!ids.length && r.ledgerId) ids.push(String(r.ledgerId));
  return ids;
};

// Classify receipts, and protect the ledgers a mixed receipt still needs.
const receiptsToDelete: any[] = [];
const protectedLedgers = new Set<string>();
const mixed: any[] = [];
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  const ids = allocIdsOf(r);
  const hitsOld = ids.filter((id) => OLD.has(id));
  if (!hitsOld.length) continue;
  if (ids.some((id) => CURRENT.has(id))) {
    mixed.push({ receiptNo: r.receiptNo, amountReceived: m(r.amountReceived) });
    for (const id of hitsOld) protectedLedgers.add(id);
    continue;
  }
  receiptsToDelete.push({ ref: d.ref, id: d.id, data: r });
}

const ledgersToDelete = ledgerSnap.docs.filter((d) => OLD.has(d.id) && !protectedLedgers.has(d.id));

// Wallet rows tied to the receipts being removed, both directions of the pair.
const deletedReceiptIds = new Set(receiptsToDelete.map((r) => r.id));
const deletedReceiptNos = new Set(receiptsToDelete.map((r) => String(r.data.receiptNo || '')));
const walletToDelete = walletSnap.docs.filter((d) => {
  const t = d.data() as any;
  if (t.receiptId && deletedReceiptIds.has(String(t.receiptId))) return true;
  if (t.receiptNo && deletedReceiptNos.has(String(t.receiptNo))) return true;
  return false;
});

let depositRemoved = 0;
let allocationRemoved = 0;
for (const d of walletToDelete) {
  const t = d.data() as any;
  if (/deposit/i.test(String(t.type))) depositRemoved += m(t.amount);
  else allocationRemoved += m(t.amount);
}

/** Wallet stays honest only if both legs of every pair leave together. */
const guards: string[] = [];
if (Math.abs(depositRemoved - allocationRemoved) > 1)
  guards.push(
    `ví lệch: xóa ${depositRemoved} deposit nhưng ${allocationRemoved} allocation — số dư học sinh sẽ đổi`
  );
const paidOnDeleted = ledgersToDelete.reduce((s, d) => s + m((d.data() as any).paidTotal), 0);
if (Math.abs(paidOnDeleted - allocationRemoved) > 1)
  guards.push(`tiền trên ledger xóa (${paidOnDeleted}) khác allocation xóa (${allocationRemoved})`);

const manifest: Record<string, unknown> = {
  migration: 'purge_old_course_finance',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  databaseId,
  guards,
  scope: {
    oldLedgersFound: OLD.size,
    ledgersToDelete: ledgersToDelete.length,
    ledgersProtectedByMixedReceipt: [...protectedLedgers],
    receiptsToDelete: receiptsToDelete.length,
    receiptMoneyRemoved: receiptsToDelete.reduce((s, r) => s + m(r.data.amountReceived), 0),
    walletRowsToDelete: walletToDelete.length,
    depositRemoved,
    allocationRemoved,
    mixedReceiptsLeftAlone: mixed,
    billedRemoved: ledgersToDelete.reduce((s, d) => s + m((d.data() as any).amount), 0),
    paidRemoved: paidOnDeleted,
  },
  untouched: ['students', 'classes', 'student_course_enrollments', 'course_closing_records'],
  deletedDocs: {
    course_fee_ledgers: ledgersToDelete.map((d) => ({ __id: d.id, ...(d.data() as any) })),
    receipts: receiptsToDelete.map((r) => ({ __id: r.id, ...r.data })),
    wallet_transactions: walletToDelete.map((d) => ({ __id: d.id, ...(d.data() as any) })),
  },
  deleted: { course_fee_ledgers: 0, receipts: 0, wallet_transactions: 0 },
  summariesRebuilt: 0,
  summariesFailed: [] as string[],
};

if (APPLY) {
  if (guards.length) throw new Error(`Dừng lại vì guard: ${guards.join(' | ')}`);
  // Only copy of these rows once they are gone: write it before deleting.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  let batch = db.batch();
  let writes = 0;
  const flush = async () => {
    if (writes) await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  const del = async (ref: any, bucket: 'course_fee_ledgers' | 'receipts' | 'wallet_transactions') => {
    batch.delete(ref);
    writes += 1;
    (manifest.deleted as any)[bucket] += 1;
    if (writes >= 400) await flush();
  };

  for (const d of ledgersToDelete) await del(d.ref, 'course_fee_ledgers');
  for (const r of receiptsToDelete) await del(r.ref, 'receipts');
  for (const d of walletToDelete) await del(d.ref, 'wallet_transactions');
  await flush();

  const { rebuildAccountingStudentSummary } = await import(
    '../server/api/lib/services/accountingStudentSummaryService.js'
  );
  const students = new Set(ledgersToDelete.map((d) => String((d.data() as any).studentId)));
  for (const studentId of students) {
    try {
      await rebuildAccountingStudentSummary(db, studentId);
      manifest.summariesRebuilt = (manifest.summariesRebuilt as number) + 1;
    } catch (error) {
      (manifest.summariesFailed as string[]).push(
        `${studentId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const [afterL, afterR, afterW] = await Promise.all([
    db.collection('course_fee_ledgers').get(),
    db.collection('receipts').get(),
    db.collection('wallet_transactions').get(),
  ]);
  let walletBalance = 0;
  for (const d of afterW.docs) {
    const t = d.data() as any;
    walletBalance += /deposit/i.test(String(t.type)) ? m(t.amount) : -m(t.amount);
  }
  manifest.after = {
    ledgers: afterL.size,
    billed: afterL.docs.reduce((s, d) => s + m((d.data() as any).amount), 0),
    paidTotal: afterL.docs.reduce((s, d) => s + m((d.data() as any).paidTotal), 0),
    receipts: afterR.size,
    receiptsPosted: afterR.docs
      .filter((d) => String((d.data() as any).status) === 'posted')
      .reduce((s, d) => s + m((d.data() as any).amountReceived), 0),
    walletBalance,
  };
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
const { deletedDocs, ...printable } = manifest as any;
console.log(JSON.stringify({ ...printable, manifestPath }, null, 2));
