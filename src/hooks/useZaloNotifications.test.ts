// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useZaloNotifications } from './useZaloNotifications';
import {
  getZaloSendCount,
  sendZaloAbsenceNotification,
  sendZaloEvaluationNotification,
  sendZaloRankNotification,
  isValidVNPhone,
} from '../lib/zalo/zaloService';
import toast from 'react-hot-toast';

vi.mock('../lib/zalo/zaloService', () => ({
  getZaloSendCount: vi
    .fn()
    .mockResolvedValue({ success: true, allowed: true, currentCount: 0, max: 2 }),
  sendZaloAbsenceNotification: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
  sendZaloEvaluationNotification: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-2' }),
  sendZaloRankNotification: vi.fn().mockResolvedValue({ success: true, messageId: 'rank-1' }),
  isValidVNPhone: vi.fn().mockReturnValue(true),
}));

vi.mock('../lib/core/utils', () => ({
  formatVN: vi.fn((d: string) => d),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const mockedGetZaloSendCount = vi.mocked(getZaloSendCount);
const mockedSendAbsence = vi.mocked(sendZaloAbsenceNotification);
const mockedSendEval = vi.mocked(sendZaloEvaluationNotification);
const mockedSendRank = vi.mocked(sendZaloRankNotification);
const mockedIsValidPhone = vi.mocked(isValidVNPhone);
const mockedToast = vi.mocked(toast);

const mockStudents = [
  {
    id: 's1',
    name: 'Student 1',
    studentId: 'HS01',
    code: 'HS01',
    contact: '0384072314',
    classId: 'c1',
    teacherId: 't1',
    dob: '2010-01-01',
    createdAt: '',
  },
  {
    id: 's2',
    name: 'Student 2',
    studentId: 'HS02',
    code: 'HS02',
    contact: '',
    classId: 'c1',
    teacherId: 't1',
    dob: '2010-02-02',
    createdAt: '',
  },
];

const mockClassData = { id: 'c1', name: 'Class A', endDate: '2026-06-01' };
const mockProfile = { uid: 'teacher-1', role: 'teacher' as const };

function getDefaultParams(overrides = {}) {
  return {
    classId: 'c1',
    classData: mockClassData,
    profile: mockProfile,
    students: mockStudents,
    notifyAbsenceDate: '2026-05-07',
    ...overrides,
  };
}

describe('useZaloNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsValidPhone.mockReturnValue(true);
    mockedGetZaloSendCount.mockResolvedValue({
      success: true,
      allowed: true,
      currentCount: 0,
      max: 2,
    });
    mockedSendAbsence.mockResolvedValue({ success: true, messageId: 'msg-1' });
    mockedSendEval.mockResolvedValue({ success: true, messageId: 'msg-2' });
    mockedSendRank.mockResolvedValue({ success: true, messageId: 'rank-1' });
  });

  it('handleAbsentMarked sets zaloConfirmData when valid phone', async () => {
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    await act(async () => {
      result.current.handleAbsentMarked({ studentId: 's1', date: '2026-05-07', classId: 'c1' });
    });

    expect(result.current.zaloConfirmData).toEqual({
      studentId: 's1',
      date: '2026-05-07',
      classId: 'c1',
    });
  });

  it('handleAbsentMarked rejects invalid phone', async () => {
    mockedIsValidPhone.mockReturnValue(false);
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    await act(async () => {
      result.current.handleAbsentMarked({ studentId: 's1', date: '2026-05-07', classId: 'c1' });
    });

    expect(result.current.zaloConfirmData).toBeNull();
  });

  it('handleZaloConfirm sends notification successfully', async () => {
    const { result } = renderHook(() =>
      useZaloNotifications(getDefaultParams({ notifyAbsenceDate: null }))
    );

    // Set confirm data
    act(() => {
      result.current.handleAbsentMarked({ studentId: 's1', date: '2026-05-07', classId: 'c1' });
    });

    expect(result.current.zaloConfirmData).not.toBeNull();

    // Confirm
    await act(async () => {
      await result.current.handleZaloConfirm();
    });

    expect(mockedSendAbsence).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 's1',
        studentName: 'Student 1',
        className: 'Class A',
        classId: 'c1',
        phone: '0384072314',
      })
    );
    expect(mockedToast.success).toHaveBeenCalled();
    expect(result.current.zaloConfirmData).toBeNull();
  });

  it('handleZaloConfirm respects rate limit', async () => {
    // Rate limit exceeded: 2 existing sends
    mockedGetZaloSendCount.mockResolvedValue({
      success: true,
      allowed: false,
      currentCount: 2,
      max: 2,
    });

    const { result } = renderHook(() =>
      useZaloNotifications(getDefaultParams({ notifyAbsenceDate: null }))
    );

    act(() => {
      result.current.handleAbsentMarked({ studentId: 's1', date: '2026-05-07', classId: 'c1' });
    });

    await act(async () => {
      await result.current.handleZaloConfirm();
    });

    expect(mockedSendAbsence).not.toHaveBeenCalled();
    expect(mockedToast.error.mock.calls[0]?.[0]).toContain('2 lần');
  });

  it('handleSendZaloEvaluation sends identifiers only', async () => {
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    const student = mockStudents[0];
    const evalData = {
      scores: { attendance: 8, effort: 9, pronunciation: 7, homework: 10, behavior: 8 },
      positivePoints: 'Good pronunciation\nGood effort',
      improvementPoints: 'Needs more homework',
    };

    await act(async () => {
      await result.current.handleSendZaloEvaluation(student, evalData);
    });

    expect(mockedSendEval).toHaveBeenCalledWith({ studentId: 's1', classId: 'c1' });
  });

  it('handleSendZaloEvaluation does not forward comment content', async () => {
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    const student = mockStudents[0];
    const evalData = {
      scores: { attendance: 8, effort: 9, pronunciation: 7, homework: 10, behavior: 8 },
      positivePoints: 'G'.repeat(240),
      improvementPoints: 'B'.repeat(240),
    };

    await act(async () => {
      await result.current.handleSendZaloEvaluation(student, evalData);
    });

    expect(mockedSendEval).toHaveBeenCalledWith({ studentId: 's1', classId: 'c1' });
  });

  it('handleSendZaloEvaluation sends successfully', async () => {
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    const student = mockStudents[0];
    const evalData = {
      scores: { attendance: 8, effort: 9, pronunciation: 7, homework: 10, behavior: 8 },
      positivePoints: 'Good',
      improvementPoints: 'None',
    };

    await act(async () => {
      await result.current.handleSendZaloEvaluation(student, evalData);
    });

    expect(mockedSendEval).toHaveBeenCalled();
    expect(mockedToast.success).toHaveBeenCalled();
    expect(mockedGetZaloSendCount).toHaveBeenCalled();
  });

  it('isSendingZalo prevents concurrent sends', async () => {
    // Make sendZaloAbsenceNotification return a deferred promise
    let resolveAbsence: (value: any) => void;
    const absencePromise = new Promise<any>((resolve) => {
      resolveAbsence = resolve;
    });
    mockedSendAbsence.mockReturnValue(absencePromise);

    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    // Set confirm data
    await act(async () => {
      result.current.handleAbsentMarked({ studentId: 's1', date: '2026-05-07', classId: 'c1' });
    });

    // Start first send — handleZaloConfirm is async, it will reach
    // setIsSendingZalo(true) then await sendZaloAbsenceNotification
    const firstPromise = result.current.handleZaloConfirm();

    // Flush microtasks so rate limit check + setIsSendingZalo(true) take effect
    await act(async () => {
      await Promise.resolve();
    });

    // isSendingZalo should now be true (set before the await on sendZaloAbsenceNotification)
    expect(result.current.isSendingZalo).toBe(true);

    // Second call should return early because isSendingZalo is true
    await act(async () => {
      await result.current.handleZaloConfirm();
    });

    // sendZaloAbsenceNotification should only have been called once
    expect(mockedSendAbsence).toHaveBeenCalledTimes(1);

    // Resolve the first send to clean up
    await act(async () => {
      resolveAbsence!({ success: true, messageId: 'msg-1' });
      await firstPromise;
    });

    expect(result.current.isSendingZalo).toBe(false);
  });

  it('sets absence confirmation loading immediately while rate limit check is pending', async () => {
    let resolveRateLimit: (value: any) => void;
    const rateLimitPromise = new Promise<any>((resolve) => {
      resolveRateLimit = resolve;
    });
    mockedGetZaloSendCount.mockReturnValueOnce(rateLimitPromise);

    const { result } = renderHook(() =>
      useZaloNotifications(getDefaultParams({ notifyAbsenceDate: null }))
    );

    act(() => {
      result.current.handleAbsentMarked({ studentId: 's1', date: '2026-05-07', classId: 'c1' });
    });

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.handleZaloConfirm();
    });

    expect(result.current.isSendingZalo).toBe(true);
    expect(mockedSendAbsence).not.toHaveBeenCalled();

    await act(async () => {
      resolveRateLimit!({ success: true, allowed: true, currentCount: 0, max: 2 });
      await sendPromise!;
    });

    expect(result.current.isSendingZalo).toBe(false);
  });

  it('handleZaloEvalConfirm sends evaluation', async () => {
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    const student = mockStudents[0];
    const evaluation = {
      id: 'e1',
      studentId: 's1',
      classId: 'c1',
      teacherId: 'teacher-1',
      evaluationType: 'final' as const,
      scores: { attendance: 8, effort: 9, pronunciation: 7, homework: 10, behavior: 8 },
      totalScore: 84,
      finalScore: 90,
      positivePoints: ['Good effort', 'Nice pronunciation'],
      improvementPoints: 'Do more homework',
      date: '2026-05-07',
      createdAt: '2026-05-07',
    };

    // Set eval confirm data via handleSendZaloFromCard
    act(() => {
      result.current.handleSendZaloFromCard(student, evaluation);
    });

    expect(result.current.zaloEvalConfirmData).not.toBeNull();

    // Confirm
    await act(async () => {
      await result.current.handleZaloEvalConfirm();
    });

    expect(mockedSendEval).toHaveBeenCalledWith({ studentId: 's1', classId: 'c1' });
    expect(mockedToast.success).toHaveBeenCalled();
    expect(result.current.zaloEvalConfirmData).toBeNull();
  });

  it('sets evaluation confirmation loading immediately while rate limit check is pending', async () => {
    let resolveRateLimit: (value: any) => void;
    const rateLimitPromise = new Promise<any>((resolve) => {
      resolveRateLimit = resolve;
    });
    mockedGetZaloSendCount.mockReturnValueOnce(rateLimitPromise);

    const { result } = renderHook(() =>
      useZaloNotifications(getDefaultParams({ notifyAbsenceDate: null }))
    );

    const student = mockStudents[0];
    const evaluation = {
      id: 'e1',
      studentId: 's1',
      classId: 'c1',
      teacherId: 'teacher-1',
      evaluationType: 'final' as const,
      scores: { attendance: 8, effort: 9, pronunciation: 7, homework: 10, behavior: 8 },
      totalScore: 84,
      finalScore: 90,
      positivePoints: ['Good effort', 'Nice pronunciation'],
      improvementPoints: 'Do more homework',
      date: '2026-05-07',
      createdAt: '2026-05-07',
    };

    act(() => {
      result.current.handleSendZaloFromCard(student, evaluation);
    });

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.handleZaloEvalConfirm();
    });

    expect(result.current.isSendingZalo).toBe(true);
    expect(mockedSendEval).not.toHaveBeenCalled();

    await act(async () => {
      resolveRateLimit!({ success: true, allowed: true, currentCount: 0, max: 2 });
      await sendPromise!;
    });

    expect(result.current.isSendingZalo).toBe(false);
  });

  it('sends rank notification after evaluation for ranked form data', async () => {
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    const student = mockStudents[0];
    const evalData = {
      scores: { attendance: 8, effort: 9, pronunciation: 7, homework: 10, behavior: 8 },
      positivePoints: 'Good',
      improvementPoints: 'None',
      rank: 'first' as const,
    };

    let sent = false;
    await act(async () => {
      sent = await result.current.handleSendZaloEvaluation(student, evalData);
    });

    expect(sent).toBe(true);
    expect(mockedSendEval).toHaveBeenCalledTimes(1);
    expect(mockedSendRank).toHaveBeenCalledWith({ studentId: 's1', classId: 'c1' });
    expect(mockedSendEval.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSendRank.mock.invocationCallOrder[0]
    );
  });

  it('continues successfully when ranked evaluation notification fails after evaluation send', async () => {
    mockedSendRank.mockResolvedValueOnce({ success: false, error: 'Rank template failed' });
    const { result } = renderHook(() => useZaloNotifications(getDefaultParams()));

    const student = mockStudents[0];
    const evalData = {
      scores: { attendance: 8, effort: 9, pronunciation: 7, homework: 10, behavior: 8 },
      positivePoints: 'Good',
      improvementPoints: 'None',
      rank: 'second' as const,
    };

    let sent = false;
    await act(async () => {
      sent = await result.current.handleSendZaloEvaluation(student, evalData);
    });

    expect(sent).toBe(true);
    expect(mockedSendEval).toHaveBeenCalledTimes(1);
    expect(mockedSendRank).toHaveBeenCalledTimes(1);
    expect(mockedToast.error).toHaveBeenCalledWith(
      expect.stringContaining('Rank template failed'),
      { duration: 8000 }
    );
  });
});
