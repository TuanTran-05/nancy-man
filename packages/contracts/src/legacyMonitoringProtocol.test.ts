import { describe, expect, it } from 'vitest';
import {
  BoundedNonceReplayCache,
  INTERNAL_MONITORING_PATHS,
  MAX_INTERNAL_MONITORING_BODY_BYTES,
  signLegacyMonitoringRequest,
  verifyLegacyMonitoringRequest
} from './legacyMonitoringProtocol.js';

const request = {
  method: 'GET',
  path: '/internal/v1/monitoring/overview?scope=latest',
  timestamp: '2026-08-31T12:00:00.000Z',
  nonce: 'nonce-0123456789abcdef',
  rawBody: '',
  userId: 'owner-id',
  role: 'ops_owner' as const
};

describe('legacy monitoring protocol', () => {
  it('signs and verifies the exact method, path, body, and canonical principal', async () => {
    const signature = signLegacyMonitoringRequest({ secret: 'adapter-secret', ...request });
    const nonces = new BoundedNonceReplayCache(10);
    await expect(
      verifyLegacyMonitoringRequest({
        secret: 'adapter-secret',
        signature,
        nonceStore: nonces,
        now: new Date('2026-08-31T12:00:29.999Z'),
        ...request
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      verifyLegacyMonitoringRequest({
        secret: 'adapter-secret',
        signature,
        nonceStore: nonces,
        now: new Date('2026-08-31T12:00:29.999Z'),
        ...request
      })
    ).resolves.toEqual({ ok: false, code: 'REPLAYED_NONCE' });

    const alteredPrincipal = signLegacyMonitoringRequest({
      secret: 'adapter-secret',
      ...request,
      userId: 'other-user'
    });
    await expect(
      verifyLegacyMonitoringRequest({
        secret: 'adapter-secret',
        signature: alteredPrincipal,
        nonceStore: new BoundedNonceReplayCache(10),
        now: new Date('2026-08-31T12:00:29.999Z'),
        ...request
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_SIGNATURE' });
  });

  it('enforces a 30-second timestamp window, exact path allowlist, and body limit', async () => {
    const signature = signLegacyMonitoringRequest({ secret: 'adapter-secret', ...request });
    await expect(
      verifyLegacyMonitoringRequest({
        secret: 'adapter-secret',
        signature,
        nonceStore: new BoundedNonceReplayCache(10),
        now: new Date('2026-08-31T12:00:30.001Z'),
        ...request
      })
    ).resolves.toEqual({ ok: false, code: 'EXPIRED_TIMESTAMP' });
    await expect(
      verifyLegacyMonitoringRequest({
        secret: 'adapter-secret',
        signature,
        nonceStore: new BoundedNonceReplayCache(10),
        now: new Date('2026-08-31T12:00:01.000Z'),
        ...request,
        path: '/internal/v1/monitoring/not-allowed'
      })
    ).resolves.toEqual({ ok: false, code: 'PATH_NOT_ALLOWED' });
    await expect(
      verifyLegacyMonitoringRequest({
        secret: 'adapter-secret',
        signature,
        nonceStore: new BoundedNonceReplayCache(10),
        now: new Date('2026-08-31T12:00:01.000Z'),
        ...request,
        rawBody: 'x'.repeat(MAX_INTERNAL_MONITORING_BODY_BYTES + 1)
      })
    ).resolves.toEqual({ ok: false, code: 'BODY_TOO_LARGE' });
    expect(INTERNAL_MONITORING_PATHS.has('/internal/v1/monitoring/overview')).toBe(true);
  });

  it('fails closed when the bounded replay cache is full until entries expire', async () => {
    const cache = new BoundedNonceReplayCache(1);
    const now = new Date('2026-08-31T12:00:00.000Z');
    await expect(cache.consume('nonce-0123456789abcdef', new Date(now.getTime() + 30_000), now)).resolves.toBe(true);
    await expect(cache.consume('nonce-fedcba9876543210', new Date(now.getTime() + 30_000), now)).resolves.toBe(false);
    await expect(cache.consume('nonce-fedcba9876543210', new Date(now.getTime() + 30_000), new Date(now.getTime() + 30_001))).resolves.toBe(true);
  });
});
