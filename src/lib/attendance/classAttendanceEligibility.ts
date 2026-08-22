import { isApiDateOnly } from '../../../shared/dateTimeFormat';
import { readCourseJoins, readLeavePeriods } from '../../../shared/studentEnrollmentWindows';
import {
  createEligibilityResolver,
  type SessionEligibility,
  type EligibilityResolver,
} from '../../../shared/studentSessionEligibility';
import {
  resolveAttendanceCellStatus,
  type AttendanceStatus,
} from '../../../shared/studentAttendanceReport';
import type { Attendance, Student } from '../../types';

export type AttendanceTermScope = {
  classId: string;
  termStart: string;
  termEnd: string | null;
};

export function attendanceCellKey(studentId: string, date: string) {
  return `${studentId}|${date}`;
}

export function buildAttendanceIndex(records: Attendance[]): Map<string, Attendance> {
  return new Map(
    records
      .filter((record) => (record as Attendance & { isVoided?: boolean }).isVoided !== true)
      .map((record) => [attendanceCellKey(record.studentId, record.date), record])
  );
}

export function buildStudentEligibilityResolvers(
  students: Student[],
  scope: AttendanceTermScope
): Map<string, EligibilityResolver> {
  return new Map(
    students.map((student) => {
      const canonical = student.attendanceEnrollment;
      const hasUsableCanonicalWindow =
        canonical?.classId === scope.classId &&
        canonical.termStart === scope.termStart &&
        isApiDateOnly(canonical.joinedAt.slice(0, 10)) &&
        (!canonical.endedAt || isApiDateOnly(canonical.endedAt.slice(0, 10)));
      const resolve = createEligibilityResolver({
        canonicalCourseEnrollments: hasUsableCanonicalWindow
          ? [
              {
                classId: canonical!.classId,
                termStart: canonical!.termStart,
                joinedAt: canonical!.joinedAt.slice(0, 10),
                endedAt: canonical!.endedAt?.slice(0, 10) ?? null,
              },
            ]
          : [],
        courseJoins: readCourseJoins(student.courseJoins),
        leavePeriods: readLeavePeriods(student.leavePeriods),
        enrollmentDate:
          student.enrollmentDate && isApiDateOnly(student.enrollmentDate.slice(0, 10))
            ? student.enrollmentDate.slice(0, 10)
            : null,
        resolveTermStart: (classId, date) =>
          classId === scope.classId &&
          date >= scope.termStart &&
          (!scope.termEnd || date <= scope.termEnd)
            ? scope.termStart
            : null,
      });
      return [student.id, resolve] as const;
    })
  );
}

export function resolveClassAttendanceCell(input: {
  studentId: string;
  date: string;
  classId: string;
  attendanceByCell: Map<string, Attendance>;
  eligibilityByStudent: Map<string, EligibilityResolver>;
}): AttendanceStatus {
  const attendance = input.attendanceByCell.get(attendanceCellKey(input.studentId, input.date));
  const eligibility =
    input.eligibilityByStudent.get(input.studentId)?.(input.date, input.classId) ?? 'eligible';
  return resolveAttendanceCellStatus({ attendance, eligibility });
}
