import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { SqlWorkerRuntimeConfig } from './runtimeConfig.js';
import {
  createExplorerTargetPool,
  resolveSqlWorkerCredentials,
  startOpsSqlWorker
} from './main.js';
import { signWorkerCommand } from '../protocol/authenticateCommand.js';
import { encodeFrame, FrameDecoder } from '../protocol/framing.js';
import { readProductionSchema } from '../schema/introspectSchema.js';
import { DATABASE_POLICY_VERSION } from '../../../../packages/security/src/database/columnPolicy.js';

const disabledConfig: SqlWorkerRuntimeConfig = {
  secretDirectory: '/run/credentials/edutrack-ops-sql-worker.service',
  socketPath: '/run/edutrack-ops/sql-worker.sock',
  hmacSecretReference: 'ops-sql-worker-hmac',
  telemetry: { enabled: false },
  read: { enabled: false },
  mutation: { enabled: false },
  explorer: { enabled: false }
};

const explorerConfig: SqlWorkerRuntimeConfig = {
  ...disabledConfig,
  explorer: {
    enabled: true,
    cursorKeyReference: 'ops-database-cursor-key',
    policyApprovalReference: 'ops-database-policy-approval',
    targets: {
      edutrack_production: { enabled: false },
      ops: { enabled: false }
    }
  }
};

describe('resolveSqlWorkerCredentials', () => {
  it('accepts only canonical Base64 encoding of exactly 32 cursor-key bytes', async () => {
    const key = Buffer.alloc(32, 13).toString('base64');
    await expect(
      resolveSqlWorkerCredentials({
        config: explorerConfig,
        resolveSecret: async (reference) => {
          if (reference === 'ops-sql-worker-hmac') return 'shared-hmac';
          if (reference === 'ops-database-cursor-key') return key;
          if (reference === 'ops-database-policy-approval') return '{}';
          return null;
        }
      })
    ).resolves.toMatchObject({ explorer: { enabled: true, cursorKey: key } });

    await expect(
      resolveSqlWorkerCredentials({
        config: explorerConfig,
        resolveSecret: async (reference) => {
          if (reference === 'ops-sql-worker-hmac') return 'shared-hmac';
          if (reference === 'ops-database-cursor-key') return 'a'.repeat(32);
          if (reference === 'ops-database-policy-approval') return '{}';
          return null;
        }
      })
    ).rejects.toThrowError('SQL worker runtime credentials are unavailable');
  });

  it('does not resolve or expose a production database credential while reads are disabled', async () => {
    const requested: string[] = [];

    await expect(
      resolveSqlWorkerCredentials({
        config: disabledConfig,
        resolveSecret: async (reference) => {
          requested.push(reference);
          return reference === 'ops-sql-worker-hmac' ? 'shared-hmac' : null;
        }
      })
    ).resolves.toEqual({
      hmacSecret: 'shared-hmac',
      read: { enabled: false },
      mutation: { enabled: false },
      explorer: { enabled: false }
    });
    expect(requested).toEqual(['ops-sql-worker-hmac']);
  });

  it('resolves the separate production read credential only after the read flag is enabled', async () => {
    const config: SqlWorkerRuntimeConfig = {
      ...disabledConfig,
      read: {
        enabled: true,
        databaseUrlReference: 'production-read-database-url',
        databaseName: 'edutrack_production',
        role: 'ops_production_reader'
      }
    };

    await expect(
      resolveSqlWorkerCredentials({
        config,
        resolveSecret: async (reference) =>
          reference === 'ops-sql-worker-hmac'
            ? 'shared-hmac'
            : 'postgresql://reader:secret@db.internal/edutrack_production?sslmode=verify-full'
      })
    ).resolves.toEqual({
      hmacSecret: 'shared-hmac',
      read: {
        enabled: true,
        databaseUrl:
          'postgresql://reader:secret@db.internal/edutrack_production?sslmode=verify-full',
        databaseName: 'edutrack_production',
        role: 'ops_production_reader'
      },
      mutation: { enabled: false },
      explorer: { enabled: false }
    });
  });

  it('resolves the separate production mutation credential only after the mutation flag is enabled', async () => {
    const config: SqlWorkerRuntimeConfig = {
      ...disabledConfig,
      mutation: {
        enabled: true,
        databaseUrlReference: 'production-mutation-database-url',
        databaseName: 'edutrack_production',
        role: 'ops_production_mutator'
      }
    };

    await expect(
      resolveSqlWorkerCredentials({
        config,
        resolveSecret: async (reference) =>
          reference === 'ops-sql-worker-hmac'
            ? 'shared-hmac'
            : 'postgresql://mutator:secret@db.internal/edutrack_production?sslmode=verify-full'
      })
    ).resolves.toEqual({
      hmacSecret: 'shared-hmac',
      read: { enabled: false },
      mutation: {
        enabled: true,
        databaseUrl:
          'postgresql://mutator:secret@db.internal/edutrack_production?sslmode=verify-full',
        databaseName: 'edutrack_production',
        role: 'ops_production_mutator'
      },
      explorer: { enabled: false }
    });
  });
});

