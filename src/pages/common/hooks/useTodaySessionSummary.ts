import { useMemo } from 'react';
import { getVNDate } from '../../../lib/core/utils';
import { Student, Attendance, ClassSessionSummary, StudentClassroomRisk } from '../../../types';
import { resolveAttendanceCellStatus } from '../../../../shared/studentAttendanceReport';
import type { EligibilityResolver } from '../../../../shared/studentSessionEligibility';

export function useTodaySessionSummary({
  todayStr,
  classData,
  attendanceData,
  attendanceTargetStudents,
  todayAttendanceMap,
  riskByStudent,
  overdueAssignmentCountByStudent,
  classroomStudents,
  dailyReports,
  t,
  eligibilityByStudent,
}: {
  todayStr: string;
  classData: any;
  attendanceData: Attendance[];
  attendanceTargetStudents: Student[];
  todayAttendanceMap: Map<string, Attendance>;
  riskByStudent: Map<string, StudentClassroomRisk>;
  overdueAssignmentCountByStudent: Map<string, number>;
  classroomStudents: Student[];
  dailyReports: any[];
  t: any;
  eligibilityByStudent?: Map<string, EligibilityResolver>;
}) {
  const isTodayClassDay = useMemo(() => {
    return classData?.daysOfWeek?.includes(getVNDate().getDay());
  }, [classData?.daysOfWeek]);

  const hasMultipleAttendanceToday = useMemo(() => {
    return attendanceData.filter((a) => a.date === todayStr).length > 0;
  }, [attendanceData, todayStr]);

  const todaySessionSummary = useMemo<ClassSessionSummary>(() => {
    const pendingAttendanceCount =
      isTodayClassDay || hasMultipleAttendanceToday
        ? classroomStudents.filter((student) => {
            const attendance = todayAttendanceMap.get(student.id);
            const eligibility =
              eligibilityByStudent?.get(student.id)?.(todayStr, classData?.id || '') ?? 'eligible';
            return resolveAttendanceCellStatus({ attendance, eligibility }) === 'unmarked';
          }).length
        : 0;

    const summary: ClassSessionSummary = {
      date: todayStr,
      pendingAttendanceCount,
      absentCount: classroomStudents.filter(
        (student) => todayAttendanceMap.get(student.id)?.status === 'absent'
      ).length,
      lateCount: classroomStudents.filter(
        (student) => todayAttendanceMap.get(student.id)?.status === 'late'
      ).length,
      overdueAssignmentStudentCount: classroomStudents.filter(
        (student) => (overdueAssignmentCountByStudent.get(student.id) || 0) > 0
      ).length,
      riskStudentCount: classroomStudents.filter((student) => {
        const risk = riskByStudent.get(student.id);
        return risk && risk.level !== 'low';
      }).length,
      completionState: 'pending_attendance',
    };

    const hasTodayReport = dailyReports.some((report) => report.date === todayStr);
    summary.completionState =
      summary.pendingAttendanceCount > 0
        ? 'pending_attendance'
        : hasTodayReport || (todayAttendanceMap.size > 0 && !isTodayClassDay)
          ? 'completed'
          : todayAttendanceMap.size > 0
            ? 'attendance_done'
            : 'completed';

    if (!isTodayClassDay && todayAttendanceMap.size === 0) {
      summary.completionState = 'completed';
    }

    return summary;
  }, [
    todayStr,
    isTodayClassDay,
    hasMultipleAttendanceToday,
    classroomStudents,
    todayAttendanceMap,
    eligibilityByStudent,
    classData?.id,
    overdueAssignmentCountByStudent,
    riskByStudent,
    dailyReports,
  ]);

  return {
    isTodayClassDay,
    hasMultipleAttendanceToday,
    todaySessionSummary,
  };
}
