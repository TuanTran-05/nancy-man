import { describe, expect, it } from 'vitest';

import { createRuntimeTelemetry } from './runtimeTelemetry.js';

describe('API runtime telemetry', () => {
  it('captures an original exception with a stable event ID and API context', async () => {
    const delivered: unknown[] = [];
    const telemetry = createRuntimeTelemetry({
      enabled: true,
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-ops-api',
      transport: async (envelope) => {
        delivered.push(envelope);
      }
    });
    const error = new Error('database unavailable');

    const firstId = telemetry.captureException(error, {
      code: 'API_UNHANDLED_EXCEPTION',
      source: 'api',
      route: '/api/v1/issues',
      method: 'GET',
      status: 500
    });
    const secondId = telemetry.captureException(error, {
      code: 'REQUEST_FAILED',
      source: 'api',
      route: '/api/v1/issues',
      method: 'GET',
      status: 500
    });

    await Promise.resolve();

    expect(firstId).toMatch(/^EVT_/);
    expect(secondId).toBe(firstId);
    expect(delivered).toEqual([
      expect.objectContaining({
        eventId: firstId,
        source: 'api',
        error: expect.objectContaining({ code: 'API_UNHANDLED_EXCEPTION' }),
        context: expect.objectContaining({ route: '/api/v1/issues', service: 'edutrack-ops-api' })
      })
    ]);
  });

  it('marks required but disabled telemetry as unhealthy without throwing from capture', () => {
    const telemetry = createRuntimeTelemetry({
      enabled: false,
      required: true,
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-ops-api',
      transport: async () => undefined
    });

    expect(telemetry.healthy()).toBe(false);
    expect(telemetry.captureException(new Error('still respond'), { code: 'API_UNHANDLED_EXCEPTION' }))
      .toBeUndefined();
  });
});
