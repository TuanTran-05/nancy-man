const noncePattern = /^[A-Za-z0-9_-]{16,200}$/;

export function createExpiringNonceStore(
  input: {
    now?: () => number;
    timeToLiveMilliseconds?: number;
    maximumEntries?: number;
  } = {}
): { consume: (nonce: string) => boolean } {
  const now = input.now ?? (() => Date.now());
  const timeToLiveMilliseconds = input.timeToLiveMilliseconds ?? 120_000;
  const maximumEntries = input.maximumEntries ?? 10_000;
  if (
    !Number.isInteger(timeToLiveMilliseconds) ||
    timeToLiveMilliseconds < 1_000 ||
    timeToLiveMilliseconds > 10 * 60_000 ||
    !Number.isInteger(maximumEntries) ||
    maximumEntries < 1 ||
    maximumEntries > 100_000
  ) {
    throw new Error('SQL worker nonce store configuration is invalid');
  }
  const entries = new Map<string, number>();
  return {
    consume: (nonce) => {
      if (!noncePattern.test(nonce)) return false;
      const currentTime = now();
      for (const [value, expiresAt] of entries) {
        if (expiresAt <= currentTime) entries.delete(value);
      }
      if (entries.has(nonce) || entries.size >= maximumEntries) return false;
      entries.set(nonce, currentTime + timeToLiveMilliseconds);
      return true;
    }
  };
}
