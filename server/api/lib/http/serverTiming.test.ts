import { describe, expect, it, vi } from 'vitest';
import { createServerTiming, shouldEmitServerTiming } from './serverTiming.js';

describe('createServerTiming', () => {
  it('records named async sections and formats a Server-Timing header', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const timing = createServerTiming();

    const resultPromise = timing.measure('auth', async () => {
      vi.setSystemTime(25);
      return 'ok';
    });

    await expect(resultPromise).resolves.toBe('ok');
    expect(timing.header()).toBe('auth;dur=25.0');
    vi.useRealTimers();
  });

  it('records sync marks without throwing when the callback fails', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const timing = createServerTiming();

    expect(() =>
      timing.measure('db', () => {
        vi.setSystemTime(140);
        throw new Error('query failed');
      })
    ).toThrow('query failed');

    expect(timing.header()).toBe('db;dur=40.0');
    vi.useRealTimers();
  });
});

describe('shouldEmitServerTiming', () => {
  it('emits in non-production', () => {
    expect(shouldEmitServerTiming('development', undefined)).toBe(true);
  });

  it('emits in production only when explicitly requested', () => {
    expect(shouldEmitServerTiming('production', undefined)).toBe(false);
    expect(shouldEmitServerTiming('production', '1')).toBe(true);
  });
});
