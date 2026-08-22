import { describe, expect, it } from 'vitest';
import {
  buildAttendanceIndex,
  buildStudentEligibilityResolvers,
  resolveClassAttendanceCell,
} from './classAttendanceEligibility';
import type { Attendance, Student } from '../../types';

describe('classAttendanceEligibility', () => {
  const scope = { classId: 'class-1', termStart: '2026-05-01', termEnd: '2026-08-31' };

  it('builds student eligibility resolvers respecting canonical joinedAt and endedAt', () => {
    const resolvers = buildStudentEligibilityResolvers(
      [
        {
          id: 'student-1',
          name: 'Student One',
          studentId: 'HS001',
          classId: 'class-1',
          attendanceEnrollment: {
            id: 'enrollment-1',
            classId: 'class-1',
            termStart: '2026-05-01',
            termEnd: '2026-08-31',
            joinedAt: '2026-05-20',
            endedAt: '2026-07-31',
            status: 'active',
          },
          courseJoins: [{ classId: 'class-1', termStart: '2026-05-01', joinedAt: '2026-05-01' }],
        } as Student,
      ],
      scope
    );

    const resolve = resolvers.get('student-1')!;
    expect(resolve('2026-05-10', 'class-1')).toBe('not_enrolled');
    expect(resolve('2026-05-25', 'class-1')).toBe('eligible');
    expect(resolve('2026-08-01', 'class-1')).toBe('not_enrolled');
  });

  it('builds attendance index ignoring voided records', () => {
    const records: Attendance[] = [
      {
        id: 'a1',
        studentId: 'student-1',
        classId: 'class-1',
        date: '2026-05-10',
        status: 'present',
      } as Attendance,
      {
        id: 'a2',
        studentId: 'student-1',
        classId: 'class-1',
        date: '2026-05-11',
        status: 'absent',
        isVoided: true,
      } as any,
    ];

    const index = buildAttendanceIndex(records);
    expect(index.size).toBe(1);
    expect(index.has('student-1|2026-05-10')).toBe(true);
    expect(index.has('student-1|2026-05-11')).toBe(false);
  });

  it('resolves real records over ineligibility in resolveClassAttendanceCell', () => {
    const resolvers = buildStudentEligibilityResolvers(
      [
        {
          id: 'student-1',
          classId: 'class-1',
          leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
        } as Student,
      ],
      scope
    );

    const records: Attendance[] = [
      {
        id: 'a1',
        studentId: 'student-1',
        classId: 'class-1',
        date: '2026-05-10',
        status: 'present',
      } as Attendance,
    ];

    const attendanceByCell = buildAttendanceIndex(records);

    // Real record present wins even during leave
    expect(
      resolveClassAttendanceCell({
        studentId: 'student-1',
        date: '2026-05-10',
        classId: 'class-1',
        attendanceByCell,
        eligibilityByStudent: resolvers,
      })
    ).toBe('present');

    // Without record, resolves on_leave
    expect(
      resolveClassAttendanceCell({
        studentId: 'student-1',
        date: '2026-05-12',
        classId: 'class-1',
        attendanceByCell,
        eligibilityByStudent: resolvers,
      })
    ).toBe('on_leave');
  });
});
