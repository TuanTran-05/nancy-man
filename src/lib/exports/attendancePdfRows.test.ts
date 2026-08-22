import { describe, expect, it } from 'vitest';
import { buildAttendancePdfRows } from './attendancePdfRows';
import type { Attendance, Student } from '../../types';

describe('attendancePdfRows', () => {
  it('resolves cell codes and legend for eligibility-aware export rows', () => {
    const result = buildAttendancePdfRows({
      students: [
        {
          id: 'mid-course',
          name: 'Mid Course',
          studentId: 'HS001',
          classId: 'class-1',
          courseJoins: [{ classId: 'class-1', termStart: '2026-05-01', joinedAt: '2026-05-20' }],
        } as Student,
        {
          id: 'leave',
          name: 'Leave Student',
          studentId: 'HS002',
          classId: 'class-1',
          leavePeriods: [{ from: '2026-05-01', until: '2026-05-20', classId: 'class-1' }],
        } as Student,
        {
          id: 'unmarked',
          name: 'Unmarked Student',
          studentId: 'HS003',
          classId: 'class-1',
        } as Student,
      ],
      dates: ['2026-05-10'],
      attendance: [],
      termScope: { classId: 'class-1', termStart: '2026-05-01', termEnd: '2026-08-31' },
      codes: { present: 'P', absent: 'A', late: 'L', notEnrolled: 'CNI', onLeave: 'TN' },
      legendLabels: {
        notEnrolled: 'CNI = Chưa nhập học',
        onLeave: 'TN = Tạm nghỉ',
      },
    });

    expect(result.rows.map((row) => row.cells[0])).toEqual(['CNI', 'TN', '']);
    expect(result.legend).toContain('CNI = Chưa nhập học');
    expect(result.legend).toContain('TN = Tạm nghỉ');
  });

  it('exports real attendance record status even during leave period', () => {
    const result = buildAttendancePdfRows({
      students: [
        {
          id: 'leave-attended',
          name: 'Leave Attended',
          studentId: 'HS004',
          classId: 'class-1',
          leavePeriods: [{ from: '2026-05-01', until: '2026-05-20', classId: 'class-1' }],
        } as Student,
      ],
      dates: ['2026-05-10'],
      attendance: [
        {
          id: 'a1',
          studentId: 'leave-attended',
          classId: 'class-1',
          date: '2026-05-10',
          status: 'present',
        } as Attendance,
      ],
      termScope: { classId: 'class-1', termStart: '2026-05-01', termEnd: '2026-08-31' },
      codes: { present: 'P', absent: 'A', late: 'L', notEnrolled: 'CNI', onLeave: 'TN' },
      legendLabels: {
        notEnrolled: 'CNI = Chưa nhập học',
        onLeave: 'TN = Tạm nghỉ',
      },
    });

    expect(result.rows[0].cells[0]).toBe('P');
  });
});
