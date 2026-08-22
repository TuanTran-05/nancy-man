import { getScheduledClassDatesInRange } from '../../../../shared/classSchedule.js';
import {
  buildExpectedStudentSessions,
  calculateStudentAttendanceSummary,
  mergeExpectedSessionsWithAttendance,
  type AttendanceRecord,
} from '../../../../shared/studentAttendanceReport.js';
import { readCourseJoins, readLeavePeriods } from '../../../../shared/studentEnrollmentWindows.js';
import { buildClassTerms, type ClassLike } from '../../../../shared/studentEnrollmentTimeline.js';
import { createEligibilityResolver } from '../../../../shared/studentSessionEligibility.js';
import type { StudentCourseEnrollment } from '../../../../shared/studentCourseEnrollment.js';
import type { QuickProfileAttendanceSummary } from '../../../../shared/attendanceStudentQuickProfile.js';

export type CurrentCourseAttendanceInput = {
  classData: ClassLike & { holidays?: unknown; weeklySessions?: unknown; daysOfWeek?: unknown };
  studentData: Record<string, unknown>;
  enrollment: StudentCourseEnrollment | null;
  attendance: AttendanceRecord[];
  classSessions: Array<{ classId: string; date: string; status: string }>;
};

export function calculateCurrentCourseAttendance(
  input: CurrentCourseAttendanceInput
): QuickProfileAttendanceSummary | null {
  const term = buildClassTerms(input.classData).find((candidate) => candidate.isCurrent);
  if (!term || !term.startDate || !term.endDate || !term.schedule) return null;

  const daysOfWeek = term.schedule.weeklySessions.length
    ? term.schedule.weeklySessions
        .map((session) => Number((session as { dayOfWeek?: unknown }).dayOfWeek))
        .filter(Number.isFinite)
    : term.schedule.daysOfWeek;
  if (daysOfWeek.length === 0) return null;

  const holidays = new Set(term.schedule.holidays);
  const scheduledDates = getScheduledClassDatesInRange(
    {
      startDate: term.startDate,
      endDate: term.endDate,
      daysOfWeek,
      weeklySessions: term.schedule.weeklySessions,
    },
    term.startDate,
    term.endDate
  )
    .filter((date) => !holidays.has(date))
    .map((date) => ({ classId: input.classData.id, date }));

  const cancelled = new Set(
    input.classSessions
      .filter((session) => session.status === 'cancelled')
      .map((session) => `${session.classId}|${session.date}`)
  );
  const makeups = input.classSessions
    .filter(
      (session) =>
        session.status === 'makeup' &&
        session.date >= term.startDate &&
        session.date <= term.endDate &&
        !holidays.has(session.date)
    )
    .map(({ classId, date }) => ({ classId, date }));

  // Use Task 1's canonical precedence: the exact enrollment window overrides
  // legacy courseJoins and centre-wide enrollmentDate for this course.
  const canonicalCourseEnrollments = input.enrollment
    ? [{
        classId: input.enrollment.classId,
        termStart: input.enrollment.termStart,
        joinedAt: input.enrollment.joinedAt.slice(0, 10),
        endedAt: input.enrollment.endedAt?.slice(0, 10) ?? null,
      }]
    : [];

  const resolveEligibility = createEligibilityResolver({
    canonicalCourseEnrollments,
    courseJoins: readCourseJoins(input.studentData.courseJoins),
    leavePeriods: readLeavePeriods(input.studentData.leavePeriods),
    resolveTermStart: (classId, date) =>
      classId === input.classData.id && date >= term.startDate && date <= term.endDate
        ? term.startDate
        : null,
    enrollmentDate:
      typeof input.studentData.enrollmentDate === 'string'
        ? input.studentData.enrollmentDate.slice(0, 10)
        : null,
  });

  const expected = buildExpectedStudentSessions(
    scheduledDates,
    makeups,
    cancelled,
    resolveEligibility
  );
  // The quick profile summary is a count (attendedSessions / totalSessions).
  // Only eligible sessions count toward it; a real record on an ineligible date
  // (e.g. a student who showed up despite being on_leave) shows "present" on the
  // attendance tab but must not skew the rate — the student was not "on the hook"
  // for that session. The class attendance tab display uses all attendance.
  const eligibleAttendance = input.attendance.filter(
    (row) => resolveEligibility(row.date, row.classId) === 'eligible'
  );
  const rows = mergeExpectedSessionsWithAttendance(expected, eligibleAttendance);
  const summary = calculateStudentAttendanceSummary(rows);
  return {
    attendedSessions: summary.present + summary.late,
    totalSessions: summary.expectedSessions,
  };
}
