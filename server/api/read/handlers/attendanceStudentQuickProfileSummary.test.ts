import { describe, expect, it } from 'vitest';
import { calculateCurrentCourseAttendance } from './attendanceStudentQuickProfileSummary.js';

const classData = {
  id: 'class-1',
  name: 'Movers 2',
  startDate: '2026-08-03',
  endDate: '2026-08-31',
  daysOfWeek: [1, 3],
  weeklySessions: [],
  holidays: ['2026-08-19'],
};

const studentData = {
  enrollmentDate: '2026-08-01',
  courseJoins: [{ classId: 'class-1', termStart: '2026-08-03', joinedAt: '2026-08-10' }],
  // until is exclusive (the eligible return date), so '2026-08-27' covers Aug 24 and Aug 26.
  leavePeriods: [{ classId: 'class-1', from: '2026-08-24', until: '2026-08-27' }],
};

const enrollment = {
  id: 'enrollment-1',
  studentId: 'student-1',
  classId: 'class-1',
  termStart: '2026-08-03',
  termEnd: '2026-08-31',
  status: 'active' as const,
  joinedAt: '2026-08-10',
  endedAt: null,
  statusReason: null,
  source: 'system' as const,
  confidence: 'confirmed' as const,
  statusChangedAt: '2026-08-10T00:00:00.000Z',
  statusChangedBy: 'admin-1',
  confirmedAt: '2026-08-10T00:00:00.000Z',
  confirmedBy: 'admin-1',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('calculateCurrentCourseAttendance', () => {
  it('counts present and late as attended across the eligible full course', () => {
    expect(
      calculateCurrentCourseAttendance({
        classData,
        studentData,
        enrollment,
        attendance: [
          { classId: 'class-1', date: '2026-08-10', status: 'present' },
          { classId: 'class-1', date: '2026-08-12', status: 'late' },
          { classId: 'class-1', date: '2026-08-17', status: 'absent' },
          { classId: 'class-1', date: '2026-08-24', status: 'present' },
        ],
        classSessions: [],
      })
    ).toEqual({ attendedSessions: 2, totalSessions: 4 });
  });

  it('lets the canonical enrollment override an earlier legacy course join', () => {
    expect(
      calculateCurrentCourseAttendance({
        classData,
        studentData: {
          enrollmentDate: '2026-08-01',
          courseJoins: [{ classId: 'class-1', termStart: '2026-08-03', joinedAt: '2026-08-03' }],
          leavePeriods: [],
        },
        enrollment: { ...enrollment, joinedAt: '2026-08-10' },
        attendance: [
          { classId: 'class-1', date: '2026-08-03', status: 'present' },
          { classId: 'class-1', date: '2026-08-10', status: 'present' },
        ],
        classSessions: [],
      })
    ).toEqual({ attendedSessions: 1, totalSessions: 6 });
  });

  it('adds makeup sessions, removes cancelled sessions and deduplicates dates', () => {
    expect(
      calculateCurrentCourseAttendance({
        classData,
        studentData: { courseJoins: [], leavePeriods: [] },
        enrollment: { ...enrollment, joinedAt: '2026-08-03' },
        attendance: [
          { classId: 'class-1', date: '2026-08-08', status: 'present' },
          { classId: 'class-1', date: '2026-08-10', status: 'present' },
        ],
        classSessions: [
          { classId: 'class-1', date: '2026-08-08', status: 'makeup' },
          { classId: 'class-1', date: '2026-08-10', status: 'cancelled' },
        ],
      })
    ).toEqual({ attendedSessions: 1, totalSessions: 8 });
  });

  it('excludes dates after a closed enrollment', () => {
    const result = calculateCurrentCourseAttendance({
      classData,
      studentData: { courseJoins: [], leavePeriods: [] },
      enrollment: { ...enrollment, joinedAt: '2026-08-03', endedAt: '2026-08-17' },
      attendance: [{ classId: 'class-1', date: '2026-08-24', status: 'present' }],
      classSessions: [],
    });
    expect(result).toEqual({ attendedSessions: 0, totalSessions: 5 });
  });

  it('returns null when the current course has no reliable schedule', () => {
    expect(
      calculateCurrentCourseAttendance({
        classData: { ...classData, daysOfWeek: [], weeklySessions: [] },
        studentData,
        enrollment,
        attendance: [],
        classSessions: [],
      })
    ).toBeNull();
  });

  it('returns null for an open-ended current course because the full denominator is unknown', () => {
    expect(
      calculateCurrentCourseAttendance({
        classData: { ...classData, endDate: '' },
        studentData,
        enrollment,
        attendance: [],
        classSessions: [],
      })
    ).toBeNull();
  });
});
