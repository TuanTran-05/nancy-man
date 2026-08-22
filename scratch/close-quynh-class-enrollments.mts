/**
 * Close the enrollments still open on G9 - Ms. Quỳnh T7-CN 17H30.
 *
 * The course ran 2026-06-13 → 2026-08-02, held its last session on 2026-08-01
 * and the class is archived, yet nine enrollments created by the 2026-07-25
 * backfill are still `active`/`on_leave` with `endedAt: null`. All nine students
 * already sit at `students.enrollmentStatus = 'promoted'` and none has an open
 * enrollment anywhere else, so the course finished and only the enrollment rows
 * were left hanging.
 *
 * Closes them the same way a course reset does: `completed`, `endedAt` = the
 * course end date. Every write is validated with the shared schema first, so an
 * invalid row fails here rather than in DocumentStore.
 *
 * Dry run by default. Pass --apply to write. Always writes a manifest.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { assertValidStudentCourseEnrollment } from '../shared/studentCourseEnrollment.js';

const APPLY = process.argv.includes('--apply');
const CLASS_ID = 'tY5PIISvWwaH4ZL7qGHX';
const manifestPath =
  process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1] ||
  `migration-manifest-close-quynh-enrollments-${new Date().toISOString().slice(0, 10)}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const now = new Date().toISOString();
const ACTOR = 'migration:close-archived-course-enrollments';

const classSnap = await db.collection('classes').doc(CLASS_ID).get();
if (!classSnap.exists) throw new Error(`class ${CLASS_ID} not found`);
const classData = classSnap.data() || {};
const courseEndDate = String(classData.endDate || '');
if (!/^\d{4}-\d{2}-\d{2}$/.test(courseEndDate)) {
  throw new Error(`class ${CLASS_ID} has no usable endDate: ${courseEndDate}`);
}

const [enrollSnap, studentsSnap] = await Promise.all([
  db.collection('student_course_enrollments').where('classId', '==', CLASS_ID).get(),
  db.collection('students').get(),
]);
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));

const plan: any[] = [];
const skipped: any[] = [];
for (const doc of enrollSnap.docs) {
  const before = { id: doc.id, ...(doc.data() as any) };
  if (!['trial', 'active', 'on_leave'].includes(String(before.status))) {
    skipped.push({ id: doc.id, reason: `đã đóng (${before.status})` });
    continue;
  }
  const after = {
    ...before,
    status: 'completed' as const,
    endedAt: courseEndDate,
    statusReason: 'course_ended_class_archived',
    statusChangedAt: now,
    statusChangedBy: ACTOR,
    updatedAt: now,
  };
  try {
    assertValidStudentCourseEnrollment(after);
  } catch (error) {
    skipped.push({ id: doc.id, reason: `không hợp lệ: ${(error as Error).message}` });
    continue;
  }
  const student = studentById.get(String(before.studentId)) || {};
  plan.push({
    enrollmentId: doc.id,
    student: String(student.name || ''),
    code: String(student.studentId || ''),
    from: { status: String(before.status), endedAt: before.endedAt ?? null },
    to: { status: 'completed', endedAt: courseEndDate },
    joinedAt: String(before.joinedAt || ''),
    before,
  });
}

const manifest = {
  migration: 'close_archived_course_enrollments',
  classId: CLASS_ID,
  className: String(classData.name || ''),
  courseEndDate,
  generatedAt: now,
  mode: APPLY ? 'apply' : 'dry-run',
  totals: { enrollmentsOnClass: enrollSnap.size, toClose: plan.length, skipped: skipped.length },
  plan,
  skipped,
  written: [] as string[],
};

if (APPLY && plan.length) {
  const batch = db.batch();
  for (const row of plan) {
    batch.update(db.collection('student_course_enrollments').doc(row.enrollmentId), {
      status: 'completed',
      endedAt: courseEndDate,
      statusReason: 'course_ended_class_archived',
      statusChangedAt: now,
      statusChangedBy: ACTOR,
      updatedAt: now,
    });
    manifest.written.push(row.enrollmentId);
  }
  await batch.commit();
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      mode: manifest.mode,
      className: manifest.className,
      courseEndDate,
      ...manifest.totals,
      written: manifest.written.length,
      preview: plan.map((p) => `${p.student} (${p.code}): ${p.from.status} → completed, endedAt ${courseEndDate}`),
      skipped,
      manifestPath,
    },
    null,
    2
  )
);
