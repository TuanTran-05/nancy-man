import type { TelemetryEnvelopeV1, TelemetrySource } from '../../../../packages/contracts/src/telemetry.js';

export type NormalizedEvent = {
  eventId: `EVT_${string}`;
  occurredAt: Date;
  receivedAt: Date;
  source: TelemetrySource;
  severity: 'critical' | 'high' | 'medium' | 'low';
  errorCode: string;
  exceptionType: string;
  safeMessage: string;
  service: string;
  release: string;
  ingestClientId?: string;
  requestId?: `REQ_${string}`;
  traceId?: string;
  route?: string;
  userRef?: string;
  userRole?: string;
  userDisplayLabel?: string;
  sessionHash?: string;
  tags: Record<string, string>;
  breadcrumbs: Array<{ at: string; category: string; message: string }>;
  stackFrames: string[];
  stackTrace?: string;
  componentStack?: string;
};

type SignedIdentity = {
  userRef: string;
  role: string;
  displayLabel: string;
  sessionHash: string;
};

function occurredAt(value: string, fallback: Date): Date {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : fallback;
}

function stackFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .map((line) => line.trim().replace(/^at\s+/, ''))
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('Error:') &&
        !line.startsWith('TypeError:') &&
        !/^(chrome|moz|safari)-extension:/i.test(line) &&
        !/node_modules|<anonymous>/i.test(line)
    )
    .slice(0, 8);
}

function severity(envelope: TelemetryEnvelopeV1): NormalizedEvent['severity'] {
  if (envelope.level === 'fatal') return 'critical';
  if (/(DB_UNAVAILABLE|AUTH_UNAVAILABLE|DATA_LOSS|WAL_|BACKUP_)/.test(envelope.error.code)) {
    return 'critical';
  }
  if (envelope.source === 'database' || envelope.source === 'process' || envelope.source === 'deployment') {
    return 'high';
  }
  return envelope.level === 'warning' ? 'low' : 'medium';
}

export function normalizeEvent(input: {
  receivedAt: Date;
  envelope: TelemetryEnvelopeV1;
  identity?: SignedIdentity;
  ingestClientId?: string;
}): NormalizedEvent {
  const { envelope, identity } = input;
  return {
    eventId: envelope.eventId,
    occurredAt: occurredAt(envelope.capturedAt, input.receivedAt),
    receivedAt: input.receivedAt,
    source: envelope.source,
    severity: severity(envelope),
    errorCode: envelope.error.code,
    exceptionType: envelope.error.name,
    safeMessage: envelope.error.safeMessage,
    service: envelope.context.service,
    release: envelope.context.release,
    ...(input.ingestClientId ? { ingestClientId: input.ingestClientId } : {}),
    ...(envelope.context.requestId ? { requestId: envelope.context.requestId } : {}),
    ...(envelope.context.traceId ? { traceId: envelope.context.traceId } : {}),
    ...(envelope.context.route ? { route: envelope.context.route } : {}),
    ...(identity
      ? {
          userRef: identity.userRef,
          userRole: identity.role,
          userDisplayLabel: identity.displayLabel,
          sessionHash: identity.sessionHash
        }
      : {}),
    tags: envelope.context.tags ?? {},
    breadcrumbs: envelope.context.breadcrumbs ?? [],
    stackFrames: stackFrames(envelope.error.stack),
    ...(envelope.error.stack ? { stackTrace: envelope.error.stack } : {}),
    ...(envelope.error.componentStack ? { componentStack: envelope.error.componentStack } : {})
  };
}
