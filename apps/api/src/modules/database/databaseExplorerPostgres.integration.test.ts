import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StepUpService } from '../auth/stepUpService.js';
import { DatabaseExplorerService } from './databaseExplorerService.js';
import { createDatabaseRouter, type DatabasePrincipal } from './databaseRoutes.js';
import {
  startPostgresWorkerFixture,
  type PostgresWorkerFixture
} from '../../../../sql-worker/src/security/databaseExplorerPostgres.fixture.js';

describe('Database Explorer API with isolated PostgreSQL 16 worker', () => {
  let fixture: PostgresWorkerFixture;
  let app: express.Express;

  beforeAll(async () => {
    fixture = await startPostgresWorkerFixture();
    const principal: DatabasePrincipal = {
      userId: 'postgres-integration-api-user',
      sessionId: 'postgres-integration-api-session',
      role: 'ops_maintainer'
    };
    const service = new DatabaseExplorerService({
      worker: fixture.client,
      audit: {
        append: async () => ({ id: 'postgres-integration-audit-entry', entryHash: 'a'.repeat(64) })
      },
      stepUp: {} as StepUpService,
      findUserTotpFactorId: async () => null
    });
    app = express();
    app.use(express.json());
    app.use(
      '/api/v1/database',
      createDatabaseRouter({
        service,
        authorize: async () => principal,
        hashClientIp: (ip) => ip
      })
    );
  }, 60_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  it('returns a stable API failure for an actual >2 MiB row without any row bytes', async () => {
    const response = await request(app).post('/api/v1/database/ops/rows/query').send({
      schema: 'public',
      relation: 'wide_rows',
      pageSize: 25,
      filters: [],
      piiMode: 'masked'
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'DATABASE_RESULT_TOO_LARGE' });
    expect(response.text).not.toContain('WIDE-ROW-SENTINEL-');
    expect(response.text).not.toContain('WWWWWWWWWW');
    expect(response.text).not.toContain('wide_00');

    const stored = await fixture.adminPools.ops.query<{ bytes: number; marker: string }>(
      `SELECT octet_length(wide_00) AS bytes, left(wide_00, 20) AS marker
       FROM public.wide_rows WHERE id = 1`
    );
    expect(stored.rows).toEqual([{ bytes: 65_536, marker: 'WIDE-ROW-SENTINEL-00' }]);
  });
});
