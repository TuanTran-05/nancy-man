import { describe, expect, it } from 'vitest';

import { createServerTelemetry } from './server.js';

describe('server telemetry factory', () => {
  it('sanitizes a server exception before handing it to transport', async () => {
    const delivered: unknown[] = [];
    const telemetry = createServerTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-api',
      sessionPepper: 'test-pepper',
      transport: async (envelope) => {
        delivered.push(envelope);
      }
    });

    await telemetry.captureException(new Error('postgres://app:password@db.internal/edutrack'), {
      tags: { invoiceId: 'invoice-01', token: 'must-not-leave' }
    });

    const serialized = JSON.stringify(delivered[0]);
    expect(serialized).not.toMatch(/postgres:\/\/|password|must-not-leave/i);
    expect(serialized).toContain('[REDACTED]');
  });

  it('durably queues a server exception without waiting on remote delivery', async () => {
    const queued: unknown[] = [];
    const telemetry = createServerTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-api',
      transport: async () => {
        throw new Error('collector should not be awaited during capture');
      },
      spool: {
        enqueue: async (event) => {
          queued.push(event);
          return { queued: true, evicted: 0 };
        },
        flush: async () => ({ delivered: 0, deferred: 1 })
      }
    });

    await expect(telemetry.captureException(new Error('offline event'))).resolves.toMatch(/^EVT_/);
    expect(queued).toHaveLength(1);
  });

  it('preserves supplied event identity and error classification', async () => {
    const delivered: Array<Record<string, unknown>> = [];
    const telemetry = createServerTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-api',
      transport: async (envelope) => {
        delivered.push(envelope as unknown as Record<string, unknown>);
      }
    });

    await telemetry.captureException(new Error('provider failed'), {
      eventId: 'EVT_00000000000000000000000000',
      code: 'PROVIDER_FAILED',
      source: 'provider',
      level: 'warning'
    });

    expect(delivered[0]).toMatchObject({
      eventId: 'EVT_00000000000000000000000000',
      source: 'provider',
      level: 'warning',
      error: { code: 'PROVIDER_FAILED' }
    });
  });

  it('flushes the durable spool when the runtime requests replay', async () => {
    let flushes = 0;
    const telemetry = createServerTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-api',
      transport: async () => undefined,
      spool: {
        enqueue: async () => ({ queued: true, evicted: 0 }),
        flush: async () => {
          flushes += 1;
          return { delivered: 0, deferred: 0 };
        }
      }
    });

    await expect(telemetry.flush()).resolves.toEqual({ delivered: 0, deferred: 0 });

    expect(flushes).toBe(1);
  });

  it('returns the durable spool backlog outcome to its runtime owner', async () => {
    const telemetry = createServerTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-api',
      transport: async () => undefined,
      spool: {
        enqueue: async () => ({ queued: true, evicted: 0 }),
        flush: async () => ({ delivered: 0, deferred: 1 })
      }
    });

    await expect(telemetry.flush()).resolves.toEqual({ delivered: 0, deferred: 1 });
  });
});
