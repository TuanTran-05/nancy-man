/** READ-ONLY: full profile of the ledgers with no enrollment row, after the duplicate merge. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const rem = (l: any) => Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const toIso = (v: any): string => !v ? '' : typeof v === 'string' ? v
  : typeof v?.toDate === 'function' ? v.toDate().toISOString() : '';
const today = new Date().toISOString().slice(0, 10);

const [studentsSnap, enrollSnap, ledgerSnap, classesSnap] = await Promise.all([
  db.collection('students').get(), db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(), db.collection('classes').get(),
]);
const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const enrollByStudent = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = d.data() as any; const k = String(e.studentId || '');
  if (!enrollByStudent.has(k)) enrollByStudent.set(k, []);
  enrollByStudent.get(k)!.push(e);
}
const rows: any[] = [];
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const sid = String(l.studentId || ''), cid = String(l.classId || '');
  const enrolls = enrollByStudent.get(sid) || [];
  if (enrolls.some((e) => String(e.classId || '') === cid)) continue;
  const s = studentById.get(sid); const c = classById.get(cid);
  rows.push({
    student: String(s?.name || '(doc missing)'), code: String(s?.studentId || ''),
    studentDocId: sid,
    lifecycle: String(s?.studentLifecycle || '(absent)'),
    enrollmentStatus: String(s?.enrollmentStatus || ''),
    statusNote: String(s?.statusNote || ''),
    className: String(c?.name || ''), classStatus: String(c?.status || ''),
    classEnd: String(c?.endDate || ''), classEnded: Boolean(c?.endDate && String(c.endDate) < today),
    termStart: String(l.termStart || ''), debt: rem(l), paid: money(l.paidTotal),
    ledgerCreated: toIso(l.createdAt).slice(0, 10),
    hasOpenEnrollmentElsewhere: enrolls.some((e) => ['trial','active','on_leave'].includes(String(e.status))),
    dueDate: String(l.dueDate || ''),
    overdue: Boolean(l.dueDate && String(l.dueDate) < today),
    reminders: Number(l.tuitionReminderCount || 0),
  });
}
const group = (f: string) => Object.fromEntries(
  [...rows.reduce((m, r) => m.set(String(r[f]), (m.get(String(r[f])) || 0) + 1), new Map())].sort((a: any, b: any) => b[1] - a[1])
);
const sum = (pred: (r: any) => boolean) => rows.filter(pred).reduce((s, r) => s + r.debt, 0);
console.log(JSON.stringify({
  today, orphanLedgers: rows.length,
  distinctStudents: new Set(rows.map((r) => r.studentDocId)).size,
  totalDebt: rows.reduce((s, r) => s + r.debt, 0),
  alreadyPaidOnThem: rows.reduce((s, r) => s + r.paid, 0),
  byEnrollmentStatus: group('enrollmentStatus'),
  byLifecycle: group('lifecycle'),
  byClassStatus: group('classStatus'),
  byClass: group('className'),
  byLedgerCreatedMonth: Object.fromEntries([...rows.reduce((m, r) => m.set(r.ledgerCreated.slice(0,7), (m.get(r.ledgerCreated.slice(0,7))||0)+1), new Map())].sort()),
  classAlreadyEnded: rows.filter((r) => r.classEnded).length,
  overdue: rows.filter((r) => r.overdue).length,
  remindersSent: rows.filter((r) => r.reminders > 0).length,
  studentStillStudyingElsewhere: rows.filter((r) => r.hasOpenEnrollmentElsewhere).length,
  debtSplit: {
    studentStillStudying: sum((r) => r.hasOpenEnrollmentElsewhere),
    studentNotStudying: sum((r) => !r.hasOpenEnrollmentElsewhere),
    dropped: sum((r) => r.enrollmentStatus === 'dropped'),
  },
  rows,
}, null, 2));
