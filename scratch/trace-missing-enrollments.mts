/** READ-ONLY: did the enrollments behind the orphan ledgers ever exist, and what removed them? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);

const [ledgerSnap, enrollSnap, studentsSnap, classesSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('student_course_enrollments').get(),
  db.collection('students').get(),
  db.collection('classes').get(),
]);

const existingEnrollmentIds = new Set(enrollSnap.docs.map((d) => d.id));
const enrollByStudent = new Map<string, number>();
for (const d of enrollSnap.docs) {
  const sid = String((d.data() as any).studentId || '');
  enrollByStudent.set(sid, (enrollByStudent.get(sid) || 0) + 1);
}
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));

const orphans: any[] = [];
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const sid = String(l.studentId || '');
  const cid = String(l.classId || '');
  const ts = String(l.termStart || '');
  if (!sid || !cid || !ts) continue;
  const hasForClass = enrollSnap.docs.some(
    (e) =>
      String((e.data() as any).studentId || '') === sid &&
      String((e.data() as any).classId || '') === cid
  );
  if (hasForClass) continue;
  let expectedId = '';
  try {
    expectedId = makeStudentCourseEnrollmentId(sid, cid, ts);
  } catch (err) {
    expectedId = `(cannot build: ${(err as Error).message})`;
  }
  orphans.push({
    ledgerId: d.id,
    studentId: sid,
    studentName: String(studentById.get(sid)?.name || '(student doc missing)'),
    enrollmentStatus: String(studentById.get(sid)?.enrollmentStatus || ''),
    classId: cid,
    className: String(classById.get(cid)?.name || ''),
    classStatus: String(classById.get(cid)?.status || ''),
    termStart: ts,
    expectedEnrollmentId: expectedId,
    enrollmentDocExists: existingEnrollmentIds.has(expectedId),
    studentTotalEnrollments: enrollByStudent.get(sid) || 0,
  });
}

// audit trail for the exact enrollment ids and the students
const auditHits: any[] = [];
const wanted = new Set(orphans.map((o) => o.expectedEnrollmentId));
const wantedStudents = new Set(orphans.map((o) => o.studentId));
const auditSnap = await db.collection('audit_logs').get();
const auditByCollection = new Map<string, number>();
for (const d of auditSnap.docs) {
  const a = d.data() as any;
  const col = String(a.collection || '');
  const docId = String(a.documentId || '');
  if (col === 'student_course_enrollments') {
    auditByCollection.set(
      `${col}/${a.action}`,
      (auditByCollection.get(`${col}/${a.action}`) || 0) + 1
    );
  }
  if (wanted.has(docId) || (col === 'students' && wantedStudents.has(docId))) {
    auditHits.push({
      collection: col,
      action: String(a.action || ''),
      documentId: docId,
      userName: String(a.userName || ''),
      at: String(a.timestamp || a.createdAt || ''),
      metadata: a.metadata,
    });
  }
}

console.log(
  JSON.stringify(
    {
      orphanLedgers: orphans.length,
      expectedEnrollmentDocPresent: orphans.filter((o) => o.enrollmentDocExists).length,
      expectedEnrollmentDocMissing: orphans.filter((o) => !o.enrollmentDocExists).length,
      studentsWithZeroEnrollments: new Set(
        orphans.filter((o) => o.studentTotalEnrollments === 0).map((o) => o.studentId)
      ).size,
      auditLogTotals: Object.fromEntries(auditByCollection),
      auditHitsForTheseIds: auditHits.length,
      auditHitSample: auditHits.slice(0, 12),
      sample: orphans.slice(0, 6),
    },
    null,
    2
  )
);
