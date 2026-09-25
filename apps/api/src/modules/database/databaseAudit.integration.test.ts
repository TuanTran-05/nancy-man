import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PostgresOpsAuditLedger } from '../audit/postgresAuditLedger.js';
import { DatabaseExplorerService } from './databaseExplorerService.js';
import { createDatabaseRouter, type DatabasePrincipal } from './databaseRoutes.js';
import { createAuditEntryHash } from '../../../../../packages/security/src/audit/hashChain.js';
import type { DatabaseRowsResponse } from '../../../../../packages/contracts/src/databaseExplorer.js';
import type { StepUpService } from '../auth/stepUpService.js';

type StoredAuditEntry = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  requestId: string | null;
  ipHash: string | null;
  metadata: Record<string, unknown>;
  previousHash: string | null;
  entryHash: string;
};

describe('Database Explorer Audit Integration', () => {
  function createTestHarness(
    options: {
      failAudit?: boolean;
      workerRows?: unknown[];
    } = {}
  ) {
    const storedEntries: StoredAuditEntry[] = [];

    const mockDb = {
      transaction: async <T>(
        operation: (db: {
          query: <R>(sql: string, params?: readonly unknown[]) => Promise<{ rows: R[] }>;
        }) => Promise<T>
      ): Promise<T> => {
        if (options.failAudit) {
          throw new Error('Database transaction failed / audit storage unavailable');
        }
        return operation({
          query: async <R>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[] }> => {
            if (sql.includes('SELECT pg_advisory_xact_lock')) {
              return { rows: [] };
            }
            if (sql.includes('SELECT entry_hash')) {
              const last = storedEntries[storedEntries.length - 1];
              return {
                rows: (last ? [{ entryHash: last.entryHash }] : []) as unknown as R[]
              };
            }
            if (sql.includes('INSERT INTO ops_audit_entries')) {
              const p = params!;
              const entry: StoredAuditEntry = {
                id: p[0] as string,
                occurredAt: p[1] as string,
                actorUserId: p[2] as string | null,
                action: p[3] as string,
                subjectType: p[4] as string,
                subjectId: p[5] as string | null,
                requestId: p[6] as string | null,
                ipHash: p[7] as string | null,
                metadata: JSON.parse(p[8] as string),
                previousHash: p[9] as string | null,
                entryHash: p[10] as string
              };
              storedEntries.push(entry);
              return { rows: [] };
            }
            return { rows: [] };
          }
        });
      }
    };

    const auditLedger = new PostgresOpsAuditLedger({
      database: mockDb,
      now: () => new Date('2026-09-25T12:00:00.000Z')
    });

    const sampleRow = {
      rowRef: 'ref_123',
      cells: {
        id: { state: 'value', value: 42 },
        email: { state: 'masked', display: 'u***@example.com' },
        secret: { state: 'blocked' }
      }
    };

    const mockWorkerRows: DatabaseRowsResponse = {
      targetId: 'edutrack_production',
      schemaChecksum: 'c'.repeat(64),
      policyVersion: '2026-09-25',
      schema: 'public',
      relation: 'users',
      columns: [
        {
          name: 'id',
          dataType: 'integer',
          nullable: false,
          hasDefault: true,
          identity: null,
          generated: false,
          classification: 'public',
          selectable: true,
          filterOperators: ['eq', 'gt', 'lt']
        },
        {
          name: 'email',
          dataType: 'text',
          nullable: false,
          hasDefault: false,
          identity: null,
          generated: false,
          classification: 'pii',
          selectable: true,
          filterOperators: ['eq', 'contains']
        }
      ],
      rows: (options.workerRows as unknown as DatabaseRowsResponse['rows']) ?? [sampleRow],
      nextCursor: null,
      truncated: false,
      encodedBytes: 256,
      consistency: 'stable',
      piiMode: 'masked'
    };

    const worker = {
      command: async (cmd: { kind: string; payload: Record<string, unknown> }) => {
        if (cmd.kind === 'database.schema') {
          return {
            protocolVersion: 1,
            commandId: 'cmd_1',
            ok: true,
            result: {
              targetId: cmd.payload['targetId'] as string,
              targetLabel: 'EduTrack Production',
              checksum: 'c'.repeat(64),
              policyVersion: '2026-09-25',
              schemas: [],
              edges: []
            }
          };
        }
        if (cmd.kind === 'database.rows' || cmd.kind === 'database.relatedRows') {
          return {
            protocolVersion: 1,
            commandId: 'cmd_2',
            ok: true,
            result: {
              ...mockWorkerRows,
              targetId: cmd.payload['targetId'] as string,
              schema: cmd.payload['schema'] as string,
              relation: cmd.payload['relation'] as string,
              piiMode: (cmd.payload['piiMode'] as 'masked' | 'revealed') ?? 'masked'
            }
          };
        }
        return {
          protocolVersion: 1,
          commandId: 'cmd_x',
          ok: false,
          error: { code: 'UNKNOWN_COMMAND' }
        };
      }
    };

    const mockStepUp = {
      authorizeDatabasePii: async () => ({
        id: 'grant_pii_123',
        capability: 'database_pii',
        subjectDigest: '0'.repeat(64),
        expiresAt: '2026-09-25T12:10:00.000Z',
        reusable: true
      }),
      activateDatabasePiiGrant: async () => true,
      revokeDatabasePii: async () => 1,
      revokeSessionDatabasePii: async () => undefined,
      grant: async () => ({
        id: 'grant_pii_123',
        capability: 'database_pii',
        subjectDigest: '0'.repeat(64),
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      }),
      revoke: async () => undefined
    } as unknown as StepUpService;

    const service = new DatabaseExplorerService({
      worker,
      audit: auditLedger,
      stepUp: mockStepUp,
      findUserTotpFactorId: async () => 'factor_totp_abc'
    });

    const principal: DatabasePrincipal = {
      userId: 'user_maintainer_1',
      sessionId: 'session_abc_123',
      role: 'ops_maintainer'
    };

    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1/database',
      createDatabaseRouter({
        service,
        authorize: async () => principal,
        hashClientIp: (ip) => createHash('sha256').update(ip).digest('hex')
      })
    );

    return { app, storedEntries, principal };
  }

  it('audits masked rows query with fingerprints only and maintains a valid hash chain', async () => {
    const { app, storedEntries } = createTestHarness();

    const sensitiveSearchFilter = 'confidential_student_name';
    const res = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'test-csrf')
      .send({
        schema: 'public',
        relation: 'users',
        pageSize: 25,
        filters: [{ column: 'email', operator: 'contains', value: sensitiveSearchFilter }],
        sort: { column: 'id', direction: 'asc' },
        piiMode: 'masked'
      });

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].cells.id.value).toBe(42);

    expect(storedEntries).toHaveLength(1);
    const entry = storedEntries[0]!;
    expect(entry.action).toBe('database.rows_viewed');
    expect(entry.subjectType).toBe('database');
    expect(entry.subjectId).toBe('edutrack_production');

    // Audit metadata must NOT contain sensitive search value, raw values, or SQL
    const serializedMetadata = JSON.stringify(entry.metadata);
    expect(serializedMetadata).not.toContain(sensitiveSearchFilter);
    expect(serializedMetadata).not.toContain('confidential');
    expect(serializedMetadata).not.toContain('u***@example.com');
    expect(serializedMetadata).not.toContain('ref_123');
    expect(serializedMetadata).not.toContain('cursor');
    expect(serializedMetadata).not.toContain('rowRef');
    expect(serializedMetadata).not.toContain('SELECT');

    // Audit metadata MUST contain fingerprints and policy details
    expect(entry.metadata).toMatchObject({
      targetId: 'edutrack_production',
      schemaChecksum: 'c'.repeat(64),
      schema: 'public',
      relation: 'users',
      pageSize: 25,
      returnedCount: 1,
      policyVersion: '2026-09-25',
      piiMode: 'masked'
    });
    expect(entry.metadata['filtersFingerprint']).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.metadata['sortFingerprint']).toMatch(/^[a-f0-9]{64}$/);

    // Verify hash chain
    expect(entry.previousHash).toBeNull();
    const expectedHash = createAuditEntryHash({
      previousHash: null,
      payload: {
        id: entry.id,
        occurredAt: entry.occurredAt,
        actorUserId: entry.actorUserId,
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        requestId: entry.requestId,
        ipHash: entry.ipHash,
        metadata: entry.metadata
      }
    });
    expect(entry.entryHash).toBe(expectedHash);
  });

  it('audits revealed rows with ordered database.rows_viewed and database.pii_rows_viewed, linking hash chain', async () => {
    const { app, storedEntries } = createTestHarness();

    const res = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'test-csrf')
      .send({
        schema: 'public',
        relation: 'users',
        pageSize: 50,
        filters: [],
        piiMode: 'revealed'
      });

    expect(res.status).toBe(200);
    expect(res.body.piiMode).toBe('revealed');

    // Must emit exactly 2 ordered audit entries
    expect(storedEntries).toHaveLength(2);
    const [rowsViewed, piiViewed] = storedEntries;

    expect(rowsViewed!.action).toBe('database.rows_viewed');
    expect(rowsViewed!.metadata['piiMode']).toBe('revealed');

    expect(piiViewed!.action).toBe('database.pii_rows_viewed');
    expect(piiViewed!.metadata).toMatchObject({
      targetId: 'edutrack_production',
      schemaChecksum: 'c'.repeat(64),
      schema: 'public',
      relation: 'users'
    });
    expect(JSON.stringify(piiViewed!.metadata)).not.toContain('rowRef');
    expect(JSON.stringify(piiViewed!.metadata)).not.toContain('cursor');
    expect(JSON.stringify(piiViewed!.metadata)).not.toContain('SELECT');

    // Hash chain verification across both entries
    expect(rowsViewed!.previousHash).toBeNull();
    expect(piiViewed!.previousHash).toBe(rowsViewed!.entryHash);

    const hash1 = createAuditEntryHash({
      previousHash: null,
      payload: {
        id: rowsViewed!.id,
        occurredAt: rowsViewed!.occurredAt,
        actorUserId: rowsViewed!.actorUserId,
        action: rowsViewed!.action,
        subjectType: rowsViewed!.subjectType,
        subjectId: rowsViewed!.subjectId,
        requestId: rowsViewed!.requestId,
        ipHash: rowsViewed!.ipHash,
        metadata: rowsViewed!.metadata
      }
    });
    expect(rowsViewed!.entryHash).toBe(hash1);

    const hash2 = createAuditEntryHash({
      previousHash: rowsViewed!.entryHash,
      payload: {
        id: piiViewed!.id,
        occurredAt: piiViewed!.occurredAt,
        actorUserId: piiViewed!.actorUserId,
        action: piiViewed!.action,
        subjectType: piiViewed!.subjectType,
        subjectId: piiViewed!.subjectId,
        requestId: piiViewed!.requestId,
        ipHash: piiViewed!.ipHash,
        metadata: piiViewed!.metadata
      }
    });
    expect(piiViewed!.entryHash).toBe(hash2);
  });

  it('audits schema view, reveal grant, and reveal revoke actions', async () => {
    const { app, storedEntries } = createTestHarness();

    // 1. Schema view
    const schemaRes = await request(app).get('/api/v1/database/edutrack_production/schema');
    expect(schemaRes.status).toBe(200);

    // 2. Reveal grant
    const grantRes = await request(app)
      .post('/api/v1/database/pii-reveal')
      .set('x-ops-csrf', 'test-csrf')
      .send({
        targetId: 'edutrack_production',
        password: 'valid-password',
        token: '123456',
        reason: 'Investigate student enrollment data issue'
      });
    expect(grantRes.status).toBe(200);
    expect(Object.keys(grantRes.body)).toEqual(['expiresAt']);

    // 3. Reveal revoke
    const revokeRes = await request(app)
      .delete('/api/v1/database/pii-reveal')
      .set('x-ops-csrf', 'test-csrf');
    expect(revokeRes.status).toBe(200);

    expect(storedEntries).toHaveLength(3);
    expect(storedEntries[0]!.action).toBe('database.schema_viewed');
    expect(storedEntries[1]!.action).toBe('database.pii_reveal_granted');
    expect(storedEntries[1]!.metadata['reason']).toBe('Investigate student enrollment data issue');
    expect(storedEntries[2]!.action).toBe('database.pii_reveal_revoked');
    expect(storedEntries[2]!.metadata['revokedCount']).toBe(1);

    // Verify all 3 form an unbroken hash chain
    expect(storedEntries[0]!.previousHash).toBeNull();
    expect(storedEntries[1]!.previousHash).toBe(storedEntries[0]!.entryHash);
    expect(storedEntries[2]!.previousHash).toBe(storedEntries[1]!.entryHash);
  });

  it('fails closed when audit persistence fails: returns 503 and discards all row data', async () => {
    const { app, storedEntries } = createTestHarness({ failAudit: true });

    const res = await request(app)
      .post('/api/v1/database/edutrack_production/rows/query')
      .set('x-ops-csrf', 'test-csrf')
      .send({
        schema: 'public',
        relation: 'users',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      });

    // Must return 503 DATABASE_AUDIT_UNAVAILABLE
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DATABASE_AUDIT_UNAVAILABLE');

    // CRITICAL: response must NOT contain any rows, cells, or values
    expect(res.body.rows).toBeUndefined();
    expect(res.body.data).toBeUndefined();
    expect(res.text).not.toContain('u***@example.com');
    expect(res.text).not.toContain('ref_123');
    expect(res.text).not.toContain('42');

    // No audit entry could be stored
    expect(storedEntries).toHaveLength(0);
  });
});
