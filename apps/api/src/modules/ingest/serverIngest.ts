import { createHash, randomUUID } from 'node:crypto';

import { sanitizeTelemetry } from '../../../../../packages/security/src/telemetry/sanitizer.js';

import { type NonceStore, verifyServerIngestRequest } from './hmac.js';

const maximumServerPayloadBytes = 512 * 1024;
const maximumServerBatchBytes = 5 * 1024 * 1024;
const maximumServerBatchEvents = 100;
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

type ServerIngestRequest = {
  keyId?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
  clientIp: string;
  rawBody: string;
};

type ServerBatchResult =
  | {
      status: 202 | 207;
      accepted: number;
      rejected: number;
      results: Array<
        { accepted: true; eventId: string; duplicate: boolean } | { accepted: false; code: string }
      >;
    }
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

function parseBatch(rawBody: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return Array.isArray(parsed) ? parsed : null;
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
  ingest: (input: ServerIngestRequest) => Promise<ServerIngestResult>;
  ingestBatch: (input: ServerIngestRequest) => Promise<ServerBatchResult>;
} {
  const now = input.now ?? (() => new Date());

  const authenticate = async (
    request: ServerIngestRequest,
    path: string
  ): Promise<
    { client: ServerIngestClient } | { result: Extract<ServerIngestResult, { accepted: false }> }
  > => {
    if (!request.keyId || !request.signature || !request.timestamp || !request.nonce) {
      return { result: { status: 401, accepted: false, code: 'MISSING_AUTHENTICATION' } };
    }

    const client = await input.store.findServerClient(request.keyId);
    if (!client || client.status !== 'active') {
      return { result: { status: 401, accepted: false, code: 'INVALID_CLIENT' } };
    }
    const secret = await input.resolveSecret(client.secretReference);
    if (!secret) {
      return { result: { status: 401, accepted: false, code: 'INVALID_CLIENT' } };
    }
    const verification = await verifyServerIngestRequest({
      secret,
      signature: request.signature,
      nonceStore: input.nonceStore,
      now: now(),
      method: 'POST',
      path,
      timestamp: request.timestamp,
      nonce: request.nonce,
      rawBody: request.rawBody
    });
    return verification.ok
      ? { client }
      : { result: { status: 401, accepted: false, code: verification.code } };
  };

  const storeEnvelope = async (
    client: ServerIngestClient,
    untrustedEnvelope: unknown
  ): Promise<
    { accepted: true; eventId: string; duplicate: boolean } | { accepted: false; code: string }
  > => {
    if (!isRecord(untrustedEnvelope) || !isValidEnvelope(untrustedEnvelope)) {
      return { accepted: false, code: 'INVALID_ENVELOPE' };
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
      ...(sanitized.envelope.context.traceId
        ? { traceId: sanitized.envelope.context.traceId }
        : {}),
      payload: { envelope: sanitized.envelope },
      payloadHash: hash(JSON.stringify(sanitized.envelope)),
      redacted: sanitized.redacted
    });
    return { accepted: true, duplicate: stored.duplicate, eventId: sanitized.envelope.eventId };
  };

  return {
    ingest: async (request) => {
      if (Buffer.byteLength(request.rawBody, 'utf8') > maximumServerPayloadBytes) {
        return { status: 413, accepted: false, code: 'PAYLOAD_TOO_LARGE' };
      }
      const authenticated = await authenticate(request, '/api/v1/ingest/server');
      if ('result' in authenticated) return authenticated.result;
      const untrustedEnvelope = parseEnvelope(request.rawBody);
      const result = await storeEnvelope(authenticated.client, untrustedEnvelope);
      return result.accepted
        ? { status: 202, ...result }
        : { status: 400, accepted: false, code: result.code };
    },
    ingestBatch: async (request) => {
      if (Buffer.byteLength(request.rawBody, 'utf8') > maximumServerBatchBytes) {
        return { status: 413, accepted: false, code: 'PAYLOAD_TOO_LARGE' };
      }
      const authenticated = await authenticate(request, '/api/v1/ingest/server/batch');
      if ('result' in authenticated) return authenticated.result;
      const batch = parseBatch(request.rawBody);
      if (!batch || batch.length === 0 || batch.length > maximumServerBatchEvents) {
        return { status: 400, accepted: false, code: 'INVALID_BATCH' };
      }

      const results = await Promise.all(
        batch.map((untrustedEnvelope) => storeEnvelope(authenticated.client, untrustedEnvelope))
      );
      const accepted = results.filter(
        (result): result is Extract<typeof result, { accepted: true }> => result.accepted
      ).length;
      const rejected = results.length - accepted;
      return {
        status: rejected === 0 ? 202 : 207,
        accepted,
        rejected,
        results
      };
    }
  };
}
