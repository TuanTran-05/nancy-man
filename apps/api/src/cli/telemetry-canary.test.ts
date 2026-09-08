import { describe, expect, it, vi } from 'vitest';

import {
  createTelemetryCanaryEnvelope,
  runTelemetryCanary,
  type TelemetryCanaryEnvelope
} from './telemetry-canary.js';

const accepted = async (envelope: TelemetryCanaryEnvelope) => ({
  accepted: true as const,
  eventId: envelope.eventId
});

describe('telemetry canary', () => {
  it('fails if man does not persist the emitted canary event', async () => {
    await expect(
      runTelemetryCanary({ ingest: accepted, findOccurrence: async () => null, timeoutMs: 10 })
    ).rejects.toThrow('TELEMETRY_CANARY_NOT_OBSERVED');
  });

  it('polls by the emitted event ID until the processor persists an occurrence', async () => {
    const findOccurrence = vi
      .fn<(_: string) => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ eventId: 'persisted' });

    const result = await runTelemetryCanary({
      ingest: accepted,
      findOccurrence,
      timeoutMs: 100,
      pollMs: 1,
      sleep: async () => undefined
    });

    expect(result.eventId).toMatch(/^EVT_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(findOccurrence).toHaveBeenLastCalledWith(result.eventId);
  });

  it('builds a synthetic production envelope without a server secret', () => {
    const envelope = createTelemetryCanaryEnvelope({
      release: 'a'.repeat(40),
      service: 'edutrack-platform-runtime',
      now: () => new Date('2026-09-09T00:00:00.000Z')
    });

    expect(envelope).toMatchObject({
      source: 'synthetic',
      level: 'error',
      context: {
        release: 'a'.repeat(40),
        service: 'edutrack-platform-runtime',
        environment: 'production'
      },
      error: { code: 'TELEMETRY_CANARY' }
    });
    expect(JSON.stringify(envelope)).not.toContain('HMAC');
  });
});
