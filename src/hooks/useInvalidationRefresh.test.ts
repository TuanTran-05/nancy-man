// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInvalidationRefresh } from './useInvalidationRefresh';

describe('useInvalidationRefresh HTTP polling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes after focus with debounce', async () => {
    const onInvalidate = vi.fn();
    renderHook(() =>
      useInvalidationRefresh({
        channelKey: 'classes',
        debounceMs: 100,
        minIntervalMs: 100,
        pollIntervalMs: 10_000,
        onInvalidate,
      })
    );

    act(() => window.dispatchEvent(new Event('focus')));
    expect(onInvalidate).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it('coalesces browser events inside one debounce window', async () => {
    const onInvalidate = vi.fn();
    renderHook(() =>
      useInvalidationRefresh({
        channelKey: 'students',
        debounceMs: 100,
        minIntervalMs: 100,
        pollIntervalMs: 10_000,
        onInvalidate,
      })
    );

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it('uses the polling interval and respects disabled state', async () => {
    const enabledRefresh = vi.fn();
    const disabledRefresh = vi.fn();
    renderHook(() =>
      useInvalidationRefresh({
        channelKey: 'enabled',
        debounceMs: 50,
        minIntervalMs: 50,
        pollIntervalMs: 500,
        onInvalidate: enabledRefresh,
      })
    );
    renderHook(() =>
      useInvalidationRefresh({
        channelKey: 'disabled',
        enabled: false,
        pollIntervalMs: 500,
        onInvalidate: disabledRefresh,
      })
    );

    await act(async () => vi.advanceTimersByTimeAsync(550));
    expect(enabledRefresh).toHaveBeenCalledTimes(1);
    expect(disabledRefresh).not.toHaveBeenCalled();
  });

  it('removes timers and browser listeners across unmount and remount', async () => {
    const firstRefresh = vi.fn();
    const first = renderHook(() =>
      useInvalidationRefresh({
        channelKey: 'classes',
        debounceMs: 50,
        minIntervalMs: 50,
        pollIntervalMs: 500,
        onInvalidate: firstRefresh,
      })
    );

    await act(async () => vi.advanceTimersByTimeAsync(550));
    expect(firstRefresh).toHaveBeenCalledTimes(1);
    first.unmount();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(firstRefresh).toHaveBeenCalledTimes(1);

    const secondRefresh = vi.fn();
    renderHook(() =>
      useInvalidationRefresh({
        channelKey: 'classes',
        debounceMs: 50,
        minIntervalMs: 50,
        pollIntervalMs: 500,
        onInvalidate: secondRefresh,
      })
    );
    await act(async () => vi.advanceTimersByTimeAsync(550));
    expect(secondRefresh).toHaveBeenCalledTimes(1);
    expect(firstRefresh).toHaveBeenCalledTimes(1);
  });

  it('queues only one trailing refresh while a slow refresh is in flight', async () => {
    let resolveRefresh: (() => void) | undefined;
    const onInvalidate = vi.fn(
      () => new Promise<void>((resolve) => (resolveRefresh = resolve))
    );
    renderHook(() =>
      useInvalidationRefresh({
        channelKey: 'students',
        debounceMs: 50,
        minIntervalMs: 50,
        pollIntervalMs: 10_000,
        onInvalidate,
      })
    );

    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });
});
