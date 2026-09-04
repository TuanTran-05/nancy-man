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
} {
  const eventIds = new WeakMap<Error, `EVT_${string}`>();
  const delivered = new WeakSet<Error>();
  const nextEventId = input.createEventId ?? createEventId;

  const eventIdFor = (error: unknown): `EVT_${string}` | undefined =>
    error instanceof Error ? eventIds.get(error) : undefined;

  const reportCaptureFailure = (error: unknown): void => {
    try {
      input.onCaptureFailure?.(error);
    } catch {
      // Telemetry diagnostics must never replace the originating exception.
    }
  };

  return {
    eventIdFor,
    captureOnce: (error, context) => {
      const exception = normalizeException(error);
      const eventId = eventIds.get(exception) ?? nextEventId();
      eventIds.set(exception, eventId);
      if (delivered.has(exception)) return eventId;

      delivered.add(exception);
      try {
        void Promise.resolve(input.capture(exception, { ...context, eventId })).catch(
          reportCaptureFailure
        );
      } catch (captureFailure) {
        reportCaptureFailure(captureFailure);
      }
      return eventId;
    }
  };
}
