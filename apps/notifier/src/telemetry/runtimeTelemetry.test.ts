import { describe, expect, it, vi } from 'vitest';

import { createNotifierRuntimeTelemetry } from './runtimeTelemetry.js';

describe('notifier runtime telemetry', () => {
  it('sends notifier failures through its isolated spool facade', async () => {
    const enqueue = vi.fn(async () => ({ queued: true, evicted: 0 }));
    const telemetry = createNotifierRuntimeTelemetry({
      config: {
        enabled: true,
        endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/server',
        keyId: 'edutrack-ops-runtime',
        hmacSecretReference: 'ops-telemetry-hmac',
        release: '0123456789abcdef0123456789abcdef01234567',
        spoolRoot: '/var/lib/edutrack-ops/telemetry',
        spoolDirectory: '/var/lib/edutrack-ops/telemetry'
      },
      hmacSecret: 'a'.repeat(32),
      spool: { enqueue, flush: async () => ({ delivered: 0, deferred: 0 }) }
    });

    telemetry.captureException(new Error('scheduler failed'), {
      code: 'NOTIFIER_SCHEDULER_FAILED',
      source: 'job'
    });
    await Promise.resolve();

    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
