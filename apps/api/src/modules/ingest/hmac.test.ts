import { describe, expect, it } from 'vitest';

import { InMemoryNonceStore, signServerIngestRequest, verifyServerIngestRequest } from './hmac.js';

const request = {
  method: 'POST',
  path: '/api/v1/ingest/server',
  timestamp: '2026-08-22T08:00:00.000Z',
  nonce: 'nonce-0123456789abcdef',
  rawBody: '{"schemaVersion":1}'
};

describe('server ingest HMAC', () => {
  it('accepts exactly one canonical, current request', async () => {
    const signature = signServerIngestRequest({ secret: 'server-secret', ...request });
    const nonces = new InMemoryNonceStore();

    await expect(
      verifyServerIngestRequest({
        secret: 'server-secret',
        signature,
        nonceStore: nonces,
        now: new Date('2026-08-22T08:00:45.000Z'),
        ...request
      })
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyServerIngestRequest({
        secret: 'server-secret',
        signature,
        nonceStore: nonces,
        now: new Date('2026-08-22T08:00:45.000Z'),
        ...request
      })
    ).resolves.toEqual({ ok: false, code: 'REPLAYED_NONCE' });
  });

  it('rejects altered payloads and timestamps outside the 60-second replay window', async () => {
    const signature = signServerIngestRequest({ secret: 'server-secret', ...request });

    await expect(
      verifyServerIngestRequest({
        secret: 'server-secret',
        signature,
        nonceStore: new InMemoryNonceStore(),
        now: new Date('2026-08-22T08:00:45.000Z'),
        ...request,
        rawBody: '{"schemaVersion":2}'
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_SIGNATURE' });

    await expect(
      verifyServerIngestRequest({
        secret: 'server-secret',
        signature,
        nonceStore: new InMemoryNonceStore(),
        now: new Date('2026-08-22T08:01:01.000Z'),
        ...request
      })
    ).resolves.toEqual({ ok: false, code: 'EXPIRED_TIMESTAMP' });
  });
});
