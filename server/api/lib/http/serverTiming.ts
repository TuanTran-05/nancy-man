type TimingEntry = {
  name: string;
  durationMs: number;
};

type MaybePromise<T> = T | Promise<T>;

function nowMs(): number {
  return Date.now();
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'metric';
}

export function shouldEmitServerTiming(
  nodeEnv = process.env.NODE_ENV,
  debugTiming = process.env.API_DEBUG_TIMING
): boolean {
  return nodeEnv !== 'production' || debugTiming === '1';
}

export function createServerTiming() {
  const entries: TimingEntry[] = [];

  function record(name: string, durationMs: number): void {
    entries.push({ name: sanitizeMetricName(name), durationMs });
  }

  return {
    measure<T>(name: string, callback: () => MaybePromise<T>): MaybePromise<T> {
      const startedAt = nowMs();
      try {
        const result = callback();
        if (result && typeof (result as Promise<T>).then === 'function') {
          return (result as Promise<T>).finally(() => record(name, nowMs() - startedAt));
        }
        record(name, nowMs() - startedAt);
        return result;
      } catch (err) {
        record(name, nowMs() - startedAt);
        throw err;
      }
    },

    header(): string {
      return entries
        .map((entry) => `${entry.name};dur=${Math.max(0, entry.durationMs).toFixed(1)}`)
        .join(', ');
    },
  };
}
