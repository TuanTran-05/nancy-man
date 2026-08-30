import { describe, expect, it, vi } from 'vitest';

import { startCollectorLoop } from './collector-main.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('collector loop watchdog coupling', () => {
  it('stops scheduling and reports a rejected post-start cycle as fatal', async () => {
    let scheduled: (() => void) | undefined;
    const cancel = vi.fn();
    const failure = new Error('collector cycle rejected');
    const cycle = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    const watchdog = { progress: vi.fn(), stop: vi.fn() };
    const onFailure = vi.fn();

    await startCollectorLoop({
      cycle,
      watchdog,
      schedule: (callback) => {
        scheduled = callback;
        return cancel;
      },
      onFailure
    });
    scheduled?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(watchdog.stop).toHaveBeenCalledTimes(1);
    expect(watchdog.progress).toHaveBeenCalledTimes(1);
  });

  it('does not report watchdog progress while a scheduled collection cycle is hung', async () => {
    let scheduled: (() => void) | undefined;
    const hung = deferred<void>();
    const cycle = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(hung.promise);
    const watchdog = { progress: vi.fn(), stop: vi.fn() };

    await startCollectorLoop({
      cycle,
      watchdog,
      schedule: (callback) => {
        scheduled = callback;
        return vi.fn();
      },
      onFailure: vi.fn()
    });
    scheduled?.();
    await Promise.resolve();

    expect(watchdog.progress).toHaveBeenCalledTimes(1);
    expect(watchdog.stop).not.toHaveBeenCalled();
    hung.resolve();
    await Promise.resolve();
    expect(watchdog.progress).toHaveBeenCalledTimes(2);
  });
});
