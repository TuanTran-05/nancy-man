import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { InMemoryNonceStore, signServerIngestRequest } from '../ingest/hmac.js';
import { createReleasePublisherService } from './releasePublisher.js';

const releaseSha = '0123456789abcdef0123456789abcdef01234567';

function createRequest(rawBody: string, overrides: Record<string, string | undefined> = {}) {
  const timestamp = '2026-08-22T08:00:00.000Z';
  const nonce = randomUUID().replaceAll('-', '');
  const signature = signServerIngestRequest({
    secret: 'publisher-secret',
    method: 'POST',
    path: '/api/v1/releases',
    timestamp,
    nonce,
    rawBody
  });
  return {
    keyId: 'release-publisher-1',
    timestamp,
    nonce,
    signature,
    rawBody,
    ...overrides
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    serviceName: 'edutrack-web',
    releaseSha,
    buildId: 'build-20260822',
    deployedAt: '2026-08-22T08:00:00.000Z',
    sourceMaps: [],
    ...overrides
  });
}

function createService(registerRelease = vi.fn().mockResolvedValue({ releaseId: 'rel-1' })) {
  return {
    service: createReleasePublisherService({
      publishers: {
        findPublisher: async (keyId) =>
          keyId === 'release-publisher-1'
            ? {
                serviceName: 'edutrack-web',
                secretReference: 'ops/release-publisher-1',
                status: 'active' as const
              }
            : null
      },
      resolveSecret: async (reference) =>
        reference === 'ops/release-publisher-1' ? 'publisher-secret' : null,
      nonceStore: new InMemoryNonceStore(),
      registerRelease,
      now: () => new Date('2026-08-22T08:00:00.000Z')
    }),
    registerRelease
  };
}

describe('release publisher service', () => {
  it('accepts a signed manifest only for the service bound to the publisher key', async () => {
    const { service, registerRelease } = createService();
    const request = createRequest(manifest());

    await expect(service.register(request)).resolves.toEqual({
      status: 201,
      accepted: true,
      releaseId: 'rel-1'
    });
    expect(registerRelease).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'edutrack-web', releaseSha })
    );
  });

  it('rejects a manifest that attempts to publish source maps for another service', async () => {
    const { service, registerRelease } = createService();
    const rawBody = manifest({ serviceName: 'edutrack-api' });

    await expect(service.register(createRequest(rawBody))).resolves.toEqual({
      status: 403,
      accepted: false,
      code: 'SERVICE_NOT_ALLOWED'
    });
    expect(registerRelease).not.toHaveBeenCalled();
  });

  it('rejects an invalid HMAC before parsing or registering the source maps', async () => {
    const { service, registerRelease } = createService();
    const request = createRequest(manifest(), { signature: 'v1=' + '0'.repeat(64) });

    await expect(service.register(request)).resolves.toEqual({
      status: 401,
      accepted: false,
      code: 'INVALID_SIGNATURE'
    });
    expect(registerRelease).not.toHaveBeenCalled();
  });
});
