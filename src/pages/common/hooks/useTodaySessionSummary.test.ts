// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTodaySessionSummary } from './useTodaySessionSummary';
import type { Attendance, Student } from '../../../types';
import type { EligibilityResolver } from '../../../../shared/studentSessionEligibility';

describe('useTodaySessionSummary eligibility and real record counts', () => {
  const todayStr = '2026-05-10';

  it('excludes ineligible students from pending counter without excluding real records from absent/late counters', () => {
    const classroomStudents: Student[] = [
      { id: 's1', name: 'Student Eligible', enrollmentStatus: 'active' } as Student,
      { id: 's2', name: 'Student Not Enrolled', enrollmentStatus: 'active' } as Student,
      { id: 's3', name: 'Student On Leave', enrollmentStatus: 'on_leave' } as Student,
    ];

    // s2 is not enrolled yet, s3 is on leave, but s3 has a real absent record today!
    const eligibilityByStudent = new Map<string, EligibilityResolver>([
      ['s1', () => 'eligible' as const],
      ['s2', () => 'not_enrolled' as const],
      ['s3', () => 'on_leave' as const],
    ]);

    const todayAttendanceMap = new Map<string, Attendance>([
      ['s3', { id: 'a3', studentId: 's3', date: todayStr, status: 'absent' } as Attendance],
    ]);

    const { result } = renderHook(() =>
      useTodaySessionSummary({
        todayStr,
        classData: { id: 'class-1', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
        attendanceData: [...todayAttendanceMap.values()],
        attendanceTargetStudents: [classroomStudents[0]],
        todayAttendanceMap,
        riskByStudent: new Map(),
        overdueAssignmentCountByStudent: new Map(),
        classroomStudents,
        dailyReports: [],
        t: {},
        eligibilityByStudent,
      })
    );

    // Only s1 is unmarked and eligible -> pendingAttendanceCount === 1
    expect(result.current.todaySessionSummary.pendingAttendanceCount).toBe(1);

    // Real absent record for s3 is counted in absentCount -> absentCount === 1
    expect(result.current.todaySessionSummary.absentCount).toBe(1);
  });
});
