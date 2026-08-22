import { createTtlCache } from './ttlCache.js';

type ReadCacheKeyInput = {
  channel: string;
  role?: string;
  uid?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
};

export function readCacheKey({ channel, role, uid, params = {} }: ReadCacheKeyInput): string {
  const parts = [channel];
  if (role) parts.push(`role=${role}`);
  if (uid) parts.push(`uid=${uid}`);

  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${String(value)}`);
    }
  }

  return parts.join('|');
}

const activeCaches: any[] = [];

export function createReadCache<T>(ttlMs: number) {
  const cache = createTtlCache<T>(ttlMs);
  activeCaches.push(cache);
  return cache;
}

export function clearAllReadCaches(): void {
  for (const cache of activeCaches) {
    cache.clear();
  }
}
