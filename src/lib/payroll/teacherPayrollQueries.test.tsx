// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTeacherPayrollMonth } from '../api/teacherPayrollApi';
import { teacherPayrollMonthQueryOptions } from './teacherPayrollQueries';

vi.mock('../api/teacherPayrollApi', () => ({
  readTeacherPayrollMonth: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  // `mockReset` rather than `mockClear`: these tests queue `mockResolvedValueOnce`
  // responses, and an unconsumed queue would leak into the next test.
  vi.mocked(readTeacherPayrollMonth).mockReset();
});

function renderWithClient(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const ACCOUNTING = { uid: 'accounting-1', role: 'accounting' };

describe('teacher payroll query policy', () => {
  it('serves a remount from cache instead of refetching the month', async () => {
    vi.mocked(readTeacherPayrollMonth).mockResolvedValue({} as any);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = renderWithClient(queryClient);

    const first = renderHook(
      () => useQuery(teacherPayrollMonthQueryOptions(ACCOUNTING, '2026-08', true)),
      { wrapper }
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(readTeacherPayrollMonth).toHaveBeenCalledTimes(1);

    // Navigating away and back unmounts the page — the win is that the cached
    // month paints immediately rather than re-running the aggregation.
    first.unmount();
    const second = renderHook(
      () => useQuery(teacherPayrollMonthQueryOptions(ACCOUNTING, '2026-08', true)),
      { wrapper }
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(readTeacherPayrollMonth).toHaveBeenCalledTimes(1);
    expect(second.result.current.data).toEqual({});

    second.unmount();
    queryClient.clear();
  });

  it('refreshes an actively observed month at 15 minutes, not before', async () => {
    vi.useFakeTimers();
    vi.mocked(readTeacherPayrollMonth).mockResolvedValue({} as any);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = renderWithClient(queryClient);

    const hook = renderHook(
      () => useQuery(teacherPayrollMonthQueryOptions(ACCOUNTING, '2026-08', true)),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readTeacherPayrollMonth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000 + 59_999);
    });
    expect(readTeacherPayrollMonth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(readTeacherPayrollMonth).toHaveBeenCalledTimes(2);

    hook.unmount();
    queryClient.clear();
  });

  // `readTeacherPayrollMonth` is scoped by the caller's context server-side —
  // office has salary stripped, a teacher sees only themselves — and
  // `queryClient` is a module-level singleton, so the key must carry identity.
  it('does not serve one identity the month cached for another', async () => {
    vi.mocked(readTeacherPayrollMonth)
      .mockResolvedValueOnce({ teachers: ['accounting-view'] } as any)
      .mockResolvedValueOnce({ teachers: ['office-view'] } as any);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = renderWithClient(queryClient);

    const asAccounting = renderHook(
      () => useQuery(teacherPayrollMonthQueryOptions(ACCOUNTING, '2026-08', true)),
      { wrapper }
    );
    await waitFor(() => expect(asAccounting.result.current.isSuccess).toBe(true));
    asAccounting.unmount();

    const asOffice = renderHook(
      () =>
        useQuery(
          teacherPayrollMonthQueryOptions({ uid: 'office-1', role: 'office' }, '2026-08', true)
        ),
      { wrapper }
    );
    await waitFor(() => expect(asOffice.result.current.isSuccess).toBe(true));

    expect(asOffice.result.current.data).toEqual({ teachers: ['office-view'] });
    expect(readTeacherPayrollMonth).toHaveBeenCalledTimes(2);

    asOffice.unmount();
    queryClient.clear();
  });

  it('keeps a separate cache entry per month', async () => {
    vi.mocked(readTeacherPayrollMonth)
      .mockResolvedValueOnce({ month: '2026-08' } as any)
      .mockResolvedValueOnce({ month: '2026-07' } as any);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = renderWithClient(queryClient);

    const august = renderHook(
      () => useQuery(teacherPayrollMonthQueryOptions(ACCOUNTING, '2026-08', true)),
      { wrapper }
    );
    await waitFor(() => expect(august.result.current.isSuccess).toBe(true));
    august.unmount();

    const july = renderHook(
      () => useQuery(teacherPayrollMonthQueryOptions(ACCOUNTING, '2026-07', true)),
      { wrapper }
    );
    await waitFor(() => expect(july.result.current.isSuccess).toBe(true));

    expect(july.result.current.data).toEqual({ month: '2026-07' });
    expect(readTeacherPayrollMonth).toHaveBeenCalledWith('2026-07');

    july.unmount();
    queryClient.clear();
  });

  it('does not fetch until an identity is known', async () => {
    vi.mocked(readTeacherPayrollMonth).mockResolvedValue({} as any);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = renderWithClient(queryClient);

    const hook = renderHook(
      () => useQuery(teacherPayrollMonthQueryOptions({ uid: '', role: '' }, '2026-08', false)),
      { wrapper }
    );
    await act(async () => {});

    expect(readTeacherPayrollMonth).not.toHaveBeenCalled();

    hook.unmount();
    queryClient.clear();
  });
});
