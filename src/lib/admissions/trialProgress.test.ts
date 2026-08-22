import { describe, expect, it } from 'vitest';
import { countTrialAttendance, trialNeedsTeacherReview } from './trialProgress';

describe('trial progress', () => {
  it('counts unique attended trial dates after the trial starts', () => {
    const student = {
      id: 'student-1',
      classId: 'class-1',
      studentLifecycle: 'trial',
      trialStartedAt: '2026-05-20T00:00:00.000Z',
      trialRequiredSessions: 2,
    } as any;
    const attendance = [
      { studentId: 'student-1', classId: 'class-1', date: '2026-05-19', status: 'present' },
      { studentId: 'student-1', classId: 'class-1', date: '2026-05-20', status: 'present' },
      { studentId: 'student-1', classId: 'class-1', date: '2026-05-20', status: 'late' },
      { studentId: 'student-1', classId: 'class-1', date: '2026-05-22', status: 'late' },
    ] as any[];

    expect(countTrialAttendance(student, attendance)).toBe(2);
    expect(trialNeedsTeacherReview(student, attendance)).toBe(true);
  });
});
