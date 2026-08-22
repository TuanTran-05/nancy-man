import type { SafeStudent, Attendance, Evaluation, StudentClassroomRisk } from '../../types';

export function calculateStudentRisk(
  classroomStudents: SafeStudent[],
  attendanceData: Attendance[],
  fourteenDayStr: string,
  todayStr: string,
  overdueAssignmentCountByStudent: Map<string, number>,
  evaluations: Evaluation[],
  t: {
    onBreak: string;
    absentReason: string;
    overdueReason: string;
    latestScore: string;
    lateReason: string;
    oneOverdue: string;
    scoreDrop: string;
  }
): Map<string, StudentClassroomRisk> {
  const riskByStudent = new Map<string, StudentClassroomRisk>();
  classroomStudents.forEach((student) => {
    const recentAttendance = attendanceData.filter(
      (attendance) =>
        attendance.studentId === student.id &&
        attendance.date >= fourteenDayStr &&
        attendance.date <= todayStr
    );
    const absent14d = recentAttendance.filter(
      (attendance) => attendance.status === 'absent'
    ).length;
    const late14d = recentAttendance.filter((attendance) => attendance.status === 'late').length;
    const overdueAssignmentsCount = overdueAssignmentCountByStudent.get(student.id) || 0;
    const studentEvaluations = evaluations
      .filter((evaluation) => evaluation.studentId === student.id)
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    const latestEvaluation = studentEvaluations[0];
    const previousEvaluation = studentEvaluations[1];
    const latestScore =
      typeof latestEvaluation?.finalScore === 'number'
        ? latestEvaluation.finalScore
        : (latestEvaluation?.totalScore ?? null);
    const previousScore =
      typeof previousEvaluation?.finalScore === 'number'
        ? previousEvaluation.finalScore
        : (previousEvaluation?.totalScore ?? null);
    const scoreDelta =
      latestScore !== null && previousScore !== null
        ? Number((latestScore - previousScore).toFixed(1))
        : null;

    const reasons: string[] = [];
    let level: StudentClassroomRisk['level'] = 'low';

    if (student.enrollmentStatus === 'on_leave') reasons.push(t.onBreak);
    if (absent14d >= 2) reasons.push(t.absentReason.replace('{count}', String(absent14d)));
    if (overdueAssignmentsCount >= 2)
      reasons.push(t.overdueReason.replace('{count}', String(overdueAssignmentsCount)));
    if (latestScore !== null && latestScore < 65)
      reasons.push(t.latestScore.replace('{score}', (latestScore / 10).toFixed(1)));

    if (reasons.length > 0) {
      level = 'high';
    } else {
      if (late14d >= 2) reasons.push(t.lateReason.replace('{count}', String(late14d)));
      if (overdueAssignmentsCount === 1) reasons.push(t.oneOverdue);
      if (latestScore !== null && latestScore >= 65 && latestScore <= 79) {
        reasons.push(t.latestScore.replace('{score}', (latestScore / 10).toFixed(1)));
      }
      if (scoreDelta !== null && scoreDelta <= -10) {
        reasons.push(t.scoreDrop.replace('{points}', Math.abs(scoreDelta).toFixed(0)));
      }
      if (reasons.length > 0) level = 'medium';
    }

    riskByStudent.set(student.id, {
      studentId: student.id,
      level,
      reasons,
      absent14d,
      late14d,
      overdueAssignments: overdueAssignmentsCount,
      latestScore,
      scoreDelta,
    });
  });
  return riskByStudent;
}
