import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DatabaseExplorerService } from './databaseExplorerService.js';
import { createDatabaseRouter, type DatabasePrincipal } from './databaseRoutes.js';
import type { OpsRole } from '../../../../../packages/security/src/sessions.js';

describe('createDatabaseRouter', () => {
  function createApp(
    options: {
      role?: OpsRole;
      unauthenticated?: boolean;
      missingCsrf?: boolean;
      serviceMock?: Partial<DatabaseExplorerService>;
    } = {}
  ) {
    const app = express();
    app.use(express.json());

    const principal: DatabasePrincipal = {
      userId: 'user_1',
      sessionId: 'session_1',
      role: options.role ?? 'ops_maintainer'
    };

    const mockService = {
      getTargets: async () => ({
        targets: [
          {
            id: 'edutrack_production' as const,
            label: 'EduTrack Production',
            status: 'available' as const,
            readOnly: true
          },
          {
            id: 'ops' as const,
            label: 'Ops Database',
            status: 'available' as const,
            readOnly: true
          }
        ]
      }),
      getSchema: async () => ({
        targetId: 'edutrack_production' as const,
        targetLabel: 'EduTrack Production',
        checksum: 'a'.repeat(64),
        policyVersion: '2026-09-25',
        schemas: [],
        edges: []
      }),
      queryRows: async (input: any) => {
        if (input.actor.role === 'ops_viewer') {
          const err = new Error('DATABASE_DATA_PERMISSION_DENIED');
          (err as any).status = 403;
          (err as any).code = 'DATABASE_DATA_PERMISSION_DENIED';
          throw err;
        }
        if (input.query.piiMode === 'revealed' && !input.grantId) {
          const err = new Error('DATABASE_PII_REVEAL_REQUIRED');
          (err as any).status = 403;
          (err as any).code = 'DATABASE_PII_REVEAL_REQUIRED';
          throw err;
        }
        return {
          targetId: input.targetId,
          schemaChecksum: 'a'.repeat(64),
          policyVersion: '2026-09-25',
          schema: input.query.schema,
          relation: input.query.relation,
          columns: [],
          rows: [],
          nextCursor: null,
          truncated: false,
          encodedBytes: 100,
          consistency: 'stable' as const,
          piiMode: input.query.piiMode
        };
      },
      queryRelatedRows: async (input: any) => {
        if (input.actor.role === 'ops_viewer') {
          const err = new Error('DATABASE_DATA_PERMISSION_DENIED');
          (err as any).status = 403;
          (err as any).code = 'DATABASE_DATA_PERMISSION_DENIED';
          throw err;
        }
        return {
          targetId: input.targetId,
          schemaChecksum: 'a'.repeat(64),
          policyVersion: '2026-09-25',
          schema: input.query.schema,
          relation: input.query.relation,
          columns: [],
          rows: [],
          nextCursor: null,
          truncated: false,
          encodedBytes: 100,
          consistency: 'stable' as const,
          piiMode: input.query.piiMode
        };
      },
      revealPii: async (input: any) => {
        if (input.actor.role === 'ops_viewer') {
          const err = new Error('PERMISSION_DENIED');
          (err as any).status = 403;
          (err as any).code = 'PERMISSION_DENIED';
          throw err;
        }
        return {
          grantId: 'grant_123',
          targetId: input.targetId,
          expiresAt: '2026-09-25T12:00:00Z'
        };
      },
      revokePiiReveal: async () => ({ ok: true as const }),
      ...options.serviceMock
    } as unknown as DatabaseExplorerService;

    const router = createDatabaseRouter({
      service: mockService,
      authorize: async ({ csrfToken, mutation }) => {
        if (options.unauthenticated) return null;
        if (mutation && (!csrfToken || options.missingCsrf)) return null;
        return principal;
      },
      hashClientIp: () => 'c'.repeat(64)
    });

    app.use('/api/v1/database', router);
    return app;
  }

  it('GET /targets returns targets list and sets Cache-Control: no-store', async () => {
    const app = createApp({ role: 'ops_viewer' });
    const res = await request(app).get('/api/v1/database/targets');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.targets).toHaveLength(2);
  });

  it('GET /:targetId/schema allows ops_viewer and returns schema snapshot', async () => {
    const app = createApp({ role: 'ops_viewer' });
    const res = await request(app).get('/api/v1/database/edutrack_production/schema');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.targetId).toBe('edutrack_production');
  });

  it('GET /:targetId/schema rejects unknown targetId with 400', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/database/unknown_target/schema');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DATABASE_TARGET_INVALID');
  });

  it('POST /:targetId/rows/query rejects ops_viewer with 403', async () => {
    const app = createApp({ role: 'ops_viewer' });
    const res = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'valid_token')
      .send({
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DATABASE_DATA_PERMISSION_DENIED');
  });

  it('POST /:targetId/rows/query rejects mutation without CSRF with 401', async () => {
    const app = createApp({ missingCsrf: true });
    const res = await request(app).post('/api/v1/database/edutrack_production/rows/query').send({
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [],
      piiMode: 'masked'
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_DENIED');
  });

  it('POST /:targetId/rows/query allows maintainer in masked mode and returns rows', async () => {
    const app = createApp({ role: 'ops_maintainer' });
    const res = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'valid_token')
      .send({
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.relation).toBe('students');
  });

  it('POST /:targetId/rows/query in revealed mode requires step-up grant', async () => {
    const app = createApp({ role: 'ops_maintainer' });

    // Without grant
    const resWithoutGrant = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'valid_token')
      .send({
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'revealed'
      });

    expect(resWithoutGrant.status).toBe(403);
    expect(resWithoutGrant.body.code).toBe('DATABASE_PII_REVEAL_REQUIRED');

    // With grant
    const resWithGrant = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'valid_token')
      .set('x-ops-step-up-grant', 'grant_123')
      .send({
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'revealed'
      });

    expect(resWithGrant.status).toBe(200);
  });

  it('POST /:targetId/pii-reveal grants elevation for maintainer and rejects viewer', async () => {
    const viewerApp = createApp({ role: 'ops_viewer' });
    const viewerRes = await request(viewerApp)
      .post('/api/v1/database/edutrack_production/pii-reveal')
      .set('x-ops-csrf', 'valid_token')
      .send({
        password: 'password123456',
        token: '123456',
        reason: 'Investigating customer ticket #42'
      });

    expect(viewerRes.status).toBe(403);
    expect(viewerRes.body.code).toBe('PERMISSION_DENIED');

    const maintainerApp = createApp({ role: 'ops_maintainer' });
    const maintainerRes = await request(maintainerApp)
      .post('/api/v1/database/edutrack_production/pii-reveal')
      .set('x-ops-csrf', 'valid_token')
      .send({
        password: 'password123456',
        token: '123456',
        reason: 'Investigating customer ticket #42'
      });

    expect(maintainerRes.status).toBe(200);
    expect(maintainerRes.body.grantId).toBe('grant_123');
  });

  it('DELETE /:targetId/pii-reveal revokes elevation', async () => {
    const app = createApp({ role: 'ops_maintainer' });
    const res = await request(app)
      .delete('/api/v1/database/edutrack_production/pii-reveal')
      .set('x-ops-csrf', 'valid_token')
      .set('x-ops-step-up-grant', 'grant_123');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
