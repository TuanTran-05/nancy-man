import type { DocumentStore } from '@/server/db/documentStore.js';
import { readStoredStudentCourseEnrollment } from '../../server/api/lib/student/courseEnrollmentRepository.js';
import type { StudentCourseEnrollment } from '../../shared/studentCourseEnrollment.js';
import type { SafeEnrollmentSourceBundle } from './types.js';

export type SafeEnrollmentSourceLoadResult = {
  sources: SafeEnrollmentSourceBundle;
  summary: { students: number; classes: number; enrollments: number };
};

export async function loadSafeEnrollmentSources(
  db: DocumentStore
): Promise<SafeEnrollmentSourceLoadResult> {
  const [studentsSnapshot, classesSnapshot, enrollmentsSnapshot] = await Promise.all([
    db.collection('students').get(),
    db.collection('classes').get(),
    db.collection('student_course_enrollments').get(),
  ]);
  const toSource = (doc: {
    id: string;
    data: () => AppDocumentStore.DocumentData;
    updateTime?: { toDate: () => Date };
  }) => ({
    id: doc.id,
    data: (doc.data() || {}) as Record<string, unknown>,
    ...(doc.updateTime ? { updateTime: doc.updateTime.toDate().toISOString() } : {}),
  });
  const students = studentsSnapshot.docs
    .map(toSource)
    .sort((left, right) => left.id.localeCompare(right.id));
  const classes = classesSnapshot.docs
    .map(toSource)
    .sort((left, right) => left.id.localeCompare(right.id));
  const existingByStudent = new Map<string, StudentCourseEnrollment[]>();
  const enrollmentDocs = [...enrollmentsSnapshot.docs].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  for (const doc of enrollmentDocs) {
    let enrollment: StudentCourseEnrollment;
    try {
      enrollment = readStoredStudentCourseEnrollment(doc);
    } catch {
      throw new Error(`SAFE_ENROLLMENT_STORED_RECORD_INVALID:${doc.id}`);
    }
    const current = existingByStudent.get(enrollment.studentId) || [];
    current.push(enrollment);
    existingByStudent.set(enrollment.studentId, current);
  }
  return {
    sources: { students, classes, existingByStudent },
    summary: {
      students: students.length,
      classes: classes.length,
      enrollments: enrollmentDocs.length,
    },
  };
}
