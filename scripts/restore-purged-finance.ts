/**
 * Hoàn tác đợt `purge_old_course_finance` — nó đã xếp nhầm sổ nợ của khóa ĐANG
 * học vào nhóm "khóa cũ".
 *
 * Sai lầm gốc: sổ nợ được coi là cũ khi id của nó không nằm trong tập planner
 * sinh ra. Nhưng id chứa termStart/termEnd, nên một lớp đang học mà ngày term
 * bị sửa cũng sinh ra id khác — sổ đã đóng tiền thành "mồ côi" và bị xóa cùng
 * phiếu thu. 109/112 sổ bị xóa thuộc diện này.
 *
 * Khôi phục nguyên văn từ manifest, kể cả Timestamp. Ghi bằng `create` để
 * không đè lên bất cứ document nào đã tồn tại lại.
 *
 * Dry run mặc định. `--apply` mới ghi.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, Timestamp } from '@/server/db/documentStore.js';

const APPLY = process.argv.includes('--apply');
const source =
  process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1] ||
  'migration-manifest-purge-old-course-finance-2026-08-10T13-45-24-362Z.json';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = `migration-manifest-restore-purged-finance-${stamp}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

/** DocumentStore Timestamps survive JSON as {_seconds,_nanoseconds}; put them back
 * so the restored row is byte-for-byte what production held. */
const revive = (value: any): any => {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    if (typeof value._seconds === 'number' && typeof value._nanoseconds === 'number')
      return new Timestamp(value._seconds, value._nanoseconds);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
};

const manifest = JSON.parse(await readFile(source, 'utf8'));
const COLLECTIONS = ['course_fee_ledgers', 'receipts', 'wallet_transactions'] as const;

const plan: Record<string, { restore: any[]; alreadyPresent: string[] }> = {};
for (const name of COLLECTIONS) {
  const rows: any[] = manifest.deletedDocs?.[name] || [];
  const restore: any[] = [];
  const alreadyPresent: string[] = [];
  // Chunked existence check keeps this to a handful of reads.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const snaps = await db.getAll(...chunk.map((r) => db.collection(name).doc(String(r.__id))));
    snaps.forEach((s, idx) => {
      if (s.exists) alreadyPresent.push(String(chunk[idx].__id));
      else restore.push(chunk[idx]);
    });
  }
  plan[name] = { restore, alreadyPresent };
}

const money = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const report: Record<string, unknown> = {
  migration: 'restore_purged_finance',
  undoes: source,
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  databaseId,
  plan: Object.fromEntries(
    COLLECTIONS.map((n) => [
      n,
      { willRestore: plan[n].restore.length, alreadyPresent: plan[n].alreadyPresent.length },
    ])
  ),
  ledgerPaidRestored: plan.course_fee_ledgers.restore.reduce((s, r) => s + money(r.paidTotal), 0),
  receiptMoneyRestored: plan.receipts.restore.reduce((s, r) => s + money(r.amountReceived), 0),
  restored: { course_fee_ledgers: 0, receipts: 0, wallet_transactions: 0 },
  summariesRebuilt: 0,
  summariesFailed: [] as string[],
};

if (APPLY) {
  let batch = db.batch();
  let writes = 0;
  const flush = async () => {
    if (writes) await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  for (const name of COLLECTIONS) {
    for (const row of plan[name].restore) {
      const { __id, ...data } = row;
      batch.create(db.collection(name).doc(String(__id)), revive(data));
      writes += 1;
      (report.restored as any)[name] += 1;
      if (writes >= 400) await flush();
    }
  }
  await flush();

  const { rebuildAccountingStudentSummary } = await import(
    '../server/api/lib/services/accountingStudentSummaryService.js'
  );
  const students = new Set(
    plan.course_fee_ledgers.restore.map((r) => String(r.studentId)).filter(Boolean)
  );
  for (const studentId of students) {
    try {
      await rebuildAccountingStudentSummary(db, studentId);
      report.summariesRebuilt = (report.summariesRebuilt as number) + 1;
    } catch (error) {
      (report.summariesFailed as string[]).push(
        `${studentId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const [l, r, w] = await Promise.all([
    db.collection('course_fee_ledgers').get(),
    db.collection('receipts').get(),
    db.collection('wallet_transactions').get(),
  ]);
  let walletBalance = 0;
  for (const d of w.docs) {
    const t = d.data() as any;
    walletBalance += /deposit/i.test(String(t.type)) ? money(t.amount) : -money(t.amount);
  }
  report.after = {
    ledgers: l.size,
    paidTotal: l.docs.reduce((s, d) => s + money((d.data() as any).paidTotal), 0),
    receipts: r.size,
    receiptsPosted: r.docs
      .filter((d) => String((d.data() as any).status) === 'posted')
      .reduce((s, d) => s + money((d.data() as any).amountReceived), 0),
    walletBalance,
  };
}

await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
