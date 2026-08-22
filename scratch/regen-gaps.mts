/** READ-ONLY: who would be left without a ledger after a wipe-and-regenerate, and why. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { isOpenStudentCourseEnrollmentStatus } from '../shared/studentCourseEnrollment.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const [classesSnap, enrollSnap, studentsSnap] = await Promise.all([
  db.collection('classes').get(), db.collection('student_course_enrollments').get(), db.collection('students').get(),
]);
const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const gaps: any[] = [];
for (const d of enrollSnap.docs) {
  const e = d.data() as any;
  if (!isOpenStudentCourseEnrollmentStatus(e.status)) continue;
  const c = classById.get(String(e.classId || ''));
  const fee = money(c?.tuitionFee);
  const archived = String(c?.status || '') === 'archived';
  if (!archived && fee > 0) continue;
  gaps.push({
    student: String(studentById.get(String(e.studentId))?.name || ''),
    code: String(studentById.get(String(e.studentId))?.studentId || ''),
    className: String(c?.name || '(lớp không tồn tại)'),
    classStatus: String(c?.status || ''), tuitionFee: fee,
    enrollmentStatus: String(e.status || ''), termStart: String(e.termStart || ''),
    reason: !c ? 'lớp không tồn tại' : archived ? 'lớp đã archived' : 'tuitionFee = 0',
  });
}
let nonZeroWallet = 0;
for (const d of studentsSnap.docs) if (money((d.data() as any).walletBalance) !== 0) nonZeroWallet++;
console.log(JSON.stringify({
  studentsWithoutLedgerAfterRegen: gaps.length,
  byReason: Object.fromEntries([...gaps.reduce((m,g)=>m.set(g.reason,(m.get(g.reason)||0)+1), new Map())]),
  rows: gaps,
  studentsWithNonZeroWalletBalance: nonZeroWallet,
}, null, 2));
