import { describe, expect, it, vi } from 'vitest';
import { createReadCache, readCacheKey } from './readCache.js';

describe('readCacheKey', () => {
  it('includes channel, role, uid, and sorted params', () => {
    expect(
      readCacheKey({
        channel: 'parent-dashboard',
        role: 'parent',
        uid: 'u1',
        params: { limit: 50, studentId: 's1' },
      })
    ).toBe('parent-dashboard|role=parent|uid=u1|limit=50|studentId=s1');
  });

  it('keeps users isolated for the same channel', () => {
    const left = readCacheKey({ channel: 'parent-dashboard', role: 'parent', uid: 'u1' });
    const right = readCacheKey({ channel: 'parent-dashboard', role: 'parent', uid: 'u2' });

    expect(left).not.toBe(right);
  });
});

describe('createReadCache', () => {
  it('de-duplicates inflight fetches for the same key', async () => {
    const cache = createReadCache<string>(1000);
    const fetcher = vi.fn().mockResolvedValue('payload');

    const [left, right] = await Promise.all([
      cache.get('same-key', fetcher),
      cache.get('same-key', fetcher),
    ]);

    expect(left).toBe('payload');
    expect(right).toBe('payload');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
