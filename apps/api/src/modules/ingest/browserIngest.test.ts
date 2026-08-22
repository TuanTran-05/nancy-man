import { issueTelemetryContextToken } from '../../../../../packages/security/src/telemetry/contextToken.js';
import { describe, expect, it } from 'vitest';

import { createBrowserIngestService, type IngestStore } from './browserIngest.js';

const validBrowserEnvelope = {
  schemaVersion: 1,
  eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
  idempotencyKey: 'idem-0123456789abcdef',
  capturedAt: '2026-08-22T08:00:00.000Z',
  source: 'browser',
  level: 'error',
  error: {
    name: 'Error',
    code: 'BROWSER_EXCEPTION',
    safeMessage: 'Failed to load students'
  },
  context: {
    release: '0123456789abcdef0123456789abcdef01234567',
    service: 'edutrack-web',
    environment: 'production',
    route: '/students'
  }
} as const;

function createStore(): IngestStore & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    inserted,
    findBrowserClient: async (projectKey) =>
      projectKey === 'public-browser-key'
        ? {
            id: '8d771951-51be-451a-9c34-c77e32a7303d',
            clientKind: 'browser',
            status: 'active',
            allowedOrigins: ['https://thienuy.edu.vn']
          }
        : null,
    insertRaw: async (record) => {
      inserted.push(record);
      return { duplicate: false };
    }
  };
}

describe('browser ingestion service', () => {
  it('only accepts an allowed origin and stores a freshly sanitized, signed identity', async () => {
    const store = createStore();
    const token = issueTelemetryContextToken(
      {
        audience: 'edutrack-ops-ingest',
        channel: 'browser',
        userRef: 'USR_123',
        role: 'teacher',
        displayLabel: 'Teacher',
        sessionHash: 'a'.repeat(64),
        nonce: 'context-nonce'
      },
      { keyId: 'browser-1', key: 'context-signing-key', now: new Date('2026-08-22T08:00:00.000Z') }
    );
    const service = createBrowserIngestService({
      store,
      sessionPepper: 'telemetry-pepper',
      browserContextKeyring: { 'browser-1': 'context-signing-key' },
      rateLimiter: { allow: async () => true },
      now: () => new Date('2026-08-22T08:00:30.000Z')
    });

    const result = await service.ingest({
      origin: 'https://thienuy.edu.vn',
      projectKey: 'public-browser-key',
      clientIp: '203.0.113.10',
      rawBody: JSON.stringify({
        ...validBrowserEnvelope,
        error: { ...validBrowserEnvelope.error, safeMessage: 'Bearer should-redact' },
        context: { ...validBrowserEnvelope.context, telemetryContextToken: token }
      })
    });

    expect(result).toEqual({ status: 202, accepted: true, duplicate: false, eventId: validBrowserEnvelope.eventId });
    expect(store.inserted).toHaveLength(1);
    expect(JSON.stringify(store.inserted[0])).not.toContain(token);
    expect(store.inserted[0]).toMatchObject({
      payload: {
        identity: { userRef: 'USR_123', role: 'teacher', sessionHash: 'a'.repeat(64) }
      },
      redacted: true
    });
  });

  it('rejects disallowed origins and payloads larger than 64 KiB before writing', async () => {
    const store = createStore();
    const service = createBrowserIngestService({
      store,
      sessionPepper: 'telemetry-pepper',
      browserContextKeyring: {},
      rateLimiter: { allow: async () => true }
    });

    await expect(
      service.ingest({
        origin: 'https://attacker.example',
        projectKey: 'public-browser-key',
        clientIp: '203.0.113.10',
        rawBody: JSON.stringify(validBrowserEnvelope)
      })
    ).resolves.toMatchObject({ status: 403, code: 'ORIGIN_NOT_ALLOWED' });

    await expect(
      service.ingest({
        origin: 'https://thienuy.edu.vn',
        projectKey: 'public-browser-key',
        clientIp: '203.0.113.10',
        rawBody: 'x'.repeat(64 * 1024 + 1)
      })
    ).resolves.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(store.inserted).toHaveLength(0);
  });
});
