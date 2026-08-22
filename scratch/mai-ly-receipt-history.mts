/** READ-ONLY: Mai Ly có bao nhiêu phiếu thu ở trạng thái GỐC (trước mọi thao
 * tác hôm nay), và có phiếu nào của em nằm trong số đã bị xóa không? */
import { readFile, readdir } from 'node:fs/promises';

const SID = 'b9C4QhZ1h7qQEFp8ChId';
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

// 1. trạng thái gốc, chụp trước khi bắt đầu
const original = JSON.parse(
  await readFile('backups/finance-rebuild-2026-08-10T13-20-31-397Z/receipts.json', 'utf8')
) as any[];
const hers = original.filter((r) => String(r.studentId) === SID);

// 2. mọi document đã bị xóa trong các manifest hôm nay
const files = (await readdir('.')).filter(
  (f) => f.startsWith('migration-manifest-') && f.includes('2026-08-10')
);
const deletedHers: any[] = [];
for (const f of files) {
  const man = JSON.parse(await readFile(f, 'utf8'));
  const buckets = man.deletedDocs;
  if (!buckets) continue;
  const lists = Array.isArray(buckets) ? { generic: buckets } : buckets;
  for (const [name, rows] of Object.entries(lists as Record<string, any[]>)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (String(row.studentId || '') === SID)
        deletedHers.push({ manifest: f, collection: name, id: row.__id, receiptNo: row.receiptNo, type: row.type, amount: m(row.amountReceived) || m(row.amount) });
    }
  }
}

console.log(JSON.stringify({
  originalReceiptCount: hers.length,
  originalReceipts: hers.map((r) => ({
    receiptNo: r.receiptNo, status: r.status, amountReceived: m(r.amountReceived),
    createdAt: r.createdAt,
    allocations: (r.allocations || []).map((a: any) => ({ ledgerId: a.ledgerId, amount: m(a.amount) })),
  })),
  originalPaidTotal: hers.filter((r) => r.status === 'posted').reduce((s, r) => s + m(r.amountReceived), 0),
  manifestsScanned: files,
  herDocsDeletedToday: deletedHers,
}, null, 2));
