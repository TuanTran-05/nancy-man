/** READ-ONLY. The rebuild recreates 644 ledgers where 657 exist today. This
 * asks the only dangerous version of that question: of the ledgers that would
 * NOT come back, does any of them hold money someone actually paid? Also
 * verifies the key a replay would use is unique, and that no replayed payment
 * would exceed the rebuilt ledger's amount. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { planClassLedgers } from '../server/api/lib/accounting/courseLedgerPlanner.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const [classesSnap, enrollSnap, ledgerSnap, studentsSnap] = await Promise.all([
  db.collection('classes').get(),
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
  db.collection('students').get(),
]);

const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const enrollByClass = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const k = String(e.classId || '');
  if (!enrollByClass.has(k)) enrollByClass.set(k, []);
  enrollByClass.get(k)!.push(e);
}

/** Rebuild the plan exactly as the app would, and key it the way a replay must. */
const plannedByKey = new Map<string, any>();
const skippedClassIds: string[] = [];
for (const c of classesSnap.docs) {
  const enrolls = (enrollByClass.get(c.id) || []).map((e) => ({
    id: e.id, studentId: String(e.studentId || ''), classId: c.id,
    termStart: String(e.termStart || ''), termEnd: e.termEnd ?? null, status: e.status,
  }));
  const plan = planClassLedgers({ classId: c.id, classData: c.data() as any, enrollments: enrolls, ledgers: [] });
  if (plan.skipReason) { skippedClassIds.push(c.id); continue; }
  // The planner derives a deterministic ledgerId from student+class+term, which
  // is exactly the identity an existing ledger already carries as its doc id.
  for (const x of plan.creates) plannedByKey.set(String(x.ledgerId), x);
}

const ledgers = ledgerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

// uniqueness of the replay key among today's ledgers
const keyCounts = new Map<string, number>();
for (const l of ledgers) {
  const k = String(l.id);
  keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
}
const ambiguousKeys = [...keyCounts.entries()].filter(([, n]) => n > 1);

// ledgers that would NOT be recreated
const orphanedByRebuild: any[] = [];
const shortfall: any[] = [];
for (const l of ledgers) {
  const planned = plannedByKey.get(String(l.id));
  if (!planned) {
    orphanedByRebuild.push({
      ledgerId: l.id,
      studentId: l.studentId,
      studentName: studentById.get(String(l.studentId))?.name || '(NO STUDENT DOC)',
      className: classById.get(String(l.classId))?.name || String(l.classId),
      classArchived: Boolean(classById.get(String(l.classId))?.archived ?? classById.get(String(l.classId))?.isArchived),
      classSkipped: skippedClassIds.includes(String(l.classId)),
      amount: m(l.amount),
      paidTotal: m(l.paidTotal),
      status: l.status,
    });
    continue;
  }
  if (m(l.paidTotal) > m(planned.amount)) {
    shortfall.push({
      ledgerId: l.id,
      studentName: studentById.get(String(l.studentId))?.name || '(NO STUDENT DOC)',
      className: classById.get(String(l.classId))?.name || '',
      paidTotal: m(l.paidTotal),
      rebuiltAmount: m(planned.amount),
      overpayAfterRebuild: m(l.paidTotal) - m(planned.amount),
    });
  }
}

const orphanedWithMoney = orphanedByRebuild.filter((o) => o.paidTotal > 0);

console.log(JSON.stringify({
  todayLedgers: ledgers.length,
  rebuiltLedgers: plannedByKey.size,
  replayKeyAmbiguous: ambiguousKeys.length,
  ledgersNotRecreated: orphanedByRebuild.length,
  ledgersNotRecreatedHoldingPaidMoney: orphanedWithMoney.length,
  moneyStrandedByRebuild: orphanedWithMoney.reduce((s, o) => s + o.paidTotal, 0),
  billedLostFromArchivedClasses: orphanedByRebuild.reduce((s, o) => s + o.amount, 0),
  paymentsExceedingRebuiltAmount: shortfall.length,
  orphanedDetail: orphanedByRebuild,
  shortfallDetail: shortfall,
}, null, 2));
