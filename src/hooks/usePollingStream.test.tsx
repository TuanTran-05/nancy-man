// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePollingStream } from './usePollingStream';

const authState = vi.hoisted(() => ({
  profile: { role: 'admin', classId: 'class-1' } as any,
  user: { uid: 'admin-1' } as any,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

describe('usePollingStream', () => {
  beforeEach(() => {
    authState.profile = { role: 'admin', classId: 'class-1' };
    authState.user = { uid: 'admin-1' };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads immediately and replaces data on each poll', async () => {
    vi.useFakeTimers();
    const fetchData = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'first' }] })
      .mockResolvedValueOnce({ items: [{ id: 'second' }] });
    const { result } = renderHook(() =>
      usePollingStream({
        topic: 'assignments',
        fetchInitialData: fetchData,
        intervalMs: 5_000,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data).toEqual([{ id: 'first' }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchData).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual([{ id: 'second' }]);
  });

  it('does not fetch without an authenticated profile', async () => {
    authState.profile = null;
    authState.user = null;
    const fetchData = vi.fn().mockResolvedValue({ items: [] });
    const { result } = renderHook(() =>
      usePollingStream({ topic: 'assignments', fetchInitialData: fetchData })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchData).not.toHaveBeenCalled();
  });

  it('refreshes when the tab returns to foreground and the network comes online', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const fetchData = vi.fn().mockResolvedValue({ items: [] });
    renderHook(() =>
      usePollingStream({ topic: 'assignments', fetchInitialData: fetchData, intervalMs: 60_000 })
    );

    await act(async () => Promise.resolve());
    expect(fetchData).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(fetchData).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(fetchData).toHaveBeenCalledTimes(3);
    visibility.mockRestore();
  });

  it('cleans up the polling interval on unmount before a remount', async () => {
    vi.useFakeTimers();
    const firstFetch = vi.fn().mockResolvedValue({ items: [] });
    const first = renderHook(() =>
      usePollingStream({ topic: 'assignments', fetchInitialData: firstFetch, intervalMs: 5_000 })
    );
    await act(async () => Promise.resolve());
    expect(firstFetch).toHaveBeenCalledTimes(1);
    first.unmount();

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(firstFetch).toHaveBeenCalledTimes(1);

    const secondFetch = vi.fn().mockResolvedValue({ items: [] });
    renderHook(() =>
      usePollingStream({ topic: 'assignments', fetchInitialData: secondFetch, intervalMs: 5_000 })
    );
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(secondFetch).toHaveBeenCalledTimes(2);
    expect(firstFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed refresh and recovers on the next poll', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchData = vi
      .fn()
      .mockRejectedValueOnce(new Error('session expired'))
      .mockResolvedValueOnce({ items: [{ id: 'recovered' }] });
    const { result } = renderHook(() =>
      usePollingStream({ topic: 'assignments', fetchInitialData: fetchData, intervalMs: 5_000 })
    );

    await act(async () => Promise.resolve());
    expect(result.current.error?.message).toBe('session expired');

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual([{ id: 'recovered' }]);
    consoleError.mockRestore();
  });
});