describe('startOpsSqlWorker', () => {
  it('configures explorer pools to bound target-pool acquisition to one second', async () => {
    const pool = createExplorerTargetPool(
      'ops',
      'postgresql://reader:secret@ops-db/edutrack_ops?sslmode=verify-full'
    ) as unknown as {
      options: { connectionTimeoutMillis: number; max: number };
      end: () => Promise<void>;
    };

    try {
      expect(pool.options.connectionTimeoutMillis).toBe(1_000);
      expect(pool.options.max).toBe(2);
    } finally {
      await pool.end();
    }
  });

  it('captures a hostile pool-close rejection before flushing and preserves its identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-sql-worker-'));
    const socketPath = join(directory, 'worker.sock');
    const cleanupFailure = new Error('read pool refused to close');
    const captured: Array<{ error: unknown; context: { code: string; source?: string } }> = [];
    const order: string[] = [];
    const worker = await startOpsSqlWorker({
      environment: {
        ...disabledEnvironment(socketPath),
        OPS_SQL_READ_ENABLED: 'true',
        OPS_PRODUCTION_READ_DATABASE_URL_REFERENCE: 'production-read-database-url',
        OPS_PRODUCTION_READ_DATABASE_NAME: 'edutrack_production',
        OPS_PRODUCTION_READ_ROLE: 'ops_production_reader'
      },
      resolveSecret: async (reference) =>
        reference === 'ops-sql-worker-hmac'
          ? 'shared-hmac'
          : 'postgresql://reader:secret@db.internal/edutrack_production?sslmode=verify-full',
      telemetry: {
        captureException: (error, context) => {
          order.push('capture');
          captured.push({ error, context });
          return 'EVT_00000000000000000000000000';
        },
        flush: async () => {
          order.push('flush');
        },
        healthy: () => true
      },
      createReadPool: () => ({
        query: async <T>() => ({
          rows: [
            {
              role: 'ops_production_reader',
              database: 'edutrack_production',
              defaultTransactionReadOnly: 'on'
            }
          ] as T[]
        }),
        connect: async () => ({
          query: async <T>() => ({ rows: [] as T[] }),
          release: () => undefined
        }),
        end: async () => {
          order.push('pool:end');
          throw cleanupFailure;
        }
      })
    });

    try {
      order.length = 0;
      captured.length = 0;
      await expect(worker.close()).rejects.toBe(cleanupFailure);
      expect(captured).toEqual([
        {
          error: cleanupFailure,
          context: { code: 'SQL_WORKER_READ_POOL_CLOSE_FAILED', source: 'database' }
        }
      ]);
      expect(order).toEqual(['pool:end', 'capture', 'flush']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('starts its Unix listener without opening a production database connection while reads are disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-sql-worker-'));
    const socketPath = join(directory, 'worker.sock');
    const worker = await startOpsSqlWorker({
      environment: { ...disabledEnvironment(socketPath) },
      resolveSecret: async () => 'shared-hmac'
    });
    const unsigned = {
      protocolVersion: 1 as const,
      commandId: 'cmd_1',
      issuedAt: new Date().toISOString(),
      nonce: 'nonce-0123456789abcdef',
      actor: { userId: 'usr_1', sessionId: 'ses_1', role: 'ops_maintainer' as const },
      kind: 'sql.classify' as const,
      payload: { sql: 'SELECT id FROM students' }
    };
    const command = { ...unsigned, signature: signWorkerCommand(unsigned, 'shared-hmac') };

    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const socket = createConnection(socketPath);
        const decoder = new FrameDecoder();
        socket.on('connect', () => socket.write(encodeFrame(command)));
        socket.on('data', (chunk) => {
          const [value] = decoder.push(chunk);
          if (value) {
            socket.end();
            resolve(value);
          }
        });
        socket.on('error', reject);
      });
      expect(response).toMatchObject({ ok: true, result: { allowed: true, kind: 'select' } });
    } finally {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('checks the dedicated production read role before serving a bounded read preview', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-sql-worker-'));
    const socketPath = join(directory, 'worker.sock');
    const connectionCalls: string[] = [];
    let released = false;
    let ended = false;
    const worker = await startOpsSqlWorker({
      environment: {
        ...disabledEnvironment(socketPath),
        OPS_SQL_READ_ENABLED: 'true',
        OPS_PRODUCTION_READ_DATABASE_URL_REFERENCE: 'production-read-database-url',
        OPS_PRODUCTION_READ_DATABASE_NAME: 'edutrack_production',
        OPS_PRODUCTION_READ_ROLE: 'ops_production_reader'
      },
      resolveSecret: async (reference) =>
        reference === 'ops-sql-worker-hmac'
          ? 'shared-hmac'
          : 'postgresql://reader:secret@db.internal/edutrack_production?sslmode=verify-full',
      createReadPool: (databaseUrl) => {
        expect(databaseUrl).toContain('sslmode=verify-full');
        return {
          query: async <T>() => ({
            rows: [
              {
                role: 'ops_production_reader',
                database: 'edutrack_production',
                defaultTransactionReadOnly: 'on'
              }
            ] as T[]
          }),
          connect: async () => ({
            query: async <T>(sql: string) => {
              connectionCalls.push(sql);
              return { rows: [{ id: 1 }, { id: 2 }] as T[] };
            },
            release: () => {
              released = true;
            }
          }),
          end: async () => {
            ended = true;
          }
        };
      }
    });
    const unsigned = {
      protocolVersion: 1 as const,
      commandId: 'cmd_2',
      issuedAt: new Date().toISOString(),
      nonce: 'nonce-fedcba9876543210',
      actor: { userId: 'usr_1', sessionId: 'ses_1', role: 'ops_maintainer' as const },
      kind: 'sql.previewRead' as const,
      payload: { sql: 'SELECT id FROM students', maxRows: 1 }
    };
    const command = { ...unsigned, signature: signWorkerCommand(unsigned, 'shared-hmac') };

    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const socket = createConnection(socketPath);
        const decoder = new FrameDecoder();
        socket.on('connect', () => socket.write(encodeFrame(command)));
        socket.on('data', (chunk) => {
          const [value] = decoder.push(chunk);
          if (value) {
            socket.end();
            resolve(value);
          }
        });
        socket.on('error', reject);
      });
      expect(response).toMatchObject({
        ok: true,
        result: { rows: [{ id: 1 }], truncated: true }
      });
      expect(connectionCalls).toContain('BEGIN READ ONLY');
      expect(released).toBe(true);
    } finally {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    }
    expect(ended).toBe(true);
  });

  it('checks the separate mutation role and serves only a rollback preview through the private socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-sql-worker-'));
    const socketPath = join(directory, 'worker.sock');
    const connectionCalls: string[] = [];
    let released = false;
    let ended = false;
    const worker = await startOpsSqlWorker({
      environment: {
        ...disabledEnvironment(socketPath),
        OPS_SQL_MUTATION_ENABLED: 'true',
        OPS_PRODUCTION_MUTATION_DATABASE_URL_REFERENCE: 'production-mutation-database-url',
        OPS_PRODUCTION_MUTATION_DATABASE_NAME: 'edutrack_production',
        OPS_PRODUCTION_MUTATION_ROLE: 'ops_production_mutator'
      },
      resolveSecret: async (reference) =>
        reference === 'ops-sql-worker-hmac'
          ? 'shared-hmac'
          : 'postgresql://mutator:secret@db.internal/edutrack_production?sslmode=verify-full',
      createMutationPool: (databaseUrl) => {
        expect(databaseUrl).toContain('sslmode=verify-full');
        return {
          query: async <T>() => ({
            rows: [
              {
                role: 'ops_production_mutator',
                database: 'edutrack_production',
                defaultTransactionReadOnly: 'off'
              }
            ] as T[]
          }),
          connect: async () => ({
            query: async <T>(sql: string) => {
              connectionCalls.push(sql);
              if (sql.startsWith('DELETE')) return { rows: [] as T[], rowCount: 1 };
              if (sql.includes('FROM _ops.row_change_journal')) {
                return { rows: [{ operation: 'DELETE' }] as T[] };
              }
              return { rows: [] as T[] };
            },
            release: () => {
              released = true;
            }
          }),
          end: async () => {
            ended = true;
          }
        };
      }
    });
    const unsigned = {
      protocolVersion: 1 as const,
      commandId: 'cmd_3',
      issuedAt: new Date().toISOString(),
      nonce: 'nonce-preview-mutation',
      actor: { userId: 'usr_1', sessionId: 'ses_1', role: 'ops_maintainer' as const },
      kind: 'sql.previewMutation' as const,
      payload: {
        executionId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        executionKey: 'SQL-20260822-preview',
        reason: 'Correct incorrect data.',
        sql: 'DELETE FROM public.students WHERE id = 1'
      }
    };
    const command = { ...unsigned, signature: signWorkerCommand(unsigned, 'shared-hmac') };

    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const socket = createConnection(socketPath);
        const decoder = new FrameDecoder();
        socket.on('connect', () => socket.write(encodeFrame(command)));
        socket.on('data', (chunk) => {
          const [value] = decoder.push(chunk);
          if (value) {
            socket.end();
            resolve(value);
          }
        });
        socket.on('error', reject);
      });
      expect(response).toMatchObject({
        ok: true,
        result: { affectedRows: 1, changes: [{ operation: 'DELETE' }], truncated: false }
      });
      expect(connectionCalls).toContain('BEGIN');
      expect(connectionCalls).toContain('ROLLBACK');
      expect(released).toBe(true);
    } finally {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    }
    expect(ended).toBe(true);
  });

  it('serves ops schema when edutrack target is unavailable, without fallback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-sql-worker-'));
    const socketPath = join(directory, 'worker.sock');
    let opsPoolClosed = false;

    const worker = await startOpsSqlWorker({
      environment: {
        ...disabledEnvironment(socketPath),
        OPS_DATABASE_EXPLORER_ENABLED: 'true',
        OPS_DATABASE_CURSOR_KEY_REFERENCE: 'cursor-key-ref',
        OPS_DATABASE_POLICY_APPROVAL_REFERENCE: 'policy-approval-ref',
        OPS_DATABASE_EDUTRACK_ENABLED: 'true',
        OPS_DATABASE_EDUTRACK_URL_REFERENCE: 'edutrack-url-ref',
        OPS_DATABASE_EDUTRACK_NAME: 'edutrack',
        OPS_DATABASE_EDUTRACK_ROLE: 'ops_database_browser',
        OPS_DATABASE_OPS_ENABLED: 'true',
        OPS_DATABASE_OPS_URL_REFERENCE: 'ops-url-ref',
        OPS_DATABASE_OPS_NAME: 'edutrack_ops',
        OPS_DATABASE_OPS_ROLE: 'ops_database_browser'
      },
      resolveSecret: async (ref) => {
        if (ref === 'ops-sql-worker-hmac') return 'shared-hmac';
        if (ref === 'cursor-key-ref') return Buffer.alloc(32, 13).toString('base64');
        if (ref === 'policy-approval-ref') return '{}';
        if (ref === 'edutrack-url-ref')
          return 'postgresql://reader:secret@edutrack-broken/edutrack?sslmode=verify-full';
        if (ref === 'ops-url-ref')
          return 'postgresql://reader:secret@ops-db/edutrack_ops?sslmode=verify-full';
        return null;
      },
      createExplorerPool: (targetId) => {
        if (targetId === 'edutrack_production') {
          return {
            query: async () => {
              throw new Error('connection refused to edutrack');
            },
            connect: async () => {
              throw new Error('connection refused to edutrack');
            },
            end: async () => undefined
          };
        }
        return {
          query: async <T>() => ({
            rows: [
              {
                role: 'ops_database_browser',
                database: 'edutrack_ops',
                defaultTransactionReadOnly: 'on'
              }
            ] as T[]
          }),
          connect: async () => ({
            query: async <T>() => ({ rows: [] as T[] }),
            release: () => undefined
          }),
          end: async () => {
            opsPoolClosed = true;
          }
        };
      }
    });

    try {
      // Query Ops target schema -> should succeed
      const opsCmd = {
        protocolVersion: 1 as const,
        commandId: 'cmd_ops',
        issuedAt: new Date().toISOString(),
        nonce: 'nonce_ops_0123456789',
        actor: { userId: 'u1', sessionId: 's1', role: 'ops_maintainer' as const },
        kind: 'database.schema' as const,
        payload: { targetId: 'ops' }
      };
      const signedOps = { ...opsCmd, signature: signWorkerCommand(opsCmd, 'shared-hmac') };

      const opsResponse = await new Promise<unknown>((resolve, reject) => {
        const socket = createConnection(socketPath);
        const decoder = new FrameDecoder();
        socket.on('connect', () => socket.write(encodeFrame(signedOps)));
        socket.on('data', (chunk) => {
          const [value] = decoder.push(chunk);
          if (value) {
            socket.end();
            resolve(value);
          }
        });
        socket.on('error', reject);
      });
      expect(opsResponse).toMatchObject({ ok: true, result: { targetId: 'ops' } });

      // Query EduTrack target schema -> should fail with error without falling back to Ops
      const eduCmd = {
        protocolVersion: 1 as const,
        commandId: 'cmd_edu',
        issuedAt: new Date().toISOString(),
        nonce: 'nonce_edu_0123456789',
        actor: { userId: 'u1', sessionId: 's1', role: 'ops_maintainer' as const },
        kind: 'database.schema' as const,
        payload: { targetId: 'edutrack_production' }
      };
      const signedEdu = { ...eduCmd, signature: signWorkerCommand(eduCmd, 'shared-hmac') };

      const eduResponse = await new Promise<unknown>((resolve, reject) => {
        const socket = createConnection(socketPath);
        const decoder = new FrameDecoder();
        socket.on('connect', () => socket.write(encodeFrame(signedEdu)));
        socket.on('data', (chunk) => {
          const [value] = decoder.push(chunk);
          if (value) {
            socket.end();
            resolve(value);
          }
        });
        socket.on('error', reject);
      });
      expect(eduResponse).toMatchObject({
        ok: false,
        error: { code: 'DATABASE_TARGET_UNAVAILABLE' }
      });
    } finally {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    }

    expect(opsPoolClosed).toBe(true);
  });
});

