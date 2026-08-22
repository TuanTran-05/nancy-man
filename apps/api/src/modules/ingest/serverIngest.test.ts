import { describe, expect, it } from 'vitest';

import { InMemoryNonceStore, signServerIngestRequest } from './hmac.js';
import { createServerIngestService, type ServerIngestStore } from './serverIngest.js';

const serverEnvelope = {
  schemaVersion: 1,
  eventId: 'EVT_01K3ZABCDEF0123456789ABCDF',
  idempotencyKey: 'idem-abcdef0123456789',
  capturedAt: '2026-08-22T08:00:00.000Z',
  source: 'api',
  level: 'error',
  error: { name: 'DatabaseError', code: 'DB_UNAVAILABLE', safeMessage: 'Database unavailable' },
  context: {
    release: '0123456789abcdef0123456789abcdef01234567',
    service: 'edutrack-api',
    environment: 'production',
    requestId: 'REQ_01K3ZABCDEF0123456789ABCDE'
  }
} as const;

function createStore(): ServerIngestStore & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    inserted,
    findServerClient: async (keyId) =>
      keyId === 'api-1'
        ? {
            id: '8d771951-51be-451a-9c34-c77e32a7303d',
            clientKind: 'server',
            status: 'active',
            secretReference: 'secret/ops/ingest/api-1'
          }
        : null,
    insertRaw: async (record) => {
      inserted.push(record);
      return { duplicate: false };
    }
  };
}

describe('server ingestion service', () => {
  it('accepts a current HMAC-signed payload exactly once and sanitizes it before storage', async () => {
    const store = createStore();
    const nonceStore = new InMemoryNonceStore();
    const rawBody = JSON.stringify({
      ...serverEnvelope,
      error: { ...serverEnvelope.error, safeMessage: 'password=do-not-store' }
    });
    const signature = signServerIngestRequest({
      secret: 'server-secret',
      method: 'POST',
      path: '/api/v1/ingest/server',
      timestamp: '2026-08-22T08:00:00.000Z',
      nonce: 'nonce-0123456789abcdef',
      rawBody
    });
    const service = createServerIngestService({
      store,
      nonceStore,
      resolveSecret: async (reference) =>
        reference === 'secret/ops/ingest/api-1' ? 'server-secret' : null,
      sessionPepper: 'telemetry-pepper',
      now: () => new Date('2026-08-22T08:00:30.000Z')
    });
    const request = {
      keyId: 'api-1',
      signature,
      timestamp: '2026-08-22T08:00:00.000Z',
      nonce: 'nonce-0123456789abcdef',
      clientIp: '10.0.0.10',
      rawBody
    };

    await expect(service.ingest(request)).resolves.toEqual({
      status: 202,
      accepted: true,
      duplicate: false,
      eventId: serverEnvelope.eventId
    });
    await expect(service.ingest(request)).resolves.toMatchObject({
      status: 401,
      code: 'REPLAYED_NONCE'
    });
    expect(JSON.stringify(store.inserted[0])).not.toContain('password=do-not-store');
  });
});
