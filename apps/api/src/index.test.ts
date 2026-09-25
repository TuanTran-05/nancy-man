import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createOpsApi } from './index.js';
import type { DatabaseExplorerService } from './modules/database/databaseExplorerService.js';

const unusedIngest = {
  browser: { ingest: async () => ({ status: 401, accepted: false as const, code: 'UNUSED' }) },
  server: {
    ingest: async () => ({ status: 401, accepted: false as const, code: 'UNUSED' }),
    ingestBatch: async () => ({ status: 401, accepted: false as const, code: 'UNUSED' })
  },
  browserCorsOrigins: []
};

describe('createOpsApi', () => {
  it('parses valid database JSON in production before the router dispatches it', async () => {
    const received: unknown[] = [];
    const app = createOpsApi({
      ingest: unusedIngest,
      database: {
        service: {
          queryRows: async (input) => {
            received.push(input.query);
            return {
              targetId: input.targetId,
              schemaChecksum: 'a'.repeat(64),
              policyVersion: 'v1',
              schema: input.query.schema,
              relation: input.query.relation,
              columns: [],
              rows: [],
              nextCursor: null,
              truncated: false,
              encodedBytes: 0,
              consistency: 'stable',
              piiMode: 'masked'
            };
          }
        } as unknown as DatabaseExplorerService,
        authorize: async () => ({
          userId: 'user-1',
          sessionId: 'session-1',
          role: 'ops_maintainer' as const
        }),
        hashClientIp: () => 'b'.repeat(64)
      }
    });

    const response = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'csrf')
      .send({
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      });

    expect(response.status).toBe(200);
    expect(received).toEqual([
      { schema: 'public', relation: 'students', pageSize: 25, filters: [], piiMode: 'masked' }
    ]);
  });

  it.each([
    ['malformed JSON', '{invalid', 400, 'INVALID_JSON'],
    ['JSON above 64 KiB', JSON.stringify({ value: 'x'.repeat(70_000) }), 413, 'REQUEST_TOO_LARGE']
  ])('rejects %s before database service dispatch', async (_name, body, status, code) => {
    let serviceCalled = false;
    const app = createOpsApi({
      ingest: unusedIngest,
      database: {
        service: {
          queryRows: async () => {
            serviceCalled = true;
            throw new Error('should not be called');
          }
        } as unknown as DatabaseExplorerService,
        authorize: async () => ({
          userId: 'user-1',
          sessionId: 'session-1',
          role: 'ops_maintainer' as const
        }),
        hashClientIp: () => 'b'.repeat(64)
      }
    });

    const response = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('content-type', 'application/json')
      .set('x-ops-csrf', 'csrf')
      .send(body);

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ code });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(serviceCalled).toBe(false);
  });

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

  it('captures the original route exception before returning a generic 500', async () => {
    const original = new Error('ingest store unavailable');
    const captured: Array<{ error: unknown; context: Record<string, unknown> }> = [];
    const app = createOpsApi({
      ingest: {
        browser: { ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }) },
        server: {
          ingest: async () => {
            throw original;
          },
          ingestBatch: async () => ({ status: 401, accepted: false, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      },
      telemetry: {
        captureException: (error, context) => captured.push({ error, context }),
        healthy: () => true
      }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/ingest/server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ accepted: false, code: 'INTERNAL_ERROR' });
      expect(captured).toEqual([
        {
          error: original,
          context: expect.objectContaining({
            code: 'API_UNHANDLED_EXCEPTION',
            route: '/api/v1/ingest/server',
            method: 'POST'
          })
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('degrades health when required telemetry is unavailable', async () => {
    const app = createOpsApi({
      ingest: {
        browser: { ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }) },
        server: {
          ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }),
          ingestBatch: async () => ({ status: 401, accepted: false, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      },
      telemetry: {
        captureException: () => undefined,
        healthy: () => false
      }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        status: 'degraded',
        reason: 'telemetry_unavailable'
      });
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
          getCatalog: async () => ({
            catalogVersion: '2026-08-31',
            entries: [],
            validators: [],
            consumers: [],
            precedences: []
          }),
          read: async () => ({
            catalogVersion: '2026-08-31',
            manifestVersion: '2026-08-31',
            generatedAt: '2026-08-31T00:00:00.000Z',
            items: []
          })
        },
        session: { authorize: async () => null },
        stepUp: {
          grant: async () => ({ id: 'grant', expiresAt: '2026-08-31T00:00:00.000Z' }),
          authorize: async () => undefined,
          revoke: async () => undefined
        },
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
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