describe('database explorer worker commands', () => {
  it('serves live schema, masked rows, and related rows from only the requested target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-sql-worker-explorer-'));
    const socketPath = join(directory, 'worker.sock');
    const opsCounters = createExplorerFixtureCounters();
    const eduCounters = createExplorerFixtureCounters();
    const opsPool = createExplorerFixturePool(
      'ops',
      'ops_database_browser',
      'edutrack_ops',
      opsCounters
    );
    const eduPool = createExplorerFixturePool(
      'edutrack_production',
      'ops_database_browser',
      'edutrack_production',
      eduCounters
    );
    const structuralConnection = await opsPool.connect();
    const structuralSchema = await readProductionSchema({ database: structuralConnection });
    structuralConnection.release();
    opsCounters.connections = 0;
    opsCounters.catalogQueries.length = 0;
    opsCounters.rowQueries.length = 0;
    const policyApproval = JSON.stringify({
      version: DATABASE_POLICY_VERSION,
      targets: { ops: structuralSchema.checksum }
    });
    let now = 25_000;
    const worker = await startOpsSqlWorker({
      environment: explorerEnvironment(socketPath, false),
      resolveSecret: async (reference) => {
        if (reference === 'ops-sql-worker-hmac') return 'shared-hmac';
        if (reference === 'cursor-key-ref') return Buffer.alloc(32, 13).toString('base64');
        if (reference === 'policy-approval-ref') return policyApproval;
        if (reference === 'ops-url-ref')
          return 'postgresql://reader:secret@ops-db/edutrack_ops?sslmode=verify-full';
        return null;
      },
      createExplorerPool: (targetId) => (targetId === 'ops' ? opsPool : eduPool),
      now: () => now,
      probeExplorerTarget: async () => undefined
    });

    try {
      const targets = await sendWorkerCommand(socketPath, 'database.targets', {}, 'ops_viewer');
      expect(targets).toMatchObject({
        ok: true,
        result: [
          { id: 'edutrack_production', status: 'disabled', readOnly: true },
          { id: 'ops', status: 'available', readOnly: true }
        ]
      });

      const viewerRows = await sendWorkerCommand(
        socketPath,
        'database.rows',
        {
          targetId: 'ops',
          schema: 'public',
          relation: 'students',
          pageSize: 25,
          filters: [],
          piiMode: 'masked'
        },
        'ops_viewer'
      );
      expect(viewerRows).toMatchObject({
        ok: false,
        error: { code: 'WORKER_COMMAND_DENIED' }
      });
      expect(opsCounters.connections).toBe(0);

      const malformedPayload = await sendWorkerCommand(socketPath, 'database.schema', {
        targetId: 'ops',
        unexpected: true
      });
      expect(malformedPayload).toMatchObject({
        ok: false,
        error: { code: 'WORKER_COMMAND_INVALID' }
      });

      const invalidTarget = await sendWorkerCommand(socketPath, 'database.schema', {
        targetId: 'arbitrary_database'
      });
      expect(invalidTarget).toMatchObject({
        ok: false,
        error: { code: 'DATABASE_TARGET_INVALID' }
      });

      const schemaResponse = await sendWorkerCommand(socketPath, 'database.schema', {
        targetId: 'ops'
      });
      const liveSnapshot = (
        schemaResponse as {
          result: {
            checksum: string;
            policyVersion: string;
            schemas: Array<{ relations: Array<{ name: string; dataAvailable: boolean }> }>;
          };
        }
      ).result;
      expect(liveSnapshot.checksum).toBe(structuralSchema.checksum);
      expect(liveSnapshot.policyVersion).toBe(DATABASE_POLICY_VERSION);
      expect(
        liveSnapshot.schemas[0]?.relations.find((relation) => relation.name === 'students')
          ?.dataAvailable
      ).toBe(true);
      expect(schemaResponse).toMatchObject({
        ok: true,
        result: {
          targetId: 'ops',
          targetLabel: 'Ops Database',
          schemas: [
            {
              name: 'public',
              relations: expect.arrayContaining([expect.objectContaining({ name: 'students' })])
            }
          ]
        }
      });

      const rowsResponse = await sendWorkerCommand(socketPath, 'database.rows', {
        targetId: 'ops',
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      });
      expect(rowsResponse).toMatchObject({
        ok: true,
        result: {
          targetId: 'ops',
          schema: 'public',
          relation: 'students',
          rows: [
            {
              cells: {
                id: { state: 'value', value: 'student-1' },
                email: { state: 'masked', display: 's***@example.edu' }
              }
            }
          ]
        }
      });
      const rowRef = (rowsResponse as { result: { rows: Array<{ rowRef: string }> } }).result
        .rows[0]!.rowRef;

      const relatedResponse = await sendWorkerCommand(socketPath, 'database.relatedRows', {
        targetId: 'ops',
        schema: 'public',
        relation: 'students',
        constraint: 'attendance_student_fkey',
        rowRef,
        pageSize: 25,
        piiMode: 'masked'
      });
      expect(relatedResponse).toMatchObject({
        ok: true,
        result: {
          targetId: 'ops',
          schema: 'public',
          relation: 'attendance',
          rows: [{ cells: { id: { state: 'value', value: 'attendance-1' } } }]
        }
      });
      expect(opsCounters.catalogQueries.length).toBeGreaterThan(0);
      expect(
        opsCounters.rowQueries.some(({ sql }) => sql.includes('FROM "public"."attendance"'))
      ).toBe(true);
      expect(eduCounters.connections).toBe(0);
      expect(eduCounters.catalogQueries).toEqual([]);
      now += 1_000;
    } finally {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refreshes and recovers each enabled target independently through the signed status command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-sql-worker-health-'));
    const socketPath = join(directory, 'worker.sock');
    const ended: string[] = [];
    const probeCalls: string[] = [];
    let now = 1_000;
    let opsHealthy = true;
    const worker = await startOpsSqlWorker({
      environment: explorerEnvironment(socketPath, true),
      resolveSecret: async (reference) => {
        if (reference === 'ops-sql-worker-hmac') return 'shared-hmac';
        if (reference === 'cursor-key-ref') return Buffer.alloc(32, 13).toString('base64');
        if (reference === 'policy-approval-ref') return '{}';
        if (reference === 'edu-url-ref')
          return 'postgresql://reader:secret@edutrack/edutrack_production?sslmode=verify-full';
        if (reference === 'ops-url-ref')
          return 'postgresql://reader:secret@ops-db/edutrack_ops?sslmode=verify-full';
        return null;
      },
      createExplorerPool: (targetId) => ({
        query: async <T>() => ({
          rows: [
            {
              role: 'ops_database_browser',
              database: targetId === 'ops' ? 'edutrack_ops' : 'edutrack_production',
              defaultTransactionReadOnly: 'on'
            }
          ] as T[]
        }),
        connect: async () => {
          throw new Error('status command opened a reader connection');
        },
        end: async () => {
          ended.push(targetId);
        }
      }),
      now: () => now,
      probeExplorerTarget: async (targetId) => {
        probeCalls.push(targetId);
        if (targetId === 'ops' && !opsHealthy) throw new Error('Ops database is offline');
      }
    });

    try {
      await expect(
        sendWorkerCommand(socketPath, 'database.targets', {}, 'ops_viewer')
      ).resolves.toMatchObject({
        ok: true,
        result: [
          { id: 'edutrack_production', status: 'available' },
          { id: 'ops', status: 'available' }
        ]
      });
      now += 5_000;
      opsHealthy = false;
      await expect(sendWorkerCommand(socketPath, 'database.targets', {})).resolves.toMatchObject({
        ok: true,
        result: [
          { id: 'edutrack_production', status: 'available' },
          { id: 'ops', status: 'unavailable' }
        ]
      });
      await sendWorkerCommand(socketPath, 'database.targets', {});
      expect(probeCalls).toEqual(['edutrack_production', 'ops']);

      now += 5_000;
      opsHealthy = true;
      await expect(sendWorkerCommand(socketPath, 'database.targets', {})).resolves.toMatchObject({
        ok: true,
        result: [
          { id: 'edutrack_production', status: 'available' },
          { id: 'ops', status: 'available' }
        ]
      });
      expect(probeCalls).toEqual(['edutrack_production', 'ops', 'edutrack_production', 'ops']);
    } finally {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    }
    expect(ended.sort()).toEqual(['edutrack_production', 'ops']);
  });
});

