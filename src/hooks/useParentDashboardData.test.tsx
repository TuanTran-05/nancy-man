// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../lib/api/readApi';
import { useParentDashboardData } from './useParentDashboardData';

vi.mock('../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useParentDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not issue a second read when the first request resolves after unmount', async () => {
    const pending = deferred<{
      student: { id: string; classId: string };
      class: { id: string };
      assignments: unknown[];
    }>();
    vi.mocked(readChannel).mockReturnValue(pending.promise);

    const { unmount } = renderHook(() =>
      useParentDashboardData({
        uid: 'parent-1',
        role: 'parent',
        studentId: 'stu-1',
        classId: 'class-1',
        teacherId: 'teacher-1',
      } as any)
    );

    unmount();

    await act(async () => {
      pending.resolve({
        student: { id: 'stu-1', classId: 'class-1' },
        class: { id: 'class-1' },
        assignments: [],
      });
      await pending.promise;
    });

    expect(readChannel).toHaveBeenCalledTimes(1);
  });

  it('loads dashboard collections from the read API', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      dashboard: {
        student: { id: 'stu-1', classId: 'class-1', name: 'Student A' },
        classInfo: { id: 'class-1', name: 'Class A' },
        assignments: [{ id: 'assignment-1', classId: 'class-1' }],
        attendance: [{ id: 'attendance-1', studentId: 'stu-1' }],
        evaluations: [{ id: 'evaluation-1', studentId: 'stu-1' }],
        submissions: [{ id: 'submission-1', studentId: 'stu-1' }],
        notifications: [{ id: 'notification-1', studentId: 'stu-1' }],
        tuition: { ledgers: [], receipts: [] },
      },
    });

    const { result } = renderHook(() =>
      useParentDashboardData({
        uid: 'parent-1',
        role: 'parent',
        studentId: 'stu-1',
        classId: 'class-1',
      } as any)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(readChannel).toHaveBeenCalledWith('parent-dashboard');
    expect(result.current.studentData).toMatchObject({ id: 'stu-1' });
    expect(result.current.classData).toMatchObject({ id: 'class-1' });
    expect(result.current.attendance).toHaveLength(1);
    expect(result.current.evaluations).toHaveLength(1);
    expect(result.current.submissions).toHaveLength(1);
    expect(result.current.notifications).toHaveLength(1);
  });
});
