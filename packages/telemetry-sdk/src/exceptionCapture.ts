import { createEventId } from './ids.js';

export type ExceptionDeliveryContext = {
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

type DeferredText = string | (() => unknown);

export type ExceptionCaptureContext = Omit<
  ExceptionDeliveryContext,
  'componentStack' | 'requestId' | 'route' | 'traceId'
> & {
  componentStack?: DeferredText;
  requestId?: `REQ_${string}` | (() => unknown);
  route?: DeferredText;
  traceId?: DeferredText;
  /** Use only at a transparent rethrow whose outer owner will terminally capture this Error. */
  deferUntilHandled?: boolean;
  /** A secondary failure reusing the preserved Error identity receives its own occurrence. */
  distinctFrom?: unknown;
  /** A separate raw operation may explicitly receive a new occurrence for a reused Error. */
  forceNewOccurrence?: true;
  /** Terminalize this attempt, then permit a later operation to reuse the Error as a new occurrence. */
  allowFutureOccurrence?: true;
};

const eventIds = new WeakMap<Error, `EVT_${string}`>();
const delivered = new WeakSet<Error>();
const normalizedErrorByThrownObject = new WeakMap<object, Error>();

type TerminalCaptureContext = Omit<ExceptionDeliveryContext, 'eventId'>;
type CaptureReporter = (error: Error, context: ExceptionDeliveryContext) => void | Promise<void>;
type DeferredCapture = {
  occurrenceKey: Error;
  error: Error;
  eventId: `EVT_${string}`;
  context: TerminalCaptureContext;
  capture: CaptureReporter;
  onCaptureFailure?: (error: unknown) => void;
  scheduled: boolean;
};

const deferredCaptureByError = new WeakMap<Error, DeferredCapture>();
const deferredCaptures = new Set<DeferredCapture>();
const pendingCaptures = new Set<Promise<void>>();

const genericCodes = new Set([
  'INTERNAL_ERROR',
  'REQUEST_FAILED',
  'UNHANDLED_BROWSER_EXCEPTION',
  'UNHANDLED_OPS_EXCEPTION',
  'UNHANDLED_PROMISE_REJECTION',
  'UNHANDLED_SERVER_ERROR',
  'PROCESS_UNCAUGHT_EXCEPTION',
  'PROCESS_UNHANDLED_REJECTION'
]);

function reportCaptureFailure(capture: DeferredCapture, error: unknown): void {
  try {
    capture.onCaptureFailure?.(error);
  } catch {
    // Telemetry diagnostics must never replace the originating exception.
  }
}

function mergeCaptureContext(
  earlier: TerminalCaptureContext | undefined,
  later: TerminalCaptureContext
): TerminalCaptureContext {
  if (!earlier) return later;
  const levelRank = { warning: 0, error: 1, fatal: 2 } as const;
  const earlierLevel = earlier.level;
  const laterLevel = later.level;
  const level =
    laterLevel && (!earlierLevel || levelRank[laterLevel] > levelRank[earlierLevel])
      ? laterLevel
      : earlierLevel;
  const laterIsGenericProcessOwner = later.source === 'process' && genericCodes.has(later.code);
  const code =
    genericCodes.has(later.code) && !genericCodes.has(earlier.code) ? earlier.code : later.code;
  const source = laterIsGenericProcessOwner ? earlier.source : (later.source ?? earlier.source);
  return {
    ...earlier,
    ...later,
    code,
    ...(source ? { source } : {}),
    ...(level ? { level } : {}),
    ...(earlier.tags || later.tags ? { tags: { ...earlier.tags, ...later.tags } } : {})
  };
}

function dispatchDeferredCapture(capture: DeferredCapture): void {
  if (capture.scheduled) return;
  capture.scheduled = true;
  if (deferredCaptureByError.get(capture.occurrenceKey) !== capture) return;
  deferredCaptureByError.delete(capture.occurrenceKey);
  deferredCaptures.delete(capture);
  delivered.add(capture.occurrenceKey);
  let delivery: Promise<void>;
  try {
    delivery = Promise.resolve(
      capture.capture(capture.error, { ...capture.context, eventId: capture.eventId })
    ).then(() => undefined);
  } catch (error) {
    delivered.delete(capture.occurrenceKey);
    reportCaptureFailure(capture, error);
    return;
  }
  const contained = delivery.catch((error) => {
    delivered.delete(capture.occurrenceKey);
    reportCaptureFailure(capture, error);
  });
  pendingCaptures.add(contained);
  void contained.then(
    () => pendingCaptures.delete(contained),
    () => pendingCaptures.delete(contained)
  );
}

export function eventIdForException(error: unknown): `EVT_${string}` | undefined {
  return error instanceof Error ? eventIds.get(error) : undefined;
}

export function normalizeException(error: unknown): Error {
  try {
    if (error instanceof Error) return error;
  } catch {
    // A hostile Proxy may throw during Error.prototype's hasInstance traversal.
  }
  const identity =
    (typeof error === 'object' && error !== null) || typeof error === 'function'
      ? (error as object)
      : undefined;
  const existing = identity ? normalizedErrorByThrownObject.get(identity) : undefined;
  if (existing) return existing;
  if (typeof error === 'string') return new Error(error);
  if (error === undefined) return new Error('Unknown exception');
  let normalized: Error;
  try {
    normalized = new Error(JSON.stringify(error));
  } catch {
    normalized = new Error('A non-Error value was thrown');
  }
  if (identity) normalizedErrorByThrownObject.set(identity, normalized);
  return normalized;
}

function secondaryOccurrenceKey(cause: Error): Error {
  const secondary = new Error('Secondary telemetry occurrence', { cause });
  secondary.name = 'SecondaryTelemetryOccurrence';
  return secondary;
}

export function createExceptionCapture(input: {
  capture: (error: Error, context: ExceptionDeliveryContext) => void | Promise<void>;
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

  const storeEventId = (error: Error, eventId: `EVT_${string}`): void => {
    eventIds.set(error, eventId);
  };

  const withoutDeferral = (
    context: Omit<ExceptionCaptureContext, 'eventId'>
  ): TerminalCaptureContext => {
    const terminalContext = { ...context } as Record<string, unknown>;
    for (const property of [
      'deferUntilHandled',
      'distinctFrom',
      'forceNewOccurrence',
      'allowFutureOccurrence',
      'componentStack',
      'requestId',
      'route',
      'traceId'
    ]) {
      delete terminalContext[property];
    }
    const resolveText = (value: DeferredText | undefined): string | undefined => {
      let resolved: unknown;
      try {
        resolved = typeof value === 'function' ? value() : value;
      } catch {
        return undefined;
      }
      return typeof resolved === 'string' ? resolved : undefined;
    };
    const componentStack = resolveText(context.componentStack);
    const requestId = resolveText(context.requestId);
    const route = resolveText(context.route);
    const traceId = resolveText(context.traceId);
    return {
      ...(terminalContext as TerminalCaptureContext),
      ...(componentStack ? { componentStack } : {}),
      ...(requestId?.startsWith('REQ_') ? { requestId: requestId as `REQ_${string}` } : {}),
      ...(route ? { route } : {}),
      ...(traceId ? { traceId } : {})
    };
  };

  return {
    eventIdFor: eventIdForException,
    flush: async () => {
      while (deferredCaptures.size > 0 || pendingCaptures.size > 0) {
        for (const capture of [...deferredCaptures]) dispatchDeferredCapture(capture);
        await Promise.all([...pendingCaptures]);
      }
    },
    captureOnce: (error, context) => {
      const exception = normalizeException(error);
      const matchesPreservedError =
        Object.prototype.hasOwnProperty.call(context, 'distinctFrom') &&
        Object.is(error, context.distinctFrom);
      const forceSeparateOccurrence =
        context.forceNewOccurrence === true &&
        (delivered.has(exception) || deferredCaptureByError.has(exception));
      const occurrenceKey =
        matchesPreservedError || forceSeparateOccurrence
          ? secondaryOccurrenceKey(exception)
          : exception;
      const eventId = eventIds.get(occurrenceKey) ?? nextEventId();
      storeEventId(occurrenceKey, eventId);
      if (delivered.has(occurrenceKey)) return eventId;

      const terminalContext = withoutDeferral(context);
      const pending = deferredCaptureByError.get(occurrenceKey);
      if (context.deferUntilHandled === true) {
        if (pending) {
          pending.context = mergeCaptureContext(pending.context, terminalContext);
          pending.capture = input.capture;
          if (input.onCaptureFailure) pending.onCaptureFailure = input.onCaptureFailure;
          else delete pending.onCaptureFailure;
        } else {
          const deferred: DeferredCapture = {
            occurrenceKey,
            error: exception,
            eventId,
            context: terminalContext,
            capture: input.capture,
            ...(input.onCaptureFailure ? { onCaptureFailure: input.onCaptureFailure } : {}),
            scheduled: false
          };
          deferredCaptureByError.set(occurrenceKey, deferred);
          deferredCaptures.add(deferred);
        }
        return eventId;
      }
      const terminal: DeferredCapture = pending ?? {
        occurrenceKey,
        error: exception,
        eventId,
        context: terminalContext,
        capture: input.capture,
        ...(input.onCaptureFailure ? { onCaptureFailure: input.onCaptureFailure } : {}),
        scheduled: false
      };
      terminal.context = mergeCaptureContext(pending?.context, terminalContext);
      terminal.capture = input.capture;
      if (input.onCaptureFailure) terminal.onCaptureFailure = input.onCaptureFailure;
      else delete terminal.onCaptureFailure;
      if (!pending) {
        deferredCaptureByError.set(occurrenceKey, terminal);
        deferredCaptures.add(terminal);
      }
      dispatchDeferredCapture(terminal);
      if (context.allowFutureOccurrence === true) {
        eventIds.delete(exception);
        delivered.delete(exception);
      }
      return eventId;
    }
  };
}
