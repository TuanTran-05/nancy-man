import { describe, expect, it, vi } from 'vitest';

import { createSqlWorkerRuntimeTelemetry } from './runtimeTelemetry.js';

describe('SQL worker runtime telemetry', () => {
  it('captures failures with an isolated SQL worker spool and service identity', async () => {
    const enqueue = vi.fn(async () => ({ queued: true, evicted: 0 }));
    const telemetry = createSqlWorkerRuntimeTelemetry({
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

    telemetry.captureException(new Error('worker startup failed'), {
      code: 'SQL_WORKER_STARTUP_FAILED',
      source: 'process'
    });
    await Promise.resolve();

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ service: 'edutrack-ops-sql-worker' })
      })
    );
  });
});
