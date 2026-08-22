/**
 * READ-ONLY. Nếu muốn "đồng bộ doc id với trường term", phải đổi tên 43 document.
 * DocumentStore không đổi tên được — phải tạo doc mới + xóa doc cũ + viết lại MỌI
 * tham chiếu. Câu hỏi: có bao nhiêu tham chiếu, và có bao nhiêu trong đó là tiền?
 */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  databaseId
);

const ledgerSnap = await db.collection('course_fee_ledgers').get();
const drifted = new Set<string>();
let driftedPaid = 0;
for (const d of ledgerSnap.docs) {
  const row = d.data() || {};
  const prefix = `${String(row.studentId || '')}_${String(row.classId || '')}_`;
  if (!d.id.startsWith(prefix)) continue;
  const rest = d.id.slice(prefix.length);
  const cut = rest.indexOf('_');
  const idStart = cut < 0 ? rest : rest.slice(0, cut);
  if (idStart !== String(row.termStart || '')) {
    drifted.add(d.id);
    driftedPaid += Number(row.paidTotal || 0);
  }
}

const [receiptSnap, wtxSnap] = await Promise.all([
  db.collection('receipts').get(),
  db.collection('wallet_transactions').get(),
]);

// Gom mọi chuỗi trong document mà bằng đúng một ledger id đang lệch.
const hits = { receipts: 0, receiptAmount: 0, walletTx: 0, walletAmount: 0 };
const deep = (value: unknown): string[] => {
  if (typeof value === 'string') return drifted.has(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(deep);
  if (value && typeof value === 'object') return Object.values(value).flatMap(deep);
  return [];
};

for (const d of receiptSnap.docs) {
  const found = deep(d.data());
  if (found.length) {
    hits.receipts += 1;
    hits.receiptAmount += Number(d.data()?.amount || 0);
  }
}
for (const d of wtxSnap.docs) {
  const found = deep(d.data());
  if (found.length) {
    hits.walletTx += 1;
    hits.walletAmount += Number(d.data()?.amount || 0);
  }
}

console.log(
  JSON.stringify(
    {
      soLedgerLechId: drifted.size,
      tienDangNamTrenCacLedgerDo: driftedPaid,
      thamChieuPhaiVietLaiNeuDoiId: {
        receipts: hits.receipts,
        tienTrongCacReceiptDo: hits.receiptAmount,
        walletTransactions: hits.walletTx,
        tienTrongCacGiaoDichVoDo: hits.walletAmount,
      },
    },
    null,
    2
  )
);