function createExplorerFixtureCounters() {
  return {
    connections: 0,
    catalogQueries: [] as string[],
    rowQueries: [] as Array<{ sql: string; values?: readonly unknown[] }>
  };
}

function createExplorerFixturePool(
  targetId: 'edutrack_production' | 'ops',
  role: string,
  database: string,
  counters: ReturnType<typeof createExplorerFixtureCounters>
) {
  return {
    query: async <T>(sql: string) => {
      if (sql.includes('current_user::text')) {
        return {
          rows: [{ role, database, defaultTransactionReadOnly: 'on' }] as T[]
        };
      }
      return { rows: [] as T[] };
    },
    connect: async () => {
      counters.connections++;
      return {
        query: async <T>(sql: string, values?: readonly unknown[]) => {
          if (sql.includes('catalog:')) counters.catalogQueries.push(sql);
          if (sql.includes('FROM "public".')) counters.rowQueries.push({ sql, values });
          if (sql.includes('catalog:schemas')) {
            return { rows: [{ schemaName: 'public' }] as T[] };
          }
          if (sql.includes('catalog:relations')) {
            return {
              rows: [
                {
                  schemaName: 'public',
                  relationName: 'students',
                  kind: 'table',
                  rowSecurityEnabled: false,
                  forceRowSecurity: false
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  kind: 'table',
                  rowSecurityEnabled: false,
                  forceRowSecurity: false
                }
              ] as T[]
            };
          }
          if (sql.includes('catalog:columns')) {
            return {
              rows: [
                {
                  schemaName: 'public',
                  relationName: 'students',
                  columnName: 'id',
                  dataType: 'text',
                  nullable: false,
                  hasDefault: false,
                  identity: '',
                  generated: ''
                },
                {
                  schemaName: 'public',
                  relationName: 'students',
                  columnName: 'email',
                  dataType: 'text',
                  nullable: false,
                  hasDefault: false,
                  identity: '',
                  generated: ''
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  columnName: 'id',
                  dataType: 'text',
                  nullable: false,
                  hasDefault: false,
                  identity: '',
                  generated: ''
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  columnName: 'student_id',
                  dataType: 'text',
                  nullable: false,
                  hasDefault: false,
                  identity: '',
                  generated: ''
                }
              ] as T[]
            };
          }
          if (sql.includes('catalog:constraints')) {
            return {
              rows: [
                {
                  schemaName: 'public',
                  relationName: 'students',
                  constraintName: 'students_pkey',
                  kind: 'primary_key',
                  columns: ['id'],
                  referencedSchema: null,
                  referencedRelation: null,
                  referencedColumns: [],
                  deferrable: false,
                  initiallyDeferred: false
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  constraintName: 'attendance_pkey',
                  kind: 'primary_key',
                  columns: ['id'],
                  referencedSchema: null,
                  referencedRelation: null,
                  referencedColumns: [],
                  deferrable: false,
                  initiallyDeferred: false
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  constraintName: 'attendance_student_fkey',
                  kind: 'foreign_key',
                  columns: ['student_id'],
                  referencedSchema: 'public',
                  referencedRelation: 'students',
                  referencedColumns: ['id'],
                  deferrable: false,
                  initiallyDeferred: false
                }
              ] as T[]
            };
          }
          if (
            sql.includes('catalog:indexes') ||
            sql.includes('catalog:triggers') ||
            sql.includes('catalog:policies') ||
            sql.includes('catalog:estimated_rows') ||
            sql.includes('catalog:enum_columns')
          ) {
            return { rows: [] as T[] };
          }
          if (sql.includes('FROM "public"."students"')) {
            return {
              rows: [{ id: 'student-1', email: 'sam@example.edu' }] as T[]
            };
          }
          if (sql.includes('FROM "public"."attendance"')) {
            return {
              rows: [{ id: 'attendance-1', student_id: 'student-1' }] as T[]
            };
          }
          return { rows: [] as T[] };
        },
        release: () => undefined
      };
    },
    end: async () => undefined,
    targetId
  };
}

