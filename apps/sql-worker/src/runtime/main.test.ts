import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { SqlWorkerRuntimeConfig } from './runtimeConfig.js';
import { resolveSqlWorkerCredentials, startOpsSqlWorker } from './main.js';
import { signWorkerCommand } from '../protocol/authenticateCommand.js';
import { encodeFrame, FrameDecoder } from '../protocol/framing.js';

const disabledConfig: SqlWorkerRuntimeConfig = {
  secretDirectory: '/run/credentials/edutrack-ops-sql-worker.service',
  socketPath: '/run/edutrack-ops/sql-worker.sock',
  hmacSecretReference: 'ops-sql-worker-hmac',
  read: { enabled: false },
  mutation: { enabled: false }
};

describe('resolveSqlWorkerCredentials', () => {
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
      mutation: { enabled: false }
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
      mutation: { enabled: false }
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
      }
    });
  });
});

describe('startOpsSqlWorker', () => {
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
});

function disabledEnvironment(socketPath: string) {
  return {
    OPS_SECRET_DIRECTORY: '/run/credentials/edutrack-ops-sql-worker.service',
    OPS_SQL_SOCKET_PATH: socketPath,
    OPS_SQL_WORKER_HMAC_REFERENCE: 'ops-sql-worker-hmac',
    OPS_SQL_READ_ENABLED: 'false',
    OPS_SQL_MUTATION_ENABLED: 'false'
  };
}
