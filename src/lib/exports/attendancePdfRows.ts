import {
  buildAttendanceIndex,
  buildStudentEligibilityResolvers,
  resolveClassAttendanceCell,
  type AttendanceTermScope,
} from '../attendance/classAttendanceEligibility';
import type { Attendance, Student } from '../../types';
import type { AttendanceStatus } from '../../../shared/studentAttendanceReport';

export type AttendancePdfResolvedRow = {
  student: Student;
  cells: string[];
};

export type AttendancePdfRowsInput = {
  students: Student[];
  dates: string[];
  attendance: Attendance[];
  termScope: AttendanceTermScope;
  codes: {
    present: string;
    absent: string;
    late: string;
    notEnrolled: string;
    onLeave: string;
  };
  legendLabels: { notEnrolled: string; onLeave: string };
};

export function buildAttendancePdfRows(input: AttendancePdfRowsInput): {
  rows: AttendancePdfResolvedRow[];
  legend: string[];
} {
  const attendanceByCell = buildAttendanceIndex(input.attendance);
  const eligibilityByStudent = buildStudentEligibilityResolvers(input.students, input.termScope);

  const codeForStatus: Record<AttendanceStatus, string> = {
    present: input.codes.present,
    absent: input.codes.absent,
    late: input.codes.late,
    not_enrolled: input.codes.notEnrolled,
    on_leave: input.codes.onLeave,
    unmarked: '',
  };

  const rows: AttendancePdfResolvedRow[] = input.students.map((student) => {
    const cells = input.dates.map((date) => {
      const cellStatus = resolveClassAttendanceCell({
        studentId: student.id,
        date,
        classId: input.termScope.classId,
        attendanceByCell,
        eligibilityByStudent,
      });
      return codeForStatus[cellStatus] ?? '';
    });
    return { student, cells };
  });

  return {
    rows,
    legend: [input.legendLabels.notEnrolled, input.legendLabels.onLeave],
  };
}
