// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOfficeWeeklyDashboard } from '../api/officeDashboardApi';
import { officeWeeklyDashboardQueryOptions } from './officeDashboardQueries';

vi.mock('../api/officeDashboardApi', () => ({
  readOfficeWeeklyDashboard: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(readOfficeWeeklyDashboard).mockReset();
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
const payload = { classes: [{ id: 'class-1' }], teachers: [], studentCounts: {}, serverTime: 0 };

describe('office weekly dashboard query policy', () => {
  it('serves a remount from cache instead of re-reading the week', async () => {
    vi.mocked(readOfficeWeeklyDashboard).mockResolvedValue(payload as any);
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const first = renderHook(() => useQuery(officeWeeklyDashboardQueryOptions(OFFICE, true)), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(() => useQuery(officeWeeklyDashboardQueryOptions(OFFICE, true)), {
      wrapper,
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);
    expect(second.result.current.data).toEqual(payload);
    expect(second.result.current.isPending).toBe(false);

    second.unmount();
    queryClient.clear();
  });

  it('revalidates an actively observed dashboard at fifteen minutes, not before', async () => {
    vi.useFakeTimers();
    vi.mocked(readOfficeWeeklyDashboard).mockResolvedValue(payload as any);
    const queryClient = newClient();
    const hook = renderHook(() => useQuery(officeWeeklyDashboardQueryOptions(OFFICE, true)), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000 + 59_999);
    });
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(2);

    hook.unmount();
    queryClient.clear();
  });

  it('does not run the fallback interval while the tab is hidden', async () => {
    vi.useFakeTimers();
    vi.mocked(readOfficeWeeklyDashboard).mockResolvedValue(payload as any);
    const queryClient = newClient();
    const hook = renderHook(() => useQuery(officeWeeklyDashboardQueryOptions(OFFICE, true)), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);

    // `refetchIntervalInBackground: false` suspends the interval whenever the
    // document is hidden. `focusManager` is the same switch the browser's
    // visibilitychange event flips.
    act(() => focusManager.setFocused(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45 * 60_000);
    });
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);

    hook.unmount();
    queryClient.clear();
    focusManager.setFocused(undefined);
  });

  it('keeps cached content on screen when a background refresh fails', async () => {
    vi.mocked(readOfficeWeeklyDashboard)
      .mockResolvedValueOnce(payload as any)
      .mockRejectedValueOnce(new Error('network down'));
    const queryClient = newClient();
    const hook = renderHook(() => useQuery(officeWeeklyDashboardQueryOptions(OFFICE, true)), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    await act(async () => {
      await hook.result.current.refetch();
    });

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.data).toEqual(payload);
    expect(hook.result.current.isError && !hook.result.current.data).toBe(false);

    hook.unmount();
    queryClient.clear();
  });

  it('does not serve one identity the dashboard cached for another', async () => {
    vi.mocked(readOfficeWeeklyDashboard)
      .mockResolvedValueOnce({ ...payload, classes: [{ id: 'office-view' }] } as any)
      .mockResolvedValueOnce({ ...payload, classes: [{ id: 'admin-view' }] } as any);
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const asOffice = renderHook(() => useQuery(officeWeeklyDashboardQueryOptions(OFFICE, true)), {
      wrapper,
    });
    await waitFor(() => expect(asOffice.result.current.isSuccess).toBe(true));
    asOffice.unmount();

    const asAdmin = renderHook(
      () => useQuery(officeWeeklyDashboardQueryOptions({ uid: 'admin-1', role: 'admin' }, true)),
      { wrapper }
    );
    await waitFor(() => expect(asAdmin.result.current.isSuccess).toBe(true));

    expect(asAdmin.result.current.data?.classes).toEqual([{ id: 'admin-view' }]);
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(2);

    asAdmin.unmount();
    queryClient.clear();
  });

  it('does not fetch before an identity is known', async () => {
    vi.mocked(readOfficeWeeklyDashboard).mockResolvedValue(payload as any);
    const queryClient = newClient();
    const hook = renderHook(
      () => useQuery(officeWeeklyDashboardQueryOptions({ uid: '', role: '' }, false)),
      { wrapper: wrapperFor(queryClient) }
    );
    await act(async () => {});

    expect(readOfficeWeeklyDashboard).not.toHaveBeenCalled();

    hook.unmount();
    queryClient.clear();
  });
});
