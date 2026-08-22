// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api/apiClient';
import { readClassDetailData } from '../lib/api/frontendReadApi';
import { canReadClassAttendance, useAttendanceManager } from './useAttendanceManager';

vi.mock('../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'teacher-1' } },
}));

vi.mock('../lib/api/frontendReadApi', () => ({
  FRONTEND_READ_POLL_INTERVAL_MS: 15_000,
  readClassDetailData: vi.fn().mockResolvedValue({ attendance: [] }),
}));

vi.mock('../lib/api/apiClient', () => ({
  apiRequest: vi.fn(async (_url, options: { body?: { status?: string } }) => ({
    status: options.body?.status || 'present',
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readClassDetailData).mockResolvedValue({ attendance: [] } as any);
  vi.mocked(apiRequest).mockImplementation(
    async (_url, options: { body?: { status?: string } }) => ({
      status: options.body?.status || 'present',
    })
  );
});

describe('useAttendanceManager access scope', () => {
  it('allows office, teacher, and admin users to read class attendance', () => {
    expect(canReadClassAttendance({ role: 'office' } as any)).toBe(true);
    expect(canReadClassAttendance({ role: 'teacher' } as any)).toBe(true);
    expect(canReadClassAttendance({ role: 'admin' } as any)).toBe(true);
  });
});

describe('useAttendanceManager bulk present updates', () => {
  it('keeps every successful record in local state when explicit present toggles run together', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(apiRequest).mockImplementation(
      async (_url, options: { body?: { studentId?: string; status?: string } }) => {
        if (options.body?.studentId === 'student-2') {
          throw new Error('network hiccup');
        }
        return { status: options.body?.status || 'present' };
      }
    );

    const { result } = renderHook(() =>
      useAttendanceManager('class-1', { role: 'teacher' } as any)
    );

    await waitFor(() => expect(result.current.attendanceData).toEqual([]));

    await act(async () => {
      await Promise.allSettled([
        result.current.toggleAttendance('student-1', '2026-05-10', 'present'),
        result.current.toggleAttendance('student-2', '2026-05-10', 'present'),
      ]);
    });

    expect(result.current.attendanceData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class-1_student-1_2026-05-10',
          studentId: 'student-1',
          date: '2026-05-10',
          status: 'present',
        }),
      ])
    );
    expect(result.current.attendanceData).toHaveLength(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Attendance toggle failed, rolled back:',
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it('bulk marks attendance with one API call', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      updatedCount: 2,
      studentIds: ['s1', 's2'],
      status: 'present',
      skipped: { not_enrolled: [], on_leave: [] },
    });
    const { result } = renderHook(() =>
      useAttendanceManager('class-1', { uid: 'teacher-1', role: 'teacher' } as any)
    );

    await act(async () => {
      await result.current.bulkSetAttendance(['s1', 's2'], '2026-05-12', 'present');
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/attendance/bulk-toggle', {
      method: 'POST',
      body: {
        classId: 'class-1',
        date: '2026-05-12',
        status: 'present',
        studentIds: ['s1', 's2'],
      },
    });
  });

  it('passes eligibility override options in toggleAttendance API request', async () => {
    const { result } = renderHook(() =>
      useAttendanceManager('class-1', { role: 'teacher' } as any)
    );

    await act(async () => {
      await result.current.toggleAttendance('student-1', '2026-05-10', 'present', {
        eligibilityOverride: true,
        overrideReason: 'Attended during leave',
      });
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/attendance/toggle',
      expect.objectContaining({
        body: expect.objectContaining({
          classId: 'class-1',
          studentId: 'student-1',
          date: '2026-05-10',
          status: 'present',
          eligibilityOverride: true,
          overrideReason: 'Attended during leave',
        }),
      })
    );
  });

  it('re-throws error on toggle failure with status code and rolls back optimistic state', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error409 = Object.assign(new Error('Ineligible'), { status: 409 });
    vi.mocked(apiRequest).mockRejectedValue(error409);

    const { result } = renderHook(() =>
      useAttendanceManager('class-1', { role: 'teacher' } as any)
    );

    await expect(
      act(async () => {
        await result.current.toggleAttendance('student-1', '2026-05-10', 'present');
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(result.current.attendanceData).toEqual([]);
    consoleErrorSpy.mockRestore();
  });

  it('rolls back only skipped students on bulk set attendance', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      updatedCount: 1,
      studentIds: ['s1'],
      status: 'present',
      skipped: { not_enrolled: [], on_leave: ['s2'] },
    });

    const { result } = renderHook(() =>
      useAttendanceManager('class-1', { role: 'teacher' } as any)
    );
    await waitFor(() => expect(readClassDetailData).toHaveBeenCalled());

    let res: any;
    await act(async () => {
      res = await result.current.bulkSetAttendance(['s1', 's2'], '2026-05-10', 'present');
    });

    expect(res).toEqual({
      success: true,
      updatedCount: 1,
      studentIds: ['s1'],
      status: 'present',
      skipped: { not_enrolled: [], on_leave: ['s2'] },
    });

    expect(result.current.attendanceData).toEqual([
      expect.objectContaining({ studentId: 's1', date: '2026-05-10', status: 'present' }),
    ]);
  });

  it('refreshes the HTTP attendance projection when an older range is selected', async () => {
    const { result } = renderHook(() =>
      useAttendanceManager('class-1', { role: 'teacher' } as any)
    );

    await act(async () => {
      result.current.setAttendanceReadRange({ from: '2025-01-01', to: '2025-04-30' });
    });

    await waitFor(() => expect(readClassDetailData).toHaveBeenCalledTimes(2));
  });
});
