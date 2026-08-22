import type { DocumentStore } from '@/server/db/documentStore.js';
import { isApiDateOnly } from '../../../../shared/dateTimeFormat.js';
import {
  makeStudentCourseEnrollmentId,
} from '../../../../shared/studentCourseEnrollment.js';
import { readStoredStudentCourseEnrollment } from '../student/courseEnrollmentRepository.js';
import { readCourseJoins, readLeavePeriods } from '../../../../shared/studentEnrollmentWindows.js';
import {
  createEligibilityResolver,
  type CanonicalCourseEnrollmentWindow,
  type SessionEligibility,
} from '../../../../shared/studentSessionEligibility.js';

export class AttendanceEligibilityError extends Error {
  readonly statusCode = 409;
  readonly errorCode = 'attendance_ineligible';

  constructor(readonly eligibility: Exclude<SessionEligibility, 'eligible'>) {
    super(`Attendance cannot be created for an ${eligibility} session`);
    this.name = 'AttendanceEligibilityError';
  }
}

export type AttendanceStudentEligibilityResolution = {
  eligibility: SessionEligibility;
  hasClassMembership: boolean;
};

export async function resolveAttendanceEligibilityBatch(
  db: DocumentStore,
  input: {
    classId: string;
    termStart: string | null;
    termEnd: string | null;
    date: string;
    studentsById: Map<string, Record<string, unknown>>;
  }
): Promise<Map<string, AttendanceStudentEligibilityResolution>> {
  const ids = [...input.studentsById.keys()];
  const refs = input.termStart
    ? ids.map((studentId) =>
        db
          .collection('student_course_enrollments')
          .doc(makeStudentCourseEnrollmentId(studentId, input.classId, input.termStart!))
      )
    : [];

  const snaps = refs.length ? await db.getAll(...refs) : [];
  const enrollmentByStudent = new Map<string, CanonicalCourseEnrollmentWindow>();

  snaps.forEach((snap, index) => {
    if (!snap.exists) return;
    try {
      const enrollment = readStoredStudentCourseEnrollment(snap);
      const studentId = ids[index];
      if (
        enrollment.studentId === studentId &&
        enrollment.classId === input.classId &&
        enrollment.termStart === input.termStart
      ) {
        enrollmentByStudent.set(studentId, toSessionEnrollmentView(enrollment));
      }
    } catch {
      // Malformed canonical evidence falls back to profile history.
    }
  });

  return new Map(
    ids.map((studentId) => {
      const student = input.studentsById.get(studentId) || {};
      const canonical = enrollmentByStudent.get(studentId);
      const courseJoins = readCourseJoins(student.courseJoins);
      const hasExactLegacyJoin = courseJoins.some(
        (join) =>
          input.termStart !== null &&
          join.classId === input.classId &&
          join.termStart === input.termStart
      );
      const resolve = createEligibilityResolver({
        canonicalCourseEnrollments: canonical ? [canonical] : [],
        courseJoins,
        leavePeriods: readLeavePeriods(student.leavePeriods),
        enrollmentDate: readDateFloor(student.enrollmentDate),
        resolveTermStart: (classId, date) =>
          classId === input.classId &&
          input.termStart !== null &&
          date >= input.termStart &&
          (!input.termEnd || date <= input.termEnd)
            ? input.termStart
            : null,
      });

      return [
        studentId,
        {
          eligibility: resolve(input.date, input.classId),
          hasClassMembership:
            Boolean(canonical) ||
            hasExactLegacyJoin ||
            String(student.classId || '') === input.classId,
        },
      ] as const;
    })
  );
}

function readDateFloor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return isApiDateOnly(date) ? date : null;
}

function toSessionEnrollmentView(
  enrollment: ReturnType<typeof readStoredStudentCourseEnrollment>
): CanonicalCourseEnrollmentWindow {
  return {
    classId: enrollment.classId,
    termStart: enrollment.termStart,
    joinedAt: enrollment.joinedAt.slice(0, 10),
    endedAt: enrollment.endedAt?.slice(0, 10) ?? null,
  };
}
