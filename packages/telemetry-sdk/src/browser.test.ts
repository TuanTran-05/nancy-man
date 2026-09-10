import { describe, expect, it } from 'vitest';

import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { createBrowserTelemetry } from './browser.js';
import { createBrowserEventId } from './ids.browser.js';
import { sanitizeBrowserTelemetry } from '../../security/src/telemetry/sanitizer.browser.js';

describe('browser telemetry factory', () => {
  it('uses browser-only randomness for a valid event ID', () => {
    const eventId = createBrowserEventId(4_000_000_000_000, () => new Uint8Array(10).fill(7));

    expect(eventId).toMatch(/^EVT_[0-9A-HJKMNP-TV-Z]{26}$/u);
  });

  it('redacts browser input without retaining a raw session identifier', () => {
    const sanitized = sanitizeBrowserTelemetry({
      schemaVersion: 1,
      eventId: 'EVT_01K3EXAMPLE',
      idempotencyKey: 'key',
      capturedAt: '2026-08-22T03:14:00.000Z',
      source: 'browser',
      level: 'error',
      error: { name: 'Error', code: 'BROWSER_EXCEPTION', safeMessage: 'token=secret' },
      context: {
        release: '0123456789abcdef0123456789abcdef01234567',
        service: 'edutrack-web',
        environment: 'production',
        sessionId: 'raw-session-id'
      }
    });

    expect(JSON.stringify(sanitized.envelope)).not.toContain('raw-session-id');
    expect(JSON.stringify(sanitized.envelope)).toContain('[REDACTED]');
    expect(sanitized.redacted).toBe(true);
  });

  it('generates a versioned browser event within the 64 KiB payload limit', async () => {
    const delivered: unknown[] = [];
    const telemetry = createBrowserTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-web',
      transport: async (envelope) => {
        delivered.push(envelope);
      }
    });

    const eventId = await telemetry.captureException(new Error('safe failure'), {
      route: '/students'
    });

    expect(eventId).toMatch(/^EVT_/);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      schemaVersion: 1,
      source: 'browser',
      context: { route: '/students', environment: 'production' }
    });
  });

  it('rejects a browser payload larger than 64 KiB before transport', async () => {
    const telemetry = createBrowserTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-web',
      transport: async () => undefined
    });

    await expect(
      telemetry.captureException(new Error('failure'), { tags: { detail: 'x'.repeat(70 * 1024) } })
    ).rejects.toThrow(/64 KiB/i);
  });

  it('sanitizes a browser exception before handing it to transport', async () => {
    const delivered: unknown[] = [];
    const telemetry = createBrowserTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-web',
      transport: async (envelope) => {
        delivered.push(envelope);
      }
    });

    await telemetry.captureException(new Error('Bearer abc.def.ghi password=should-not-leave'), {
      route: '/students?phone=0912345678',
      tags: { studentId: 'student-01', secret: 'do-not-send' }
    });

    const serialized = JSON.stringify(delivered[0]);
    expect(serialized).not.toMatch(/Bearer |password=|0912345678|do-not-send/i);
    expect(serialized).toContain('[REDACTED]');
  });

  it('queues locally when a browser spool is configured instead of waiting for the collector', async () => {
    const queued: unknown[] = [];
    const telemetry = createBrowserTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-web',
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

  it('preserves supplied event identity, classification, and component stack', async () => {
    const delivered: Array<Record<string, unknown>> = [];
    const telemetry = createBrowserTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-web',
      transport: async (envelope) => {
        delivered.push(envelope as unknown as Record<string, unknown>);
      }
    });

    await telemetry.captureException(new Error('render failed'), {
      eventId: 'EVT_00000000000000000000000001',
      code: 'REACT_RENDER_FAILED',
      source: 'provider',
      level: 'fatal',
      componentStack: 'at StudentPage'
    });

    expect(delivered[0]).toMatchObject({
      eventId: 'EVT_00000000000000000000000001',
      source: 'provider',
      level: 'fatal',
      error: { code: 'REACT_RENDER_FAILED', componentStack: 'at StudentPage' }
    });
  });

  it('durably captures an Error whose diagnostic fields have hostile getters', async () => {
    const queued: TelemetryEnvelopeV1[] = [];
    const hostile = new Error('hidden');
    for (const property of ['name', 'message', 'stack']) {
      Object.defineProperty(hostile, property, {
        configurable: true,
        get: () => {
          throw new Error(`hostile ${property} getter`);
        }
      });
    }
    const telemetry = createBrowserTelemetry({
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-web',
      transport: async () => undefined,
      spool: {
        enqueue: async (envelope) => {
          queued.push(envelope);
          return { queued: true, evicted: 0 };
        },
        flush: async () => ({ delivered: 0, deferred: 1 })
      }
    });

    const eventId = await telemetry.captureException(hostile, { code: 'HOSTILE_ERROR' });

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      eventId,
      idempotencyKey: eventId,
      error: {
        name: 'Error',
        code: 'HOSTILE_ERROR',
        safeMessage: 'Browser error'
      }
    });
  });
});
