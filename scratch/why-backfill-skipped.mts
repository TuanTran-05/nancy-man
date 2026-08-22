/** READ-ONLY: why the safe enrollment backfill excluded the students carrying orphan ledgers. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);

const [studentsSnap, enrollSnap, ledgerSnap, classesSnap] = await Promise.all([
  db.collection('students').get(),
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
  db.collection('classes').get(),
]);

const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const enrollCount = new Map<string, number>();
for (const d of enrollSnap.docs) {
  const sid = String((d.data() as any).studentId || '');
  enrollCount.set(sid, (enrollCount.get(sid) || 0) + 1);
}

const orphanStudentIds = new Set<string>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const sid = String(l.studentId || '');
  if ((enrollCount.get(sid) || 0) === 0) orphanStudentIds.add(sid);
}

const byEnrollmentStatus = new Map<string, number>();
const byLifecycle = new Map<string, number>();
const classEnded: string[] = [];
const today = new Date().toISOString().slice(0, 10);
const rows: any[] = [];

for (const d of studentsSnap.docs) {
  if (!orphanStudentIds.has(d.id)) continue;
  const s = d.data() as any;
  const es = String(s.enrollmentStatus ?? '(field absent)');
  const lc = String(s.studentLifecycle ?? '(field absent)');
  byEnrollmentStatus.set(es, (byEnrollmentStatus.get(es) || 0) + 1);
  byLifecycle.set(lc, (byLifecycle.get(lc) || 0) + 1);
  const cls = classById.get(String(s.classId || ''));
  const endDate = String(cls?.endDate || '');
  if (endDate && endDate < today) classEnded.push(String(cls?.name || ''));
  rows.push({
    name: String(s.name || ''),
    code: String(s.studentId || ''),
    enrollmentStatus: es,
    studentLifecycle: lc,
    className: String(cls?.name || ''),
    classStartDate: String(cls?.startDate || ''),
    classEndDate: endDate,
    classAlreadyEnded: Boolean(endDate && endDate < today),
  });
}

console.log(
  JSON.stringify(
    {
      today,
      studentsWithOrphanLedgerAndNoEnrollment: rows.length,
      byEnrollmentStatus: Object.fromEntries(byEnrollmentStatus),
      byStudentLifecycle: Object.fromEntries(byLifecycle),
      classAlreadyEndedCount: classEnded.length,
      endedClasses: Object.fromEntries(
        [...classEnded.reduce((m, c) => m.set(c, (m.get(c) || 0) + 1), new Map())]
      ),
      sample: rows.slice(0, 10),
    },
    null,
    2
  )
);
