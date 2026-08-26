import { createHash } from 'node:crypto';

import type { TelemetryEnvelopeV1, TelemetrySource } from '../../../contracts/src/telemetry.js';

const allowedSources = new Set<TelemetrySource>([
  'browser',
  'api',
  'database',
  'document_store',
  'job',
  'provider',
  'process',
  'deployment',
  'synthetic'
]);
const allowedTagKeys = new Set(['studentId', 'classId', 'invoiceId', 'jobName']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoundedString(value: unknown, maximumLength: number, fallback: string): string {
  return typeof value === 'string' ? value.slice(0, maximumLength) : fallback;
}

function sanitizeText(value: string): { value: string; redacted: boolean } {
  const patterns = [
    /postgres(?:ql)?:\/\/[^\s"')]+/gi,
    /bearer\s+[a-z0-9._~+/=-]+/gi,
    /(?:password|otp|authorization|api[_-]?key|token|cookie|csrf)\s*[:=]\s*[^\s,;)&]+/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /(?<!\d)(?:\+?84|0)\d{9,10}(?!\d)/g
  ];
  let sanitized = value;

  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return { value: sanitized, redacted: sanitized !== value };
}

function sanitizeTags(value: unknown): { tags: Record<string, string>; redacted: boolean } {
  if (!isRecord(value)) {
    return { tags: {}, redacted: value !== undefined };
  }

  const tags: Record<string, string> = {};
  let redacted = false;
  for (const [key, rawValue] of Object.entries(value)) {
    if (!allowedTagKeys.has(key) || typeof rawValue !== 'string') {
      redacted = true;
      continue;
    }
    const sanitized = sanitizeText(rawValue.slice(0, 128));
    tags[key] = sanitized.value;
    redacted ||= sanitized.redacted;
  }

  return { tags, redacted };
}

export function sanitizeTelemetry(
  input: unknown,
  options: { sessionPepper: string }
): { envelope: TelemetryEnvelopeV1; redacted: boolean } {
  const source = isRecord(input) ? input : {};
  const errorInput = isRecord(source.error) ? source.error : {};
  const contextInput = isRecord(source.context) ? source.context : {};
  const safeMessage = sanitizeText(
    asBoundedString(errorInput.safeMessage, 2_000, 'Telemetry error')
  );
  const stack =
    typeof errorInput.stack === 'string' ? sanitizeText(errorInput.stack.slice(0, 24_000)) : null;
  const componentStack =
    typeof errorInput.componentStack === 'string'
      ? sanitizeText(errorInput.componentStack.slice(0, 12_000))
      : null;
  const route =
    typeof contextInput.route === 'string' ? sanitizeText(contextInput.route.slice(0, 512)) : null;
  const tagResult = sanitizeTags(contextInput.tags);
  const breadcrumbs = Array.isArray(contextInput.breadcrumbs)
    ? contextInput.breadcrumbs.slice(-30).flatMap((breadcrumb) => {
        if (!isRecord(breadcrumb)) return [];
        const message = sanitizeText(asBoundedString(breadcrumb.message, 512, '[REDACTED]'));
        return [
          {
            at: asBoundedString(breadcrumb.at, 40, new Date(0).toISOString()),
            category: asBoundedString(breadcrumb.category, 64, 'unknown'),
            message: message.value,
            redacted: message.redacted
          }
        ];
      })
    : [];
  const sourceName =
    typeof source.source === 'string' && allowedSources.has(source.source as TelemetrySource)
      ? (source.source as TelemetrySource)
      : 'api';
  const level = source.level === 'fatal' || source.level === 'warning' ? source.level : 'error';
  const sessionHash =
    typeof contextInput.sessionId === 'string'
      ? createHash('sha256')
          .update(`${contextInput.sessionId}${options.sessionPepper}`, 'utf8')
          .digest('hex')
      : undefined;
  const redacted =
    safeMessage.redacted ||
    Boolean(stack?.redacted) ||
    Boolean(componentStack?.redacted) ||
    Boolean(route?.redacted) ||
    tagResult.redacted ||
    breadcrumbs.some((breadcrumb) => breadcrumb.redacted) ||
    Object.keys(source).some(
      (key) =>
        ![
          'schemaVersion',
          'eventId',
          'idempotencyKey',
          'capturedAt',
          'source',
          'level',
          'error',
          'context'
        ].includes(key)
    );

  const envelope: TelemetryEnvelopeV1 = {
    schemaVersion: 1,
    eventId: asBoundedString(source.eventId, 128, 'EVT_INVALID') as `EVT_${string}`,
    idempotencyKey: asBoundedString(source.idempotencyKey, 128, 'invalid'),
    capturedAt: asBoundedString(source.capturedAt, 40, new Date(0).toISOString()),
    source: sourceName,
    level,
    error: {
      name: asBoundedString(errorInput.name, 120, 'Error'),
      code: asBoundedString(errorInput.code, 128, 'UNKNOWN_ERROR'),
      safeMessage: safeMessage.value,
      ...(stack ? { stack: stack.value } : {}),
      ...(componentStack ? { componentStack: componentStack.value } : {})
    },
    context: {
      ...(typeof contextInput.requestId === 'string'
        ? { requestId: contextInput.requestId.slice(0, 128) as `REQ_${string}` }
        : {}),
      ...(typeof contextInput.traceId === 'string'
        ? { traceId: contextInput.traceId.slice(0, 128) }
        : {}),
      ...(route ? { route: route.value } : {}),
      release: asBoundedString(contextInput.release, 128, 'unknown'),
      service: asBoundedString(contextInput.service, 128, 'unknown'),
      environment: 'production',
      ...(Object.keys(tagResult.tags).length ? { tags: tagResult.tags } : {}),
      ...(breadcrumbs.length
        ? {
            breadcrumbs: breadcrumbs.map(({ at, category, message }) => ({ at, category, message }))
          }
        : {}),
      ...(sessionHash ? { tags: { ...tagResult.tags, sessionHash } } : {})
    }
  };

  return { envelope, redacted };
}
