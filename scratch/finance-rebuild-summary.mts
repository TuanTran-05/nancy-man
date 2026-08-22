/** READ-ONLY: classify the ledgers a rebuild would not bring back, so the
 * decision about them is made on numbers rather than on a sample. */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { planClassLedgers } from '../server/api/lib/accounting/courseLedgerPlanner.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const [classesSnap, enrollSnap, ledgerSnap, studentsSnap] = await Promise.all([
  db.collection('classes').get(), db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(), db.collection('students').get(),
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
const enrollByStudentClass = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = d.data() as any;
  const k = `${e.studentId}|${e.classId}`;
  if (!enrollByStudentClass.has(k)) enrollByStudentClass.set(k, []);
  enrollByStudentClass.get(k)!.push(e);
}

const planned = new Set<string>();
const skipped = new Set<string>();
for (const c of classesSnap.docs) {
  const enrolls = (enrollByClass.get(c.id) || []).map((e) => ({
    id: e.id, studentId: String(e.studentId || ''), classId: c.id,
    termStart: String(e.termStart || ''), termEnd: e.termEnd ?? null, status: e.status,
  }));
  const plan = planClassLedgers({ classId: c.id, classData: c.data() as any, enrollments: enrolls, ledgers: [] });
  if (plan.skipReason) { skipped.add(c.id); continue; }
  for (const x of plan.creates) planned.add(String(x.ledgerId));
}

const buckets = new Map<string, { ledgers: number; billed: number; paid: number; students: Set<string> }>();
const bump = (reason: string, l: any) => {
  const b = buckets.get(reason) || { ledgers: 0, billed: 0, paid: 0, students: new Set<string>() };
  b.ledgers += 1; b.billed += m(l.amount); b.paid += m(l.paidTotal); b.students.add(String(l.studentId));
  buckets.set(reason, b);
};

const strandedWithMoney: any[] = [];
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ...(d.data() as any) };
  if (planned.has(String(l.id))) continue;

  const cls = classById.get(String(l.classId));
  const enrolls = enrollByStudentClass.get(`${l.studentId}|${l.classId}`) || [];
  let reason: string;
  if (!cls) reason = 'class_document_missing';
  else if (skipped.has(String(l.classId))) reason = 'class_archived_planner_skips';
  else if (!enrolls.length) reason = 'no_enrollment_for_student_in_class';
  else if (!enrolls.some((e) => String(e.termStart || '') === String(l.termStart || '')))
    reason = 'past_term_current_enrollment_moved_on';
  else reason = 'other';
  bump(reason, l);

  if (m(l.paidTotal) > 0) {
    strandedWithMoney.push({
      ledgerId: l.id, reason,
      studentName: studentById.get(String(l.studentId))?.name || '(NO STUDENT DOC)',
      className: cls?.name || String(l.classId),
      termStart: l.termStart, termEnd: l.termEnd,
      amount: m(l.amount), paidTotal: m(l.paidTotal), status: l.status,
    });
  }
}

const out = {
  todayLedgers: ledgerSnap.size,
  rebuiltLedgers: planned.size,
  notRecreated: [...buckets.entries()].map(([reason, b]) => ({
    reason, ledgers: b.ledgers, billed: b.billed, paidMoneyStranded: b.paid, students: b.students.size,
  })).sort((a, b) => b.paidMoneyStranded - a.paidMoneyStranded),
  totalStrandedPaidMoney: strandedWithMoney.reduce((s, x) => s + x.paidTotal, 0),
  strandedLedgersWithMoney: strandedWithMoney.length,
  strandedDetail: strandedWithMoney.sort((a, b) => b.paidTotal - a.paidTotal),
};
await writeFile('scratch/finance-rebuild-stranded.json', JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ ...out, strandedDetail: `${strandedWithMoney.length} rows -> scratch/finance-rebuild-stranded.json` }, null, 2));
