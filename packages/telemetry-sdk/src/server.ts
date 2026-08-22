import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { sanitizeTelemetry } from '../../security/src/telemetry/sanitizer.js';

import { createEventId } from './ids.js';

type TelemetrySpool = {
  enqueue: (envelope: TelemetryEnvelopeV1) => Promise<{ queued: boolean; evicted: number }>;
  flush: (
    deliver: (envelope: TelemetryEnvelopeV1) => Promise<{ acknowledgedIdempotencyKey: string }>
  ) => Promise<unknown>;
};

export function createServerTelemetry(input: {
  release: string;
  service: string;
  sessionPepper?: string;
  transport: (envelope: TelemetryEnvelopeV1) => Promise<void>;
  spool?: TelemetrySpool;
  now?: () => Date;
}): {
  captureException: (
    error: unknown,
    context?: Pick<TelemetryEnvelopeV1['context'], 'requestId' | 'traceId' | 'route' | 'tags'>
  ) => Promise<`EVT_${string}`>;
} {
  const now = input.now ?? (() => new Date());

  return {
    captureException: async (error, context = {}) => {
      const eventId = createEventId();
      const exception = error instanceof Error ? error : new Error('Unknown server error');
      const stack = exception.stack?.slice(0, 24_000);
      const envelope: TelemetryEnvelopeV1 = {
        schemaVersion: 1,
        eventId,
        idempotencyKey: eventId,
        capturedAt: now().toISOString(),
        source: 'api',
        level: 'error',
        error: {
          name: exception.name.slice(0, 120),
          code: 'SERVER_EXCEPTION',
          safeMessage: exception.message.slice(0, 2_000),
          ...(stack ? { stack } : {})
        },
        context: {
          ...context,
          release: input.release,
          service: input.service,
          environment: 'production'
        }
      };

      const sanitizedEnvelope = sanitizeTelemetry(envelope, {
        sessionPepper: input.sessionPepper ?? 'server-telemetry-session-id-not-provided'
      }).envelope;
      if (input.spool) {
        await input.spool.enqueue(sanitizedEnvelope);
        void input.spool
          .flush(async (queued) => {
            await input.transport(queued);
            return { acknowledgedIdempotencyKey: queued.idempotencyKey };
          })
          .catch(() => undefined);
      } else {
        try {
          await input.transport(sanitizedEnvelope);
        } catch {
          // Remote capture is fail-open for the originating request.
        }
      }

      return eventId;
    }
  };
}
