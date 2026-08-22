import { createHash, randomUUID } from 'node:crypto';

import { sanitizeTelemetry } from '../../../../../packages/security/src/telemetry/sanitizer.js';
import { verifyTelemetryContextToken } from '../../../../../packages/security/src/telemetry/contextToken.js';

const maximumBrowserPayloadBytes = 64 * 1024;

type BrowserIngestClient = {
  id: string;
  clientKind: 'browser';
  status: 'active' | 'disabled' | 'rotated';
  allowedOrigins: string[];
};

type SignedBrowserIdentity = {
  userRef: string;
  role: string;
  displayLabel: string;
  sessionHash: string;
  expiresAt: string;
};

export type RawIngestRecord = {
  id: string;
  receivedAt: Date;
  ingestClientId: string;
  idempotencyKey: string;
  eventId: string;
  source: 'browser';
  requestId?: string;
  traceId?: string;
  payload: {
    envelope: ReturnType<typeof sanitizeTelemetry>['envelope'];
    identity?: SignedBrowserIdentity;
  };
  payloadHash: string;
  redacted: boolean;
};

export type IngestStore = {
  findBrowserClient: (projectKey: string) => Promise<BrowserIngestClient | null>;
  insertRaw: (record: RawIngestRecord) => Promise<{ duplicate: boolean }>;
};

export type IngestRateLimiter = {
  allow: (input: {
    clientId: string;
    clientIp: string;
    sessionHash?: string;
    fingerprint: string;
  }) => Promise<boolean>;
};

type BrowserIngestResult =
  | { status: 202; accepted: true; duplicate: boolean; eventId: string }
  | { status: 400 | 401 | 403 | 413 | 429; accepted: false; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEnvelope(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getContextToken(input: Record<string, unknown>): string | undefined {
  const context = input.context;
  return isRecord(context) && typeof context.telemetryContextToken === 'string'
    ? context.telemetryContextToken
    : undefined;
}

function isValidEnvelopeId(input: Record<string, unknown>): boolean {
  return (
    input.schemaVersion === 1 &&
    typeof input.eventId === 'string' &&
    /^EVT_[0-9A-HJKMNP-TV-Z]{26}$/.test(input.eventId) &&
    typeof input.idempotencyKey === 'string' &&
    input.idempotencyKey.length >= 16
  );
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createBrowserIngestService(input: {
  store: IngestStore;
  sessionPepper: string;
  browserContextKeyring: Record<string, string>;
  rateLimiter: IngestRateLimiter;
  now?: () => Date;
}): {
  ingest: (input: {
    origin?: string;
    projectKey?: string;
    clientIp: string;
    rawBody: string;
  }) => Promise<BrowserIngestResult>;
} {
  const now = input.now ?? (() => new Date());

  return {
    ingest: async (request) => {
      if (Buffer.byteLength(request.rawBody, 'utf8') > maximumBrowserPayloadBytes) {
        return { status: 413, accepted: false, code: 'PAYLOAD_TOO_LARGE' };
      }
      if (!request.projectKey) {
        return { status: 401, accepted: false, code: 'MISSING_PROJECT_KEY' };
      }

      const client = await input.store.findBrowserClient(request.projectKey);
      if (!client || client.status !== 'active') {
        return { status: 401, accepted: false, code: 'INVALID_PROJECT_KEY' };
      }
      if (!request.origin || !client.allowedOrigins.includes(request.origin)) {
        return { status: 403, accepted: false, code: 'ORIGIN_NOT_ALLOWED' };
      }

      const untrustedEnvelope = parseEnvelope(request.rawBody);
      if (!untrustedEnvelope || !isValidEnvelopeId(untrustedEnvelope)) {
        return { status: 400, accepted: false, code: 'INVALID_ENVELOPE' };
      }
      if (untrustedEnvelope.source !== 'browser') {
        return { status: 400, accepted: false, code: 'INVALID_SOURCE' };
      }

      const token = getContextToken(untrustedEnvelope);
      const verifiedIdentity = token
        ? verifyTelemetryContextToken(token, input.browserContextKeyring, now())
        : null;
      const sanitized = sanitizeTelemetry(untrustedEnvelope, {
        sessionPepper: input.sessionPepper
      });
      const fingerprint = hash(
        `${sanitized.envelope.source}:${sanitized.envelope.context.service}:${sanitized.envelope.error.code}`
      );
      const allowed = await input.rateLimiter.allow({
        clientId: client.id,
        clientIp: request.clientIp,
        ...(verifiedIdentity ? { sessionHash: verifiedIdentity.sessionHash } : {}),
        fingerprint
      });
      if (!allowed) {
        return { status: 429, accepted: false, code: 'RATE_LIMITED' };
      }

      const identity = verifiedIdentity
        ? {
            userRef: verifiedIdentity.userRef,
            role: verifiedIdentity.role,
            displayLabel: verifiedIdentity.displayLabel,
            sessionHash: verifiedIdentity.sessionHash,
            expiresAt: verifiedIdentity.expiresAt
          }
        : undefined;
      const receivedAt = now();
      const stored = await input.store.insertRaw({
        id: randomUUID(),
        receivedAt,
        ingestClientId: client.id,
        idempotencyKey: sanitized.envelope.idempotencyKey,
        eventId: sanitized.envelope.eventId,
        source: 'browser',
        ...(sanitized.envelope.context.requestId
          ? { requestId: sanitized.envelope.context.requestId }
          : {}),
        ...(sanitized.envelope.context.traceId
          ? { traceId: sanitized.envelope.context.traceId }
          : {}),
        payload: { envelope: sanitized.envelope, ...(identity ? { identity } : {}) },
        payloadHash: hash(JSON.stringify(sanitized.envelope)),
        redacted: sanitized.redacted
      });

      return {
        status: 202,
        accepted: true,
        duplicate: stored.duplicate,
        eventId: sanitized.envelope.eventId
      };
    }
  };
}
