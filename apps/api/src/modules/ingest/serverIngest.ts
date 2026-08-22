import { createHash, randomUUID } from 'node:crypto';

import { sanitizeTelemetry } from '../../../../../packages/security/src/telemetry/sanitizer.js';

import { type NonceStore, verifyServerIngestRequest } from './hmac.js';

const maximumServerPayloadBytes = 512 * 1024;
const serverSources = new Set([
  'api',
  'database',
  'document_store',
  'job',
  'provider',
  'process',
  'deployment',
  'synthetic'
]);

type ServerSource =
  | 'api'
  | 'database'
  | 'document_store'
  | 'job'
  | 'provider'
  | 'process'
  | 'deployment'
  | 'synthetic';

type ServerIngestClient = {
  id: string;
  clientKind: 'server' | 'worker' | 'synthetic';
  status: 'active' | 'disabled' | 'rotated';
  secretReference: string;
};

export type ServerIngestStore = {
  findServerClient: (keyId: string) => Promise<ServerIngestClient | null>;
  insertRaw: (record: {
    id: string;
    receivedAt: Date;
    ingestClientId: string;
    idempotencyKey: string;
    eventId: string;
    source: ServerSource;
    requestId?: string;
    traceId?: string;
    payload: { envelope: ReturnType<typeof sanitizeTelemetry>['envelope'] };
    payloadHash: string;
    redacted: boolean;
  }) => Promise<{ duplicate: boolean }>;
};

type ServerIngestResult =
  | { status: 202; accepted: true; duplicate: boolean; eventId: string }
  | { status: 400 | 401 | 413; accepted: false; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidEnvelope(input: Record<string, unknown>): input is Record<string, unknown> & {
  eventId: string;
  idempotencyKey: string;
  source: ServerSource;
} {
  return (
    input.schemaVersion === 1 &&
    typeof input.eventId === 'string' &&
    /^EVT_[0-9A-HJKMNP-TV-Z]{26}$/.test(input.eventId) &&
    typeof input.idempotencyKey === 'string' &&
    input.idempotencyKey.length >= 16 &&
    typeof input.source === 'string' &&
    serverSources.has(input.source)
  );
}

function parseEnvelope(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createServerIngestService(input: {
  store: ServerIngestStore;
  nonceStore: NonceStore;
  resolveSecret: (reference: string) => Promise<string | null>;
  sessionPepper: string;
  now?: () => Date;
}): {
  ingest: (input: {
    keyId?: string;
    signature?: string;
    timestamp?: string;
    nonce?: string;
    clientIp: string;
    rawBody: string;
  }) => Promise<ServerIngestResult>;
} {
  const now = input.now ?? (() => new Date());

  return {
    ingest: async (request) => {
      if (Buffer.byteLength(request.rawBody, 'utf8') > maximumServerPayloadBytes) {
        return { status: 413, accepted: false, code: 'PAYLOAD_TOO_LARGE' };
      }
      if (!request.keyId || !request.signature || !request.timestamp || !request.nonce) {
        return { status: 401, accepted: false, code: 'MISSING_AUTHENTICATION' };
      }

      const client = await input.store.findServerClient(request.keyId);
      if (!client || client.status !== 'active') {
        return { status: 401, accepted: false, code: 'INVALID_CLIENT' };
      }
      const secret = await input.resolveSecret(client.secretReference);
      if (!secret) {
        return { status: 401, accepted: false, code: 'INVALID_CLIENT' };
      }
      const verification = await verifyServerIngestRequest({
        secret,
        signature: request.signature,
        nonceStore: input.nonceStore,
        now: now(),
        method: 'POST',
        path: '/api/v1/ingest/server',
        timestamp: request.timestamp,
        nonce: request.nonce,
        rawBody: request.rawBody
      });
      if (!verification.ok) {
        return { status: 401, accepted: false, code: verification.code };
      }

      const untrustedEnvelope = parseEnvelope(request.rawBody);
      if (!untrustedEnvelope || !isValidEnvelope(untrustedEnvelope)) {
        return { status: 400, accepted: false, code: 'INVALID_ENVELOPE' };
      }

      const sanitized = sanitizeTelemetry(untrustedEnvelope, { sessionPepper: input.sessionPepper });
      const receivedAt = now();
      const stored = await input.store.insertRaw({
        id: randomUUID(),
        receivedAt,
        ingestClientId: client.id,
        idempotencyKey: sanitized.envelope.idempotencyKey,
        eventId: sanitized.envelope.eventId,
        source: untrustedEnvelope.source,
        ...(sanitized.envelope.context.requestId
          ? { requestId: sanitized.envelope.context.requestId }
          : {}),
        ...(sanitized.envelope.context.traceId ? { traceId: sanitized.envelope.context.traceId } : {}),
        payload: { envelope: sanitized.envelope },
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