function explorerEnvironment(socketPath: string, enableEduTrack: boolean) {
  return {
    ...disabledEnvironment(socketPath),
    OPS_DATABASE_EXPLORER_ENABLED: 'true',
    OPS_DATABASE_CURSOR_KEY_REFERENCE: 'cursor-key-ref',
    OPS_DATABASE_POLICY_APPROVAL_REFERENCE: 'policy-approval-ref',
    OPS_DATABASE_EDUTRACK_ENABLED: String(enableEduTrack),
    ...(enableEduTrack
      ? {
          OPS_DATABASE_EDUTRACK_URL_REFERENCE: 'edu-url-ref',
          OPS_DATABASE_EDUTRACK_NAME: 'edutrack_production',
          OPS_DATABASE_EDUTRACK_ROLE: 'ops_database_browser'
        }
      : {}),
    OPS_DATABASE_OPS_ENABLED: 'true',
    OPS_DATABASE_OPS_URL_REFERENCE: 'ops-url-ref',
    OPS_DATABASE_OPS_NAME: 'edutrack_ops',
    OPS_DATABASE_OPS_ROLE: 'ops_database_browser'
  };
}

let nextWorkerCommand = 0;
async function sendWorkerCommand(
  socketPath: string,
  kind: string,
  payload: unknown,
  role: 'ops_viewer' | 'ops_maintainer' = 'ops_maintainer'
): Promise<unknown> {
  const commandNumber = ++nextWorkerCommand;
  const unsigned = {
    protocolVersion: 1 as const,
    commandId: `cmd_explorer_${commandNumber}`,
    issuedAt: new Date().toISOString(),
    nonce: `nonce_explorer_${commandNumber}_0123456789`,
    actor: { userId: 'usr_explorer', sessionId: 'ses_explorer', role },
    kind,
    payload
  };
  const command = {
    ...unsigned,
    signature: signWorkerCommand(unsigned as never, 'shared-hmac')
  };
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const decoder = new FrameDecoder();
    socket.on('connect', () => socket.write(encodeFrame(command)));
    socket.on('data', (chunk) => {
      const [value] = decoder.push(chunk);
      if (value) {
        socket.end();
        resolve(value);
      }
    });
    socket.on('error', reject);
  });
}

function disabledEnvironment(socketPath: string) {
  return {
    OPS_SECRET_DIRECTORY: '/run/credentials/edutrack-ops-sql-worker.service',
    OPS_SQL_SOCKET_PATH: socketPath,
    OPS_SQL_WORKER_HMAC_REFERENCE: 'ops-sql-worker-hmac',
    OPS_SQL_READ_ENABLED: 'false',
    OPS_SQL_MUTATION_ENABLED: 'false'
  };
}
