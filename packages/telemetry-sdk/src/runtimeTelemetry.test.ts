import { describe, expect, it, vi } from 'vitest';

import {
  createConfiguredRuntimeTelemetry,
  createRuntimeTelemetry,
  startRuntimeTelemetryMaintenance
} from './runtimeTelemetry.js';

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
  it('waits for a pending capture enqueue before flushing the spool', async () => {
    let releaseEnqueue: (() => void) | undefined;
    const enqueue = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseEnqueue = resolve;
      });
      return { queued: true, evicted: 0 };
    });
    const flush = vi.fn(async () => ({ delivered: 0, deferred: 0 }));
    const telemetry = createRuntimeTelemetry({
      enabled: true,
      release: config.release,
      service: 'edutrack-ops-api',
      transport: async () => undefined,
      spool: { enqueue, flush }
    });

    telemetry.captureException(new Error('slow enqueue'), {
      code: 'SERVER_EXCEPTION',
      source: 'api'
    });
    const flushing = telemetry.flush();

    await Promise.resolve();
    expect(flush).not.toHaveBeenCalled();

    releaseEnqueue?.();
    await flushing;

    expect(flush).toHaveBeenCalledTimes(2);
  });

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

  it('becomes unhealthy after its durable spool rejects an enqueue or flush', async () => {
    const enqueueFailure = new Error('spool unavailable');
    const telemetry = createRuntimeTelemetry({
      enabled: true,
      release: config.release,
      service: 'edutrack-ops-api',
      transport: async () => undefined,
      spool: {
        enqueue: async () => {
          throw enqueueFailure;
        },
        flush: async () => {
          throw new Error('flush unavailable');
        }
      }
    });

    telemetry.captureException(new Error('request failed'), {
      code: 'REQUEST_FAILED',
      source: 'api'
    });
    await Promise.resolve();

    expect(telemetry.healthy()).toBe(false);
    await expect(telemetry.flush()).rejects.toThrow('flush unavailable');
    expect(telemetry.healthy()).toBe(false);
  });

  it('degrades while durable records are deferred and recovers after they drain', async () => {
    const outcomes = [
      { delivered: 0, deferred: 1 },
      { delivered: 1, deferred: 0 }
    ];
    const telemetry = createRuntimeTelemetry({
      enabled: true,
      release: config.release,
      service: 'edutrack-ops-api',
      transport: async () => undefined,
      spool: {
        enqueue: async () => ({ queued: true, evicted: 0 }),
        flush: async () => outcomes.shift() ?? { delivered: 0, deferred: 0 }
      }
    });

    await telemetry.flush();
    expect(telemetry.healthy()).toBe(false);

    await telemetry.flush();
    expect(telemetry.healthy()).toBe(true);
  });

  it('degrades when the spool cannot queue an occurrence', async () => {
    const telemetry = createRuntimeTelemetry({
      enabled: true,
      release: config.release,
      service: 'edutrack-ops-api',
      transport: async () => undefined,
      spool: {
        enqueue: async () => ({ queued: false, evicted: 0 }),
        flush: async () => ({ delivered: 0, deferred: 0 })
      }
    });

    telemetry.captureException(new Error('oversized occurrence'), {
      code: 'OVERSIZED_OCCURRENCE',
      source: 'api'
    });

    await vi.waitFor(() => expect(telemetry.healthy()).toBe(false));
  });

  it('degrades on eviction and recovers when the retained spool drains', async () => {
    let releaseFlush: (() => void) | undefined;
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const telemetry = createRuntimeTelemetry({
      enabled: true,
      release: config.release,
      service: 'edutrack-ops-api',
      transport: async () => undefined,
      spool: {
        enqueue: async () => ({ queued: true, evicted: 1 }),
        flush: async () => {
          await flushGate;
          return { delivered: 1, deferred: 0 };
        }
      }
    });

    telemetry.captureException(new Error('spool pressure'), {
      code: 'SPOOL_PRESSURE',
      source: 'api'
    });
    await vi.waitFor(() => expect(telemetry.healthy()).toBe(false));

    releaseFlush?.();
    await telemetry.flush();
    expect(telemetry.healthy()).toBe(true);
  });
});
