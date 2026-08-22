// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceStudentQuickProfileResponse } from '../../shared/attendanceStudentQuickProfile';

const fetchQuickProfile = vi.hoisted(() => vi.fn());
vi.mock('../lib/api/attendanceStudentQuickProfileApi', () => ({
  fetchAttendanceStudentQuickProfile: fetchQuickProfile,
}));

import { useAttendanceStudentQuickProfile } from './useAttendanceStudentQuickProfile';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('useAttendanceStudentQuickProfile', () => {
  beforeEach(() => fetchQuickProfile.mockReset());

  it('ignores an older response after another student is selected', async () => {
    const first = deferred<AttendanceStudentQuickProfileResponse>();
    const second = deferred<AttendanceStudentQuickProfileResponse>();
    fetchQuickProfile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ studentId }) =>
        useAttendanceStudentQuickProfile({ studentId, classId: 'class-1', enabled: true }),
      { initialProps: { studentId: 'student-1' } }
    );
    rerender({ studentId: 'student-2' });
    await act(async () =>
      second.resolve({ student: { id: 'student-2' } } as AttendanceStudentQuickProfileResponse)
    );
    await waitFor(() => expect(result.current.data?.student.id).toBe('student-2'));
    await act(async () =>
      first.resolve({ student: { id: 'student-1' } } as AttendanceStudentQuickProfileResponse)
    );
    expect(result.current.data?.student.id).toBe('student-2');
  });

  it('keeps an error visible and retries on demand', async () => {
    fetchQuickProfile
      .mockRejectedValueOnce(new Error('Profile unavailable'))
      .mockResolvedValueOnce({
        student: { id: 'student-1' },
      } as AttendanceStudentQuickProfileResponse);
    const { result } = renderHook(() =>
      useAttendanceStudentQuickProfile({
        studentId: 'student-1',
        classId: 'class-1',
        enabled: true,
      })
    );
    await waitFor(() => expect(result.current.error).toBe('Profile unavailable'));
    await act(async () => result.current.reload());
    expect(result.current.data?.student.id).toBe('student-1');
  });

  it('clears loading when disabled during an in-flight request', async () => {
    const pending = deferred<AttendanceStudentQuickProfileResponse>();
    fetchQuickProfile.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useAttendanceStudentQuickProfile({
          studentId: 'student-1',
          classId: 'class-1',
          enabled,
        }),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.loading).toBe(true));

    rerender({ enabled: false });

    expect(result.current.loading).toBe(false);
    await act(async () =>
      pending.resolve({ student: { id: 'student-1' } } as AttendanceStudentQuickProfileResponse)
    );
    expect(result.current.data).toBeNull();
  });
});
