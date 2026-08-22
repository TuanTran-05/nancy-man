// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/apiClient';
import { selectClassDetailRosterStudents, showAttendanceBulkSkippedToast } from './ClassDetail';

describe('ClassDetail attendance eligibility conflict recovery', () => {
  it('keeps an enrollment-backed active student whose profile still says promoted', () => {
    const students = selectClassDetailRosterStudents(
      [
        {
          id: 'enrolled-only',
          name: 'Enrollment Backed Student',
          classId: 'class-g7',
          enrollmentStatus: 'promoted',
          studentLifecycle: 'archived',
          attendanceEnrollment: {
            id: 'enrollment-current',
            classId: 'class-g7',
            termStart: '2026-07-01',
            termEnd: '2026-12-31',
            joinedAt: '2026-07-01',
            endedAt: null,
            status: 'active',
          },
        } as any,
      ],
      'class-g7',
      false,
      false
    );

    expect(students.map((student) => student.id)).toEqual(['enrolled-only']);
  });

  it('identifies 409 ineligible conflict errors correctly', () => {
    const err = new ApiError('Conflict', 409, {
      errorCode: 'attendance_ineligible',
      eligibility: 'on_leave',
    });

    expect(err.status).toBe(409);
    expect((err.data as any)?.errorCode).toBe('attendance_ineligible');
  });

  it('notifies with the combined bulk-skip count', () => {
    const skipped = { not_enrolled: ['s1'], on_leave: ['s2'] };
    const notify = vi.fn();

    showAttendanceBulkSkippedToast(skipped, 'Skipped {count} students', notify);

    expect(notify).toHaveBeenCalledWith('Skipped 2 students', { icon: 'ℹ️' });
  });

  it('does not notify when the bulk operation skips nobody', () => {
    const notify = vi.fn();

    showAttendanceBulkSkippedToast(
      { not_enrolled: [], on_leave: [] },
      'Skipped {count} students',
      notify
    );

    expect(notify).not.toHaveBeenCalled();
  });
});
