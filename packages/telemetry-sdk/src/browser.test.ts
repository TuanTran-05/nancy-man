import { describe, expect, it } from 'vitest';

import { createBrowserTelemetry } from './browser.js';

describe('browser telemetry factory', () => {
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
});
