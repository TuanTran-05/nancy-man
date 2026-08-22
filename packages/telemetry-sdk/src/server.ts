import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';

import { createEventId } from './ids.js';

export function createServerTelemetry(input: {
  release: string;
  service: string;
  transport: (envelope: TelemetryEnvelopeV1) => Promise<void>;
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

      try {
        await input.transport(envelope);
      } catch {
        // Server spool delivery is fail-open for the originating request.
      }

      return eventId;
    }
  };
}
