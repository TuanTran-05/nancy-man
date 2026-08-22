// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../../lib/api/readApi';
import { financeClassesQueryOptions, financeTeachersQueryOptions } from './financeReferenceQueries';

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(readChannel).mockReset();
});

function renderWithClient(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const ACCOUNTING = { uid: 'accounting-1', role: 'accounting' };

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('finance reference query policy', () => {
  // These two reads used to refire on every tab switch because the effect that
  // owned them had `activeTab` in its dependency list.
  it('serves a tab switch from cache instead of refetching the class list', async () => {
    vi.mocked(readChannel).mockResolvedValue({ classes: [{ id: 'class-1' }] } as any);
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const onLedgersTab = renderHook(() => useQuery(financeClassesQueryOptions(ACCOUNTING, true)), {
      wrapper,
    });
    await waitFor(() => expect(onLedgersTab.result.current.isSuccess).toBe(true));
    expect(readChannel).toHaveBeenCalledTimes(1);

    onLedgersTab.unmount();
    const onExpensesTab = renderHook(() => useQuery(financeClassesQueryOptions(ACCOUNTING, true)), {
      wrapper,
    });
    await waitFor(() => expect(onExpensesTab.result.current.isSuccess).toBe(true));

    expect(readChannel).toHaveBeenCalledTimes(1);
    expect(onExpensesTab.result.current.data).toEqual([{ id: 'class-1' }]);

    onExpensesTab.unmount();
    queryClient.clear();
  });

  it('keeps classes and teachers in separate cache entries', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce({ classes: [{ id: 'class-1' }] } as any)
      .mockResolvedValueOnce({ teachers: [{ uid: 'teacher-1', displayName: 'GV' }] } as any);
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const classes = renderHook(() => useQuery(financeClassesQueryOptions(ACCOUNTING, true)), {
      wrapper,
    });
    await waitFor(() => expect(classes.result.current.isSuccess).toBe(true));

    const teachers = renderHook(() => useQuery(financeTeachersQueryOptions(ACCOUNTING, true)), {
      wrapper,
    });
    await waitFor(() => expect(teachers.result.current.isSuccess).toBe(true));

    expect(classes.result.current.data).toEqual([{ id: 'class-1' }]);
    expect(teachers.result.current.data).toEqual([{ uid: 'teacher-1', displayName: 'GV' }]);

    classes.unmount();
    teachers.unmount();
    queryClient.clear();
  });

  it('does not serve one identity the reference data cached for another', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce({ classes: [{ id: 'accounting-visible' }] } as any)
      .mockResolvedValueOnce({ classes: [{ id: 'admin-visible' }] } as any);
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const asAccounting = renderHook(() => useQuery(financeClassesQueryOptions(ACCOUNTING, true)), {
      wrapper,
    });
    await waitFor(() => expect(asAccounting.result.current.isSuccess).toBe(true));
    asAccounting.unmount();

    const asAdmin = renderHook(
      () => useQuery(financeClassesQueryOptions({ uid: 'admin-1', role: 'admin' }, true)),
      { wrapper }
    );
    await waitFor(() => expect(asAdmin.result.current.isSuccess).toBe(true));

    expect(asAdmin.result.current.data).toEqual([{ id: 'admin-visible' }]);
    expect(readChannel).toHaveBeenCalledTimes(2);

    asAdmin.unmount();
    queryClient.clear();
  });

  it('refreshes actively observed reference data at 15 minutes, not before', async () => {
    vi.useFakeTimers();
    vi.mocked(readChannel).mockResolvedValue({ classes: [] } as any);
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const hook = renderHook(() => useQuery(financeClassesQueryOptions(ACCOUNTING, true)), {
      wrapper,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000 + 59_999);
    });
    expect(readChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(readChannel).toHaveBeenCalledTimes(2);

    hook.unmount();
    queryClient.clear();
  });

  it('does not fetch until an identity is known', async () => {
    vi.mocked(readChannel).mockResolvedValue({ classes: [] } as any);
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const hook = renderHook(
      () => useQuery(financeClassesQueryOptions({ uid: '', role: '' }, false)),
      { wrapper }
    );
    await act(async () => {});

    expect(readChannel).not.toHaveBeenCalled();

    hook.unmount();
    queryClient.clear();
  });
});
