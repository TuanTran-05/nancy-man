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
});
