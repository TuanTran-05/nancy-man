import express from 'express';
import { describe, expect, it } from 'vitest';

import { createReleaseRouter } from './releaseRoutes.js';

describe('release routes', () => {
  it('forwards only the signed transport headers and exact raw manifest body to the publisher service', async () => {
    const seen: unknown[] = [];
    const app = express();
    app.use(
      '/api/v1/releases',
      createReleaseRouter({
        register: async (request) => {
          seen.push(request);
          return { status: 201 as const, accepted: true as const, releaseId: 'rel-1' };
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server');

    try {
      const body = '{"sourceMaps":[]}';
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/releases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ops-Key-Id': 'release-publisher-1',
          'X-Ops-Signature': 'v1=' + '0'.repeat(64),
          'X-Ops-Timestamp': '2026-08-22T08:00:00.000Z',
          'X-Ops-Nonce': 'abcdefghijklmnop'
        },
        body
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ accepted: true, releaseId: 'rel-1' });
      expect(seen).toEqual([
        {
          keyId: 'release-publisher-1',
          signature: 'v1=' + '0'.repeat(64),
          timestamp: '2026-08-22T08:00:00.000Z',
          nonce: 'abcdefghijklmnop',
          rawBody: body
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
