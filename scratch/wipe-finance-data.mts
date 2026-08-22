/**
 * Clear the finance data so it can be rebuilt from the current enrollments.
 *
 * The centre still keeps tuition in its paper books; the app is running
 * alongside them, so these rows describe billing the receipt module never saw
 * rather than money anyone failed to collect. Rebuilding from live enrollments
 * also dissolves the ledgers that have no enrollment row, because every
 * regenerated ledger comes from one by construction.
 *
 * Writes every deleted document verbatim to the manifest first, so the wipe is
 * reversible from this file alone.
 *
 * Touches ONLY: course_fee_ledgers, receipts, wallet_transactions,
 * accounting_student_summaries (regenerated afterwards).
 * Never touches: course_closing_records, attendance, evaluations, audit_logs,
 * students, classes, student_course_enrollments.
 *
 * Dry run by default. Pass --apply to write. --keep-receipts leaves receipts and
 * wallet transactions in place.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type QuerySnapshot } from '@/server/db/documentStore.js';

const APPLY = process.argv.includes('--apply');
const KEEP_RECEIPTS = process.argv.includes('--keep-receipts');
const manifestPath =
  process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1] ||
  `migration-manifest-wipe-finance-${new Date().toISOString().slice(0, 10)}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const TARGETS = KEEP_RECEIPTS
  ? ['course_fee_ledgers']
  : ['course_fee_ledgers', 'receipts', 'wallet_transactions'];

const snaps: Record<string, QuerySnapshot> = {};
for (const name of TARGETS) snaps[name] = await db.collection(name).get();

/** Guard rails: anything unexpected here means the picture changed since it was planned. */
const guards: string[] = [];
const invoices = await db.collection('invoices').get();
const payments = await db.collection('payment_requests').get();
if (invoices.size > 0) guards.push(`invoices tồn tại (${invoices.size}) — chúng trỏ vào ledger`);
if (payments.size > 0)
  guards.push(`payment_requests tồn tại (${payments.size}) — có giao dịch online`);

const backup: Record<string, Array<Record<string, unknown>>> = {};
let totalDocs = 0;
for (const name of TARGETS) {
  backup[name] = snaps[name].docs.map((d) => ({ __id: d.id, ...(d.data() || {}) }));
  totalDocs += snaps[name].size;
}

const manifest = {
  migration: 'wipe_finance_data_for_rebuild',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  keepReceipts: KEEP_RECEIPTS,
  guards,
  counts: Object.fromEntries(TARGETS.map((name) => [name, snaps[name].size])),
  totalDocs,
  untouched: [
    'course_closing_records',
    'attendance',
    'evaluations',
    'audit_logs',
    'students',
    'classes',
    'student_course_enrollments',
  ],
  backup,
  deleted: 0,
};

if (APPLY) {
  if (guards.length) throw new Error(`Dừng lại vì guard: ${guards.join(' | ')}`);
  // The manifest is the only copy of these rows once they are gone: write it first.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  for (const name of TARGETS) {
    let batch = db.batch();
    let writes = 0;
    for (const doc of snaps[name].docs) {
      batch.delete(doc.ref);
      writes += 1;
      manifest.deleted += 1;
      if (writes >= 400) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    }
    if (writes) await batch.commit();
  }
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      mode: manifest.mode,
      keepReceipts: KEEP_RECEIPTS,
      willDelete: manifest.counts,
      totalDocs,
      deleted: manifest.deleted,
      guards: guards.length ? guards : '(không có cảnh báo)',
      untouched: manifest.untouched,
      manifestPath,
    },
    null,
    2
  )
);
