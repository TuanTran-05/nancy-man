import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { sanitizeBrowserTelemetry } from '../../security/src/telemetry/sanitizer.browser.js';

import { createBrowserEventId } from './ids.browser.js';

const maximumBrowserEnvelopeBytes = 64 * 1024;

type TelemetrySpool = {
  enqueue: (envelope: TelemetryEnvelopeV1) => Promise<{ queued: boolean; evicted: number }>;
  flush: (
    deliver: (envelope: TelemetryEnvelopeV1) => Promise<{ acknowledgedIdempotencyKey: string }>
  ) => Promise<unknown>;
};

function boundedText(value: string | undefined, maximumLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.slice(0, maximumLength);
}

function safeErrorText(error: Error, property: 'name' | 'message' | 'stack'): string | undefined {
  try {
    const value = error[property];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createBrowserTelemetry(input: {
  release: string;
  service: string;
  transport: (envelope: TelemetryEnvelopeV1) => Promise<void>;
  spool?: TelemetrySpool;
  now?: () => Date;
}): {
  captureException: (
    error: unknown,
    context?: Pick<
      TelemetryEnvelopeV1['context'],
      'requestId' | 'traceId' | 'route' | 'tags' | 'breadcrumbs'
    > & {
      eventId?: `EVT_${string}`;
      source?: TelemetryEnvelopeV1['source'];
      level?: TelemetryEnvelopeV1['level'];
      code?: string;
      componentStack?: string;
    }
  ) => Promise<`EVT_${string}`>;
} {
  const now = input.now ?? (() => new Date());

  return {
    captureException: async (error, context = {}) => {
      const {
        eventId: suppliedEventId,
        source = 'browser',
        level = 'error',
        code = 'BROWSER_EXCEPTION',
        componentStack,
        ...contextWithBreadcrumbs
      } = context;
      const eventId = suppliedEventId ?? createBrowserEventId();
      const exception = error instanceof Error ? error : new Error('Unknown browser error');
      const { breadcrumbs, ...contextWithoutBreadcrumbs } = contextWithBreadcrumbs;
      const stack = boundedText(safeErrorText(exception, 'stack'), 24_000);
      const safeComponentStack = boundedText(componentStack, 8_000);
      const envelope: TelemetryEnvelopeV1 = {
        schemaVersion: 1,
        eventId,
        idempotencyKey: eventId,
        capturedAt: now().toISOString(),
        source,
        level,
        error: {
          name: boundedText(safeErrorText(exception, 'name'), 120) ?? 'Error',
          code: boundedText(code, 120) ?? 'BROWSER_EXCEPTION',
          safeMessage: boundedText(safeErrorText(exception, 'message'), 2_000) ?? 'Browser error',
          ...(stack ? { stack } : {}),
          ...(safeComponentStack ? { componentStack: safeComponentStack } : {})
        },
        context: {
          ...contextWithoutBreadcrumbs,
          ...(breadcrumbs ? { breadcrumbs: breadcrumbs.slice(-30) } : {}),
          release: input.release,
          service: input.service,
          environment: 'production'
        }
      };

      if (
        new TextEncoder().encode(JSON.stringify(envelope)).byteLength > maximumBrowserEnvelopeBytes
      ) {
        throw new Error('Browser telemetry envelope exceeds 64 KiB');
      }

      const sanitizedEnvelope = sanitizeBrowserTelemetry(envelope).envelope;

      if (
        new TextEncoder().encode(JSON.stringify(sanitizedEnvelope)).byteLength >
        maximumBrowserEnvelopeBytes
      ) {
        throw new Error('Browser telemetry envelope exceeds 64 KiB');
      }

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
          // Delivery is intentionally fail-open; the spool implementation retries later.
        }
      }

      return eventId;
    }
  };
}
