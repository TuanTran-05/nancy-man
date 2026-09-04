import { describe, expect, it, vi } from 'vitest';

import { createConfiguredRuntimeTelemetry, startRuntimeTelemetryMaintenance } from './runtimeTelemetry.js';

const config = {
  enabled: true as const,
  endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/server' as const,
  keyId: 'edutrack-ops-runtime',
  hmacSecretReference: 'ops-telemetry-hmac',
  release: '0123456789abcdef0123456789abcdef01234567',
  spoolRoot: '/var/lib/edutrack-ops/telemetry',
  spoolDirectory: '/var/lib/edutrack-ops/telemetry'
};

describe('server runtime telemetry facade', () => {
  it('uses a caller-scoped spool and captures the same Error only once', async () => {
    const enqueue = vi.fn(async () => ({ queued: true, evicted: 0 }));
    const flush = vi.fn(async () => ({ delivered: 0, deferred: 0 }));
    const telemetry = createConfiguredRuntimeTelemetry({
      config,
      hmacSecret: 'a'.repeat(32),
      service: 'edutrack-ops-processor',
      spool: { enqueue, flush }
    });
    const error = new Error('processor failure');

    const first = telemetry.captureException(error, { code: 'PROCESSOR_FAILED', source: 'job' });
    const second = telemetry.captureException(error, { code: 'PROCESSOR_FAILED', source: 'job' });
    await Promise.resolve();

    expect(first).toMatch(/^EVT_/);
    expect(second).toBe(first);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately and at the bounded periodic cadence', async () => {
    const flush = vi.fn(async () => undefined);
    const scheduled: Array<() => void> = [];
    const cancelled: unknown[] = [];
    const stop = startRuntimeTelemetryMaintenance({
      flush,
      setInterval: (callback) => {
        scheduled.push(callback);
        return 'timer' as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: (timer) => cancelled.push(timer)
    });

    await Promise.resolve();
    scheduled[0]?.();
    await Promise.resolve();
    stop();

    expect(flush).toHaveBeenCalledTimes(2);
    expect(cancelled).toEqual(['timer']);
  });
});
