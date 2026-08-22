import { describe, expect, it } from 'vitest';
import {
  TEACHER_ATTENDANCE_PAYROLL_START_DATE,
  getEffectiveTeacherIdForSession,
  getTeacherAttendanceDisplayStatus,
  shouldCountSessionForPayroll,
} from './teacherAttendance';

describe('teacher attendance payroll rules', () => {
  it('uses a fixed rollout date for the first clean payroll month', () => {
    expect(TEACHER_ATTENDANCE_PAYROLL_START_DATE).toBe('2026-06-01');
  });

  it('keeps legacy default-taught behavior before rollout', () => {
    expect(
      shouldCountSessionForPayroll({
        date: '2026-05-31',
        sessionStatus: 'taught',
        teacherAttendanceStatus: undefined,
        isScheduledDate: true,
      })
    ).toBe(true);
  });

  it('requires present status from rollout onward', () => {
    expect(
      shouldCountSessionForPayroll({
        date: '2026-06-01',
        sessionStatus: 'taught',
        teacherAttendanceStatus: 'present',
        isScheduledDate: true,
      })
    ).toBe(true);
    expect(
      shouldCountSessionForPayroll({
        date: '2026-06-01',
        sessionStatus: 'taught',
        teacherAttendanceStatus: 'absent',
        isScheduledDate: true,
      })
    ).toBe(false);
    expect(
      shouldCountSessionForPayroll({
        date: '2026-06-01',
        sessionStatus: 'taught',
        teacherAttendanceStatus: undefined,
        isScheduledDate: true,
      })
    ).toBe(false);
  });

  it('never counts cancelled sessions', () => {
    expect(
      shouldCountSessionForPayroll({
        date: '2026-06-01',
        sessionStatus: 'cancelled',
        teacherAttendanceStatus: 'present',
        isScheduledDate: true,
      })
    ).toBe(false);
  });

  it('derives pending display state when no teacher attendance status exists', () => {
    expect(getTeacherAttendanceDisplayStatus(undefined)).toBe('pending');
    expect(getTeacherAttendanceDisplayStatus('present')).toBe('present');
    expect(getTeacherAttendanceDisplayStatus('absent')).toBe('absent');
  });

  it('resolves the effective teacher with accepted substitute first', () => {
    expect(
      getEffectiveTeacherIdForSession({
        acceptedSubstituteTeacherId: 'teacher-2',
        sessionTeacherId: 'teacher-1',
        classTeacherId: 'teacher-0',
      })
    ).toBe('teacher-2');

    expect(
      getEffectiveTeacherIdForSession({
        acceptedSubstituteTeacherId: '',
        sessionTeacherId: 'teacher-1',
        classTeacherId: 'teacher-0',
      })
    ).toBe('teacher-1');

    expect(
      getEffectiveTeacherIdForSession({
        acceptedSubstituteTeacherId: undefined,
        sessionTeacherId: undefined,
        classTeacherId: 'teacher-0',
      })
    ).toBe('teacher-0');

    expect(
      getEffectiveTeacherIdForSession({
        acceptedSubstituteTeacherId: '   ',
        sessionTeacherId: '  teacher-1  ',
        classTeacherId: 'teacher-0',
      })
    ).toBe('teacher-1');
  });
});
