type CacheEntry<T> = { value: T; expiresAt: number };

/**
 * Module-level TTL cache for the long-running VPS process.
 * Entries still expire explicitly according to the configured TTL.
 */
export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  return {
    async get(key: string, fetcher: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const entry = store.get(key);
      if (entry && entry.expiresAt > now) return entry.value;

      const existing = inflight.get(key);
      if (existing) return existing;

      const promise = fetcher().then(
        (value) => {
          store.set(key, { value, expiresAt: Date.now() + ttlMs });
          inflight.delete(key);
          return value;
        },
        (err) => {
          inflight.delete(key);
          throw err;
        }
      );
      inflight.set(key, promise);
      return promise;
    },

    invalidate(key: string): void {
      store.delete(key);
    },

    clear(): void {
      store.clear();
    },
  };
}
