import { createEventId } from './ids.js';

export type ExceptionCaptureContext = {
  eventId: `EVT_${string}`;
  code: string;
  source?: 'api' | 'browser' | 'database' | 'document_store' | 'job' | 'provider' | 'process';
  level?: 'fatal' | 'error' | 'warning';
  requestId?: `REQ_${string}`;
  traceId?: string;
  route?: string;
  componentStack?: string;
  tags?: Record<string, string>;
};

const eventIdProperty: unique symbol = Symbol('edutrackTelemetryEventId');
const eventIds = new WeakMap<Error, `EVT_${string}`>();
const delivered = new WeakSet<Error>();

type IdentifiedException = Error & {
  [eventIdProperty]?: `EVT_${string}`;
};

export function eventIdForException(error: unknown): `EVT_${string}` | undefined {
  return error instanceof Error
    ? ((error as IdentifiedException)[eventIdProperty] ?? eventIds.get(error))
    : undefined;
}

export function normalizeException(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (error === undefined) return new Error('Unknown exception');
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

export function createExceptionCapture(input: {
  capture: (error: Error, context: ExceptionCaptureContext) => void | Promise<void>;
  createEventId?: () => `EVT_${string}`;
  onCaptureFailure?: (error: unknown) => void;
}): {
  captureOnce: (
    error: unknown,
    context: Omit<ExceptionCaptureContext, 'eventId'>
  ) => `EVT_${string}`;
  eventIdFor: (error: unknown) => `EVT_${string}` | undefined;
  flush: () => Promise<void>;
} {
  const nextEventId = input.createEventId ?? createEventId;
  const pendingCaptures = new Set<Promise<void>>();

  const storeEventId = (error: Error, eventId: `EVT_${string}`): void => {
    try {
      Object.defineProperty(error, eventIdProperty, {
        configurable: false,
        enumerable: false,
        value: eventId,
        writable: false
      });
    } catch {
      eventIds.set(error, eventId);
    }
  };

  const reportCaptureFailure = (error: unknown): void => {
    try {
      input.onCaptureFailure?.(error);
    } catch {
      // Telemetry diagnostics must never replace the originating exception.
    }
  };

  return {
    eventIdFor: eventIdForException,
    flush: async () => {
      await Promise.all([...pendingCaptures]);
    },
    captureOnce: (error, context) => {
      const exception = normalizeException(error);
      const eventId = eventIdForException(exception) ?? nextEventId();
      storeEventId(exception, eventId);
      if (delivered.has(exception)) return eventId;

      delivered.add(exception);
      try {
        const delivery = Promise.resolve(input.capture(exception, { ...context, eventId })).catch(
          reportCaptureFailure
        );
        pendingCaptures.add(delivery);
        void delivery.finally(() => pendingCaptures.delete(delivery));
      } catch (captureFailure) {
        reportCaptureFailure(captureFailure);
      }
      return eventId;
    }
  };
}
