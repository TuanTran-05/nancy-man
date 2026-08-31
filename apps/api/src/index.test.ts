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

  it('does not authorize an Ops monitoring cookie in the separate Ops API session namespace', async () => {
    const apiSessionCookie = '__Host-ops-session=api-session-token-012345678901234567890123';
    const app = createOpsApi({
      ingest: {
        browser: { ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }) },
        server: {
          ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }),
          ingestBatch: async () => ({ status: 401, accepted: false, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      },
      auth: {
        service: {
          beginLogin: async () => ({ status: 'denied' as const }),
          completeTotpLogin: async () => ({ status: 'denied' as const })
        },
        hashClientIp: (ip) => ip,
        session: {
          authorize: async ({ cookieHeader }) =>
            cookieHeader === apiSessionCookie
              ? {
                  sessionId: '3a86a2e4-4f07-4ce5-a5fc-0cc0e03ea526',
                  userId: '07de3aa9-572c-4c24-b761-4bb2727777e8',
                  role: 'ops_viewer' as const
                }
              : null,
          revoke: async () => undefined
        }
      }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');

    try {
      const monitoringCookie = '__Host-ops_session=monitoring-session-token';
      const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/session`, {
        headers: { Cookie: monitoringCookie }
      });
      expect(denied.status).toBe(401);
      await expect(denied.json()).resolves.toEqual({ code: 'AUTH_DENIED' });

      const authorized = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/session`, {
        headers: { Cookie: apiSessionCookie }
      });
      expect(authorized.status).toBe(200);
      await expect(authorized.json()).resolves.toEqual({
        userId: '07de3aa9-572c-4c24-b761-4bb2727777e8',
        role: 'ops_viewer'
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('mounts Variables under the canonical API namespace only when its service is configured', async () => {
    const app = createOpsApi({
      ingest: {
        browser: { ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }) },
        server: {
          ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }),
          ingestBatch: async () => ({ status: 401, accepted: false, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      },
      variables: {
        service: {
          getCatalog: async () => ({ catalogVersion: '2026-08-31', entries: [], validators: [], consumers: [], precedences: [] }),
          read: async () => ({ catalogVersion: '2026-08-31', manifestVersion: '2026-08-31', generatedAt: '2026-08-31T00:00:00.000Z', items: [] })
        },
        session: { authorize: async () => null },
        stepUp: { grant: async () => ({ id: 'grant', expiresAt: '2026-08-31T00:00:00.000Z' }), authorize: async () => undefined, revoke: async () => undefined },
        hashClientIp: () => 'a'.repeat(64),
        rateLimiter: { allow: async () => true }
      }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/variables/catalog`);
      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
