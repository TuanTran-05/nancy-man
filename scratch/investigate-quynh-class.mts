/** READ-ONLY: why does an archived class still carry open enrollments? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const toIso = (v: any): string => !v ? '' : typeof v === 'string' ? v
  : typeof v?.toDate === 'function' ? v.toDate().toISOString() : '';
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const today = new Date().toISOString().slice(0, 10);

const [classesSnap, enrollSnap, studentsSnap, ledgerSnap, sessionsSnap, attendanceSnap] = await Promise.all([
  db.collection('classes').get(), db.collection('student_course_enrollments').get(),
  db.collection('students').get(), db.collection('course_fee_ledgers').get(),
  db.collection('class_sessions').get(), db.collection('attendance').get(),
]);
const target = classesSnap.docs.find((d) => String((d.data() as any).name || '').includes('Ms. Quỳnh'));
if (!target) { console.log('không tìm thấy lớp'); process.exit(0); }
const cd = target.data() as any;
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));

const enrolls = enrollSnap.docs.filter((d) => String((d.data() as any).classId) === target.id)
  .map((d) => ({ id: d.id, ...(d.data() as any) }));
const successors = classesSnap.docs.filter((d) => String((d.data() as any).importSourceClassId || '') === target.id);

// where did each student go?
const rows = enrolls.map((e) => {
  const s = studentById.get(String(e.studentId)) || {};
  const otherOpen = enrollSnap.docs.filter((d) => {
    const x = d.data() as any;
    return String(x.studentId) === String(e.studentId) && String(x.classId) !== target.id
      && ['trial','active','on_leave'].includes(String(x.status));
  }).map((d) => {
    const x = d.data() as any;
    const c = classesSnap.docs.find((cc) => cc.id === String(x.classId));
    return { className: String(c?.data()?.name || ''), status: String(x.status), termStart: String(x.termStart || '') };
  });
  return {
    student: String(s.name || ''), code: String(s.studentId || ''),
    enrollmentStatus: String(e.status), termStart: String(e.termStart || ''), termEnd: String(e.termEnd || ''),
    endedAt: e.endedAt ?? null, source: String(e.source || ''), confidence: String(e.confidence || ''),
    studentClassId: String(s.classId || ''), studentEnrollmentStatus: String(s.enrollmentStatus || ''),
    studentLifecycle: String(s.studentLifecycle || ''),
    movedToOpenClasses: otherOpen,
  };
});
const lastSession = sessionsSnap.docs.filter((d) => String((d.data() as any).classId) === target.id)
  .map((d) => String((d.data() as any).date || '')).sort().pop();
const attendanceCount = attendanceSnap.docs.filter((d) => String((d.data() as any).classId) === target.id).length;

console.log(JSON.stringify({
  today,
  class: {
    id: target.id, name: String(cd.name || ''), status: String(cd.status || ''),
    startDate: String(cd.startDate || ''), endDate: String(cd.endDate || ''),
    endDatePassed: Boolean(cd.endDate && String(cd.endDate) < today),
    archivedAt: toIso(cd.archivedAt) || '(không có)', teacherName: String(cd.teacherName || ''),
    tuitionFee: money(cd.tuitionFee), importSourceClassId: String(cd.importSourceClassId || ''),
    currentCourseId: String(cd.currentCourseId || ''),
  },
  successorClasses: successors.map((d) => ({ id: d.id, name: String((d.data() as any).name || ''), status: String((d.data() as any).status || '') })),
  enrollmentsOnThisClass: enrolls.length,
  byStatus: Object.fromEntries([...enrolls.reduce((m,e)=>m.set(String(e.status),(m.get(String(e.status))||0)+1), new Map())]),
  ledgersOnThisClass: ledgerSnap.docs.filter((d) => String((d.data() as any).classId) === target.id).length,
  lastSessionDate: lastSession || '(không có buổi nào)',
  attendanceRecords: attendanceCount,
  students: rows,
}, null, 2));
