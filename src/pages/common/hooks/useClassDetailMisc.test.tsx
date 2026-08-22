// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClassDetailMisc } from './useClassDetailMisc';
import { ApiError, apiRequest } from '../../../lib/api/apiClient';
import { readCalendarReferences } from '../../../lib/api/frontendReadApi';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'admin-1' } },
}));

vi.mock('../../../lib/api/frontendReadApi', () => ({
  FRONTEND_READ_POLL_INTERVAL_MS: 15_000,
  readCalendarReferences: vi.fn(),
}));

vi.mock('../../../lib/api/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api/apiClient')>(
    '../../../lib/api/apiClient'
  );
  return { ...actual, apiRequest: vi.fn() };
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fakeSubmitEvent() {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent;
}

function renderClassDetailMisc(onCourseClosingRefresh = vi.fn().mockResolvedValue(undefined)) {
  const view = renderHook(() =>
    useClassDetailMisc({
      classId: 'class-1',
      classData: { startDate: '2026-06-01', endDate: '2026-06-30', terms: [] },
      setClassData: vi.fn(),
      profile: { uid: 'admin-1', role: 'admin' },
      todayStr: '2026-07-01',
      todayAttendanceMap: new Map(),
      isAttendancePending: () => false,
      onCourseClosingRefresh,
      t: { courseResetSuccess: 'ok', courseResetError: 'generic reset error' },
    })
  );
  return { ...view, onCourseClosingRefresh };
}

function resetBodyOf(callIndex: number) {
  return (vi.mocked(apiRequest).mock.calls[callIndex][1] as { body: Record<string, unknown> }).body;
}

describe('useClassDetailMisc reset operation identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readCalendarReferences).mockResolvedValue({
      classes: [],
      attendance: [],
      attendanceCounts: {},
      systemHolidays: [],
    });
  });

  it('sends an RFC 4122 UUID operationId on the first submit', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true } as never);
    const { result } = renderClassDetailMisc();

    await act(async () => {
      await result.current.handleResetClass(fakeSubmitEvent());
    });

    expect(resetBodyOf(0).operationId).toEqual(expect.stringMatching(UUID_PATTERN));
  });

  it('reuses the same operationId after a failed retry', async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new ApiError('Request timed out', 504, null))
      .mockResolvedValueOnce({ success: true } as never);
    const { result } = renderClassDetailMisc();

    await act(async () => {
      await result.current.handleResetClass(fakeSubmitEvent());
    });
    await act(async () => {
      await result.current.handleResetClass(fakeSubmitEvent());
    });

    expect(resetBodyOf(0).operationId).toBe(resetBodyOf(1).operationId);
  });

  it('produces a valid UUID when crypto.randomUUID is unavailable', async () => {
    const originalRandomUUID = globalThis.crypto?.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    vi.mocked(apiRequest).mockResolvedValue({ success: true } as never);

    try {
      const { result } = renderClassDetailMisc();
      await act(async () => {
        await result.current.handleResetClass(fakeSubmitEvent());
      });
      expect(resetBodyOf(0).operationId).toEqual(expect.stringMatching(UUID_PATTERN));
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: originalRandomUUID,
      });
    }
  });

  it('issues a fresh operationId for a later reset after a success', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true } as never);
    const { result } = renderClassDetailMisc();

    await act(async () => {
      await result.current.handleResetClass(fakeSubmitEvent());
    });
    await act(async () => {
      await result.current.handleResetClass(fakeSubmitEvent());
    });

    expect(resetBodyOf(0).operationId).not.toBe(resetBodyOf(1).operationId);
  });

  it('surfaces the server message, error code and snapshot from a 409', async () => {
    const courseClosing = { courseId: 'course-1', status: 'sending' };
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError('Còn 2 học sinh chưa gửi học phí.', 409, {
        errorCode: 'COURSE_CLOSING_INCOMPLETE',
        courseClosing,
      })
    );
    const { result } = renderClassDetailMisc();

    await act(async () => {
      await result.current.handleResetClass(fakeSubmitEvent());
    });

    expect(result.current.resetError).toMatchObject({
      message: 'Còn 2 học sinh chưa gửi học phí.',
      errorCode: 'COURSE_CLOSING_INCOMPLETE',
      courseClosing,
    });
  });

  it('refreshes the course-closing snapshot after a successful reset', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true } as never);
    const { result, onCourseClosingRefresh } = renderClassDetailMisc();

    await act(async () => {
      await result.current.handleResetClass(fakeSubmitEvent());
    });

    expect(onCourseClosingRefresh).toHaveBeenCalled();
  });
});
