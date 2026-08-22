// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTeacherAttendanceWeek } from '../api/teacherAttendanceApi';
import {
  applyTeacherAttendanceMark,
  teacherAttendanceWeekQueryOptions,
} from './teacherAttendanceQueries';

vi.mock('../api/teacherAttendanceApi', () => ({
  readTeacherAttendanceWeek: vi.fn(),
  markTeacherAttendance: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(readTeacherAttendanceWeek).mockReset();
});

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const OFFICE = { uid: 'office-1', role: 'office' };
const weekPayload = (from: string) => ({
  sessions: [
    {
      id: 'row-1',
      classId: 'class-1',
      date: from,
      teacherAttendanceStatus: 'pending',
      isVirtual: true,
    },
    {
      id: 'row-2',
      classId: 'class-2',
      date: from,
      teacherAttendanceStatus: 'pending',
      isVirtual: true,
    },
  ],
  teachers: [],
  classes: [],
  serverTime: 0,
});

describe('teacher attendance week query policy', () => {
  it('keeps each week in its own cache entry and reuses a visited week', async () => {
    vi.mocked(readTeacherAttendanceWeek).mockImplementation(
      async (from: string) => weekPayload(from) as any
    );
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const thisWeek = renderHook(
      () => useQuery(teacherAttendanceWeekQueryOptions(OFFICE, '2026-08-10', '2026-08-16', true)),
      { wrapper }
    );
    await waitFor(() => expect(thisWeek.result.current.isSuccess).toBe(true));
    thisWeek.unmount();

    const nextWeek = renderHook(
      () => useQuery(teacherAttendanceWeekQueryOptions(OFFICE, '2026-08-17', '2026-08-23', true)),
      { wrapper }
    );
    await waitFor(() => expect(nextWeek.result.current.isSuccess).toBe(true));
    nextWeek.unmount();
    expect(readTeacherAttendanceWeek).toHaveBeenCalledTimes(2);

    const back = renderHook(
      () => useQuery(teacherAttendanceWeekQueryOptions(OFFICE, '2026-08-10', '2026-08-16', true)),
      { wrapper }
    );
    await waitFor(() => expect(back.result.current.isSuccess).toBe(true));

    expect(readTeacherAttendanceWeek).toHaveBeenCalledTimes(2);
    expect(back.result.current.data?.sessions[0].date).toBe('2026-08-10');

    back.unmount();
    queryClient.clear();
  });

  it('does not fetch before an identity is known', async () => {
    vi.mocked(readTeacherAttendanceWeek).mockResolvedValue(weekPayload('2026-08-10') as any);
    const queryClient = newClient();
    const hook = renderHook(
      () =>
        useQuery(
          teacherAttendanceWeekQueryOptions(
            { uid: '', role: '' },
            '2026-08-10',
            '2026-08-16',
            false
          )
        ),
      { wrapper: wrapperFor(queryClient) }
    );
    await act(async () => {});

    expect(readTeacherAttendanceWeek).not.toHaveBeenCalled();

    hook.unmount();
    queryClient.clear();
  });
});

describe('applyTeacherAttendanceMark', () => {
  it('updates only the marked row', () => {
    const next = applyTeacherAttendanceMark(weekPayload('2026-08-10') as any, 'row-1', 'present');
    expect(next?.sessions[0].teacherAttendanceStatus).toBe('present');
    expect(next?.sessions[0].isVirtual).toBe(false);
    expect(next?.sessions[1].teacherAttendanceStatus).toBe('pending');
  });

  it('leaves the original object untouched so a rollback still has it', () => {
    const original = weekPayload('2026-08-10') as any;
    applyTeacherAttendanceMark(original, 'row-1', 'absent');
    expect(original.sessions[0].teacherAttendanceStatus).toBe('pending');
  });

  it('returns undefined when there is nothing cached to update', () => {
    expect(applyTeacherAttendanceMark(undefined, 'row-1', 'present')).toBeUndefined();
  });
});
