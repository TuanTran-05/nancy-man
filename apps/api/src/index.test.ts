import { describe, expect, it } from 'vitest';

import { createOpsApi } from './index.js';

describe('createOpsApi', () => {
  it('exposes a health check, disables framework disclosure and does not trust arbitrary proxies by default', async () => {
    const app = createOpsApi({
      ingest: {
        browser: { ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }) },
        server: {
          ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }),
          ingestBatch: async () => ({ status: 401, accepted: false, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-powered-by')).toBeNull();
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
      expect(app.get('trust proxy')).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('mounts the source-map release publisher separately from public telemetry ingestion', async () => {
    const app = createOpsApi({
      ingest: {
        browser: { ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }) },
        server: {
          ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }),
          ingestBatch: async () => ({ status: 401, accepted: false, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      },
      releases: {
        register: async () => ({
          status: 201 as const,
          accepted: true as const,
          releaseId: 'rel-1'
        })
      }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ accepted: true, releaseId: 'rel-1' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
