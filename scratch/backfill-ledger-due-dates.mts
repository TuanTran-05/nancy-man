/**
 * Stamp `dueDate` on course fee ledgers that never got one.
 *
 * Ledgers have always been written without a due date, so
 * `deriveAccountingPaymentStatus` could never report `overdue` for anyone — the
 * "Quá hạn" filter, `overdueCourseCount` and the top priority rank were dead in
 * production. The rule is the centre's own: two weeks after the course starts,
 * the same deadline the course-closing notice quotes to parents.
 *
 * Only fills a missing due date; never overwrites one that exists.
 * Dry run by default. Pass --apply to write. Always writes a manifest.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { courseTuitionDueDate } from '../shared/tuitionDueDate.js';

const APPLY = process.argv.includes('--apply');
const manifestPath =
  process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1] ||
  `migration-manifest-ledger-due-dates-${new Date().toISOString().slice(0, 10)}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const money = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const rem = (l: any) => Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const isIso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = new Date().toISOString().slice(0, 10);

const [ledgerSnap, classesSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('classes').get(),
]);
const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));

const plan: any[] = [];
const skipped: any[] = [];
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  if (isIso(l.dueDate)) {
    skipped.push({ id: d.id, reason: 'đã có dueDate', dueDate: l.dueDate });
    continue;
  }
  const dueDate = courseTuitionDueDate(l.termStart);
  if (!dueDate) {
    skipped.push({ id: d.id, reason: 'termStart không hợp lệ', termStart: l.termStart ?? null });
    continue;
  }
  const debt = rem(l);
  plan.push({
    ledgerId: d.id,
    studentId: String(l.studentId || ''),
    classId: String(l.classId || ''),
    className: String(classById.get(String(l.classId || ''))?.name || ''),
    termStart: String(l.termStart),
    dueDate,
    debt,
    status: String(l.status || ''),
    becomesOverdue: debt > 0 && dueDate < today,
  });
}

const overdue = plan.filter((p) => p.becomesOverdue);
const manifest = {
  migration: 'backfill_course_fee_ledger_due_dates',
  rule: 'dueDate = termStart + 14 ngày (TUITION_DUE_DAYS_AFTER_TERM_START)',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  totals: {
    ledgersScanned: ledgerSnap.size,
    toStamp: plan.length,
    skipped: skipped.length,
    becomeOverdue: overdue.length,
    overdueDebt: overdue.reduce((s, p) => s + p.debt, 0),
    stayWithinDueDate: plan.length - overdue.length,
  },
  plan,
  skipped,
  written: [] as string[],
};

if (APPLY && plan.length) {
  let batch = db.batch();
  let writes = 0;
  for (const row of plan) {
    batch.update(db.collection('course_fee_ledgers').doc(row.ledgerId), { dueDate: row.dueDate });
    manifest.written.push(row.ledgerId);
    writes += 1;
    if (writes >= 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
const byClass = new Map<string, { count: number; debt: number }>();
for (const p of overdue) {
  const cur = byClass.get(p.className) || { count: 0, debt: 0 };
  cur.count += 1;
  cur.debt += p.debt;
  byClass.set(p.className, cur);
}
console.log(
  JSON.stringify(
    {
      mode: manifest.mode,
      rule: manifest.rule,
      ...manifest.totals,
      written: manifest.written.length,
      skippedReasons: Object.fromEntries(
        [...skipped.reduce((m, s) => m.set(s.reason, (m.get(s.reason) || 0) + 1), new Map())]
      ),
      overdueByClass: Object.fromEntries([...byClass].sort((a, b) => b[1].debt - a[1].debt).slice(0, 10)),
      manifestPath,
    },
    null,
    2
  )
);
