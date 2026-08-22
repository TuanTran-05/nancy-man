/** READ-ONLY: replay the fixed projection over production data and diff it against the stored summaries. Writes nothing. */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { buildAccountingStudentSummary } from '../server/api/lib/accounting/studentFinanceProjection.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);
const today = new Date().toISOString().slice(0, 10);

const [studentsSnap, enrollSnap, ledgerSnap, summarySnap] = await Promise.all([
  db.collection('students').get(),
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
  db.collection('accounting_student_summaries').get(),
]);

const summaryById = new Map(summarySnap.docs.map((d) => [d.id, d.data() as any]));
const enrollByStudent = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const k = String(e.studentId || '');
  if (!enrollByStudent.has(k)) enrollByStudent.set(k, []);
  enrollByStudent.get(k)!.push(e);
}
const ledgersByStudent = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const data = d.data() as any;
  const l = {
    id: d.id,
    classId: typeof data.classId === 'string' ? data.classId : null,
    termStart: typeof data.termStart === 'string' ? data.termStart : null,
    amount: data.amount,
    discountTotal: data.discountTotal,
    paidTotal: data.paidTotal,
    dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
    waived: data.status === 'waived',
    tuitionReminderCount: data.tuitionReminderCount,
    tuitionReminderLastSentAt: data.tuitionReminderLastSentAt,
  };
  const k = String(data.studentId || '');
  if (!ledgersByStudent.has(k)) ledgersByStudent.set(k, []);
  ledgersByStudent.get(k)!.push(l);
}

const changes: any[] = [];
const badgeShift = new Map<string, number>();
let storedOutstandingTotal = 0;
let fixedOutstandingTotal = 0;

for (const sd of studentsSnap.docs) {
  const student = { id: sd.id, ...(sd.data() as any) };
  const fixed = buildAccountingStudentSummary({
    student,
    enrollments: (enrollByStudent.get(student.id) || []) as any,
    ledgers: ledgersByStudent.get(student.id) || [],
    today,
  });
  const stored = summaryById.get(student.id);
  storedOutstandingTotal += Number(stored?.totalOutstanding || 0);
  fixedOutstandingTotal += fixed.totalOutstanding;
  const storedBadge = String(stored?.currentCoursePaymentStatus || '(none)');
  const storedOut = Number(stored?.totalOutstanding || 0);
  if (storedBadge === fixed.currentCoursePaymentStatus && storedOut === fixed.totalOutstanding)
    continue;
  const key = `${storedBadge} -> ${fixed.currentCoursePaymentStatus}`;
  badgeShift.set(key, (badgeShift.get(key) || 0) + 1);
  changes.push({
    studentId: student.id,
    studentName: String(student.name || ''),
    studentCode: String(student.studentId || student.code || ''),
    badge: { before: storedBadge, after: fixed.currentCoursePaymentStatus },
    totalOutstanding: { before: storedOut, after: fixed.totalOutstanding },
    totalPaid: { before: Number(stored?.totalPaid || 0), after: fixed.totalPaid },
  });
}

changes.sort((a, b) => b.totalOutstanding.after - a.totalOutstanding.after);
const report = {
  generatedAt: new Date().toISOString(),
  studentsChecked: studentsSnap.size,
  studentsChanged: changes.length,
  badgeTransitions: Object.fromEntries([...badgeShift].sort((a, b) => b[1] - a[1])),
  outstandingTotal: {
    storedNow: storedOutstandingTotal,
    afterFix: fixedOutstandingTotal,
    delta: fixedOutstandingTotal - storedOutstandingTotal,
  },
  changes,
};
const out = process.argv[2] || 'projection-fix-verification.json';
await writeFile(out, JSON.stringify(report, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      studentsChecked: report.studentsChecked,
      studentsChanged: report.studentsChanged,
      badgeTransitions: report.badgeTransitions,
      outstandingTotal: report.outstandingTotal,
      sample: changes.slice(0, 8),
      out,
    },
    null,
    2
  )
);
