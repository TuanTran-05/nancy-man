import { describe, expect, it, vi } from 'vitest';
import { createTtlCache } from './ttlCache.js';

describe('createTtlCache', () => {
  it('returns cached value within TTL', async () => {
    vi.useFakeTimers();
    const cache = createTtlCache<string>(1000);
    const fetcher = vi.fn().mockResolvedValue('value-1');

    const result1 = await cache.get('key', fetcher);
    const result2 = await cache.get('key', fetcher);

    expect(result1).toBe('value-1');
    expect(result2).toBe('value-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('refetches after TTL expires', async () => {
    vi.useFakeTimers();
    const cache = createTtlCache<string>(1000);
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    const result1 = await cache.get('key', fetcher);
    vi.advanceTimersByTime(1001);
    const result2 = await cache.get('key', fetcher);

    expect(result1).toBe('v1');
    expect(result2).toBe('v2');
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('supports manual invalidation', async () => {
    const cache = createTtlCache<string>(60_000);
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    await cache.get('key', fetcher);
    cache.invalidate('key');
    const result = await cache.get('key', fetcher);

    expect(result).toBe('v2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('handles concurrent requests for the same key', async () => {
    const cache = createTtlCache<string>(1000);
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      callCount++;
      return `value-${callCount}`;
    });

    const [r1, r2] = await Promise.all([cache.get('key', fetcher), cache.get('key', fetcher)]);

    expect(r1).toBe(r2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
