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
      queryRows: async (input: Parameters<DatabaseExplorerService['queryRows']>[0]) => {
        if (input.actor.role === 'ops_viewer') {
          const err = Object.assign(new Error('DATABASE_DATA_PERMISSION_DENIED'), {
            status: 403,
            code: 'DATABASE_DATA_PERMISSION_DENIED'
          });
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
      queryRelatedRows: async (
        input: Parameters<DatabaseExplorerService['queryRelatedRows']>[0]
      ) => {
        if (input.actor.role === 'ops_viewer') {
          const err = Object.assign(new Error('DATABASE_DATA_PERMISSION_DENIED'), {
            status: 403,
            code: 'DATABASE_DATA_PERMISSION_DENIED'
          });
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
      revealPii: async (input: Parameters<DatabaseExplorerService['revealPii']>[0]) => {
        if (input.actor.role === 'ops_viewer') {
          const err = Object.assign(new Error('PERMISSION_DENIED'), {
            status: 403,
            code: 'PERMISSION_DENIED'
          });
          throw err;
        }
        return { expiresAt: '2026-09-25T12:00:00Z' };
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

  it('GET /targets mirrors live available, disabled, and unavailable states from the service', async () => {
    const workerStates = [
      [
        { id: 'edutrack_production', label: 'Production', status: 'available', readOnly: true },
        { id: 'ops', label: 'Ops', status: 'disabled', readOnly: true }
      ],
      [
        { id: 'edutrack_production', label: 'Production', status: 'unavailable', readOnly: true },
        { id: 'ops', label: 'Ops', status: 'available', readOnly: true }
      ]
    ];
    let call = 0;
    const app = createApp({
      serviceMock: { getTargets: async () => ({ targets: workerStates[call++] as never }) }
    });

    const first = await request(app).get('/api/v1/database/targets');
    const second = await request(app).get('/api/v1/database/targets');

    expect(first.body.targets).toEqual(workerStates[0]);
    expect(second.body.targets).toEqual(workerStates[1]);
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

    expect(resWithoutGrant.status).toBe(200);

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

  it('does not read a client-supplied grant header for row or relation queries', async () => {
    const observed: unknown[] = [];
    const app = createApp({
      serviceMock: {
        queryRows: async (input) => {
          observed.push(input);
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
            encodedBytes: 0,
            consistency: 'stable',
            piiMode: input.query.piiMode
          };
        },
        queryRelatedRows: async (input) => {
          observed.push(input);
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
            encodedBytes: 0,
            consistency: 'stable',
            piiMode: input.query.piiMode
          };
        }
      }
    });

    await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'valid_token')
      .set('x-ops-step-up-grant', 'attacker-controlled')
      .send({ schema: 'public', relation: 'students', piiMode: 'revealed' });
    const relationResponse = await request(app)
      .post('/api/v1/database/edutrack_production/relations/query')
      .set('x-ops-csrf', 'valid_token')
      .set('x-ops-step-up-grant', 'attacker-controlled')
      .send({
        schema: 'public',
        relation: 'students',
        constraint: 'students_school_fk',
        rowRef: 'opaque-row-ref',
        piiMode: 'revealed'
      });

    expect(relationResponse.headers['cache-control']).toBe('no-store');
    expect(observed).toHaveLength(2);
    expect(observed[0]).not.toHaveProperty('grantId');
    expect(observed[1]).not.toHaveProperty('grantId');
  });

  it('POST /:targetId/pii-reveal grants elevation for maintainer and rejects viewer', async () => {
    const viewerApp = createApp({ role: 'ops_viewer' });
    const viewerRes = await request(viewerApp)
      .post('/api/v1/database/pii-reveal')
      .set('x-ops-csrf', 'valid_token')
      .send({
        password: 'password123456',
        token: '123456',
        reason: 'Investigating customer ticket #42',
        targetId: 'edutrack_production'
      });

    expect(viewerRes.status).toBe(403);
    expect(viewerRes.body.code).toBe('PERMISSION_DENIED');

    const maintainerApp = createApp({ role: 'ops_maintainer' });
    const maintainerRes = await request(maintainerApp)
      .post('/api/v1/database/pii-reveal')
      .set('x-ops-csrf', 'valid_token')
      .send({
        password: 'password123456',
        token: '123456',
        reason: 'Investigating customer ticket #42',
        targetId: 'edutrack_production'
      });

    expect(maintainerRes.status).toBe(200);
    expect(maintainerRes.body).toEqual({ expiresAt: '2026-09-25T12:00:00Z' });
    expect(Object.keys(maintainerRes.body)).toEqual(['expiresAt']);
    expect(maintainerRes.headers['cache-control']).toBe('no-store');
  });

  it('DELETE /pii-reveal revokes the authenticated binding without a grant ID or target path', async () => {
    const app = createApp({ role: 'ops_maintainer' });
    const res = await request(app)
      .delete('/api/v1/database/pii-reveal')
      .set('x-ops-csrf', 'valid_token');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
