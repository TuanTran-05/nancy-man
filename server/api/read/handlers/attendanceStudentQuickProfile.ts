import type { DocumentStore } from '@/server/db/documentStore.js';
import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { requireRole, withAuthzStatus, assertClassAccess } from '../../lib/auth/authz.js';
import type { UserContext } from '../../lib/auth/authz.js';
import { resolveCanonicalStudentId } from '../../lib/student/studentIdentityResolver.js';
import { projectStudent } from '../../lib/student/studentProjection.js';
import { readStoredStudentCourseEnrollment } from '../../lib/student/courseEnrollmentRepository.js';
import { buildAccountingStudentSummary } from '../../lib/services/accountingStudentSummaryService.js';
import { buildClassTerms } from '../../../../shared/studentEnrollmentTimeline.js';
import { readCourseJoins } from '../../../../shared/studentEnrollmentWindows.js';
import { isOpenStudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';
import type { AttendanceStudentQuickProfileResponse } from '../../../../shared/attendanceStudentQuickProfile.js';
import { calculateCurrentCourseAttendance } from './attendanceStudentQuickProfileSummary.js';

function pickQuickProfileStudent(
  projected: Record<string, unknown>
): AttendanceStudentQuickProfileResponse['student'] {
  const student: AttendanceStudentQuickProfileResponse['student'] = {
    id: String(projected.id || ''),
    name: String(projected.name || ''),
    studentId: String(projected.studentId || ''),
    classId: String(projected.classId || ''),
    dob: String(projected.dob || ''),
    contact: String(projected.contact || ''),
  };
  if (
    projected.gender === 'male' ||
    projected.gender === 'female' ||
    projected.gender === 'other'
  ) {
    student.gender = projected.gender;
  }
  if (
    projected.enrollmentStatus === 'active' ||
    projected.enrollmentStatus === 'on_leave' ||
    projected.enrollmentStatus === 'dropped' ||
    projected.enrollmentStatus === 'promoted'
  ) {
    student.enrollmentStatus = projected.enrollmentStatus;
  }
  for (const field of ['statusNote', 'faceImage', 'faceImageStoragePath'] as const) {
    if (typeof projected[field] === 'string') student[field] = projected[field] as string;
  }
  return student;
}

export async function readAttendanceStudentQuickProfile(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
): Promise<AttendanceStudentQuickProfileResponse> {
  requireRole(ctx, ['admin', 'office', 'teacher']);
  const requestedStudentId = String(req.query.studentId || '').trim();
  const classId = String(req.query.classId || '').trim();
  if (!requestedStudentId || !classId)
    throw withAuthzStatus('studentId and classId are required', 400);

  let classData: Record<string, unknown>;
  try {
    classData = await assertClassAccess(db, ctx, classId, 'read');
  } catch (error) {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (ctx.role === 'teacher' && (statusCode === 403 || statusCode === 404)) {
      throw withAuthzStatus('Student not found', 404);
    }
    throw error;
  }

  const { canonicalProfileId: studentId } = await resolveCanonicalStudentId(db, requestedStudentId);
  const studentSnap = await db.collection('students').doc(studentId).get();
  if (!studentSnap.exists) throw withAuthzStatus('Student not found', 404);
  const studentData = studentSnap.data() || {};
  const currentTerm = buildClassTerms({ id: classId, ...classData }).find((term) => term.isCurrent);
  if (!currentTerm?.startDate || !currentTerm.endDate) {
    throw withAuthzStatus('Class course not found', 404);
  }

  const enrollmentSnap = await db
    .collection('student_course_enrollments')
    .where('studentId', '==', studentId)
    .where('classId', '==', classId)
    .get();
  const enrollments = enrollmentSnap.docs.map((doc) => readStoredStudentCourseEnrollment(doc));
  const enrollment =
    enrollments.find(
      (row) => row.classId === classId && row.termStart === currentTerm?.startDate
    ) || null;
  const matchingJoin = readCourseJoins(studentData.courseJoins).find(
    (row) => row.classId === classId && row.termStart === currentTerm.startDate
  );
  const rosterEnrollment = enrollment && isOpenStudentCourseEnrollmentStatus(enrollment.status);
  if (String(studentData.classId || '') !== classId && !rosterEnrollment && !matchingJoin) {
    throw withAuthzStatus('Student not found', 404);
  }
  const attendanceEnrollment = enrollment;

  const [attendanceSnap, sessionSnap] = await Promise.all([
    db
      .collection('attendance')
      .where('studentId', '==', studentId)
      .orderBy('date', 'desc')
      .limit(5001)
      .get(),
    db
      .collection('class_sessions')
      .where('classId', '==', classId)
      .orderBy('date', 'asc')
      .limit(5001)
      .get(),
  ]);
  const attendanceTruncated = attendanceSnap.docs.length > 5_000;
  const classSessionsTruncated = sessionSnap.docs.length > 5_000;
  const attendance = attendanceSnap.docs
    .slice(0, 5_000)
    .map((doc) => doc.data() || {})
    .filter((row) => row.classId === classId && row.isVoided !== true)
    .map((row) => ({
      classId,
      date: String(row.date || ''),
      status: typeof row.status === 'string' ? row.status : undefined,
      permission: row.permission === true,
      minutesLate: Number(row.minutesLate || 0),
    }));
  const classSessions = sessionSnap.docs.slice(0, 5_000).map((doc) => {
    const row = doc.data() || {};
    return { classId, date: String(row.date || ''), status: String(row.status || '') };
  });

  const projected = projectStudent({ id: studentId, ...studentData }, 'directory');
  const result: AttendanceStudentQuickProfileResponse = {
    student: pickQuickProfileStudent(projected),
    class: { id: classId, name: String(classData.name || '') },
    attendance:
      attendanceTruncated || classSessionsTruncated
        ? null
        : calculateCurrentCourseAttendance({
            classData: { id: classId, ...classData },
            studentData,
            enrollment: attendanceEnrollment,
            attendance,
            classSessions,
          }),
    generatedAt: new Date().toISOString(),
  };

  if (ctx.role === 'admin') {
    const [summary, ledgerEvidence] = await Promise.all([
      buildAccountingStudentSummary(db, studentId),
      db.collection('course_fee_ledgers').where('studentId', '==', studentId).limit(1).get(),
    ]);
    result.finance = {
      hasLedgerData: ledgerEvidence.docs.length > 0,
      totalPaid: summary.totalPaid,
      totalOutstanding: summary.totalOutstanding,
    };
  }
  return result;
}
