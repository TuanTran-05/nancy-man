import { describe, expect, it } from 'vitest';

import { decryptEnvelope } from '../../../../../packages/security/src/encryption/envelope.js';

import { SqlReadPreviewService } from './readPreviewService.js';

describe('SqlReadPreviewService', () => {
  it('refuses to create an execution or contact the worker without an active MFA elevation', async () => {
    let started = false;
    let calledWorker = false;
    const service = new SqlReadPreviewService({
      elevation: { consumeActive: async () => null },
      executionStore: {
        startReadPreview: async () => {
          started = true;
          return true;
        },
        finishReadPreview: async () => true
      },
      audit: { append: async () => ({ id: 'audit', entryHash: 'a'.repeat(64) }) },
      worker: {
        command: async () => {
          calledWorker = true;
          return { protocolVersion: 1, commandId: 'cmd', ok: true, result: {} };
        }
      },
      encryptionKey: Buffer.alloc(32, 9)
    });

    await expect(
      service.preview({
        actor: {
          userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
          role: 'ops_maintainer'
        },
        sql: 'SELECT id FROM students',
        reason: 'Investigate issue ERR_01K3'
      })
    ).resolves.toEqual({ status: 'elevation_required' });
    expect(started).toBe(false);
    expect(calledWorker).toBe(false);
  });

  it('persists encrypted SQL and a hash-chained audit before returning a bounded worker preview', async () => {
    const started: unknown[] = [];
    const finished: unknown[] = [];
    const audit: unknown[] = [];
    const key = Buffer.alloc(32, 9);
    const executionId = 'f16f9426-010c-4e06-a459-9fd18c4a442d';
    const service = new SqlReadPreviewService({
      elevation: {
        consumeActive: async () => ({
          idleExpiresAt: '2026-08-22T10:15:00.000Z',
          absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
        })
      },
      executionStore: {
        startReadPreview: async (input) => {
          started.push(input);
          return true;
        },
        finishReadPreview: async (input) => {
          finished.push(input);
          return true;
        }
      },
      audit: {
        append: async (input) => {
          audit.push(input);
          return { id: 'audit', entryHash: 'a'.repeat(64) };
        }
      },
      worker: {
        command: async () => ({
          protocolVersion: 1,
          commandId: 'cmd',
          ok: true,
          result: { rows: [{ id: 1 }], encodedBytes: 10, truncated: false }
        })
      },
      encryptionKey: key,
      now: () => new Date('2026-08-22T10:00:00.000Z'),
      executionId: () => executionId
    });

    await expect(
      service.preview({
        actor: {
          userId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
          sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442f',
          role: 'ops_maintainer'
        },
        sql: 'SELECT id FROM students WHERE id = 1',
        reason: 'Investigate issue ERR_01K3'
      })
    ).resolves.toEqual({
      status: 'previewed',
      executionKey: `SQL-20260822-${executionId}`,
      previewId: `PRV_${executionId}`,
      expiresAt: '2026-08-22T10:05:00.000Z',
      result: { rows: [{ id: 1 }], encodedBytes: 10, truncated: false }
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      id: executionId,
      executionKey: `SQL-20260822-${executionId}`,
      redactedSql: 'SQL preview (encrypted)',
      metadata: { previewId: `PRV_${executionId}`, expiresAt: '2026-08-22T10:05:00.000Z' }
    });
    const encryptedSql = (started[0] as { encryptedSql: string }).encryptedSql;
    expect(encryptedSql).not.toContain('SELECT');
    expect(
      decryptEnvelope({
        envelope: encryptedSql,
        key,
        associatedData: `ops-sql-execution:${executionId}`
      })
    ).toBe('SELECT id FROM students WHERE id = 1');
    expect(finished).toEqual([
      {
        executionId,
        status: 'previewed',
        durationMs: 0,
        rowCount: 1,
        truncated: false,
        metadata: { encodedBytes: 10, previewId: `PRV_${executionId}` }
      }
    ]);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'sql.preview_started',
          subjectId: `SQL-20260822-${executionId}`
        }),
        expect.objectContaining({
          action: 'sql.previewed',
          subjectId: `SQL-20260822-${executionId}`
        })
      ])
    );
    expect(JSON.stringify(audit)).not.toContain('SELECT id FROM students');
  });

  it('records a failed execution without exposing a socket error when the worker is unavailable', async () => {
    const finished: unknown[] = [];
    const audit: unknown[] = [];
    const executionId = 'f16f9426-010c-4e06-a459-9fd18c4a442d';
    const service = new SqlReadPreviewService({
      elevation: { consumeActive: async () => ({}) },
      executionStore: {
        startReadPreview: async () => true,
        finishReadPreview: async (input) => {
          finished.push(input);
          return true;
        }
      },
      audit: {
        append: async (input) => {
          audit.push(input);
          return { id: 'audit', entryHash: 'a'.repeat(64) };
        }
      },
      worker: {
        command: async () => {
          throw new Error('connect ENOENT /run/edutrack-ops/sql-worker.sock');
        }
      },
      encryptionKey: Buffer.alloc(32, 9),
      now: () => new Date('2026-08-22T10:00:00.000Z'),
      executionId: () => executionId
    });

    await expect(
      service.preview({
        actor: {
          userId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
          sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442f',
          role: 'ops_maintainer'
        },
        sql: 'SELECT id FROM students',
        reason: 'Investigate issue ERR_01K3'
      })
    ).resolves.toEqual({ status: 'failed', code: 'SQL_WORKER_UNAVAILABLE' });
    expect(finished).toEqual([
      expect.objectContaining({ executionId, status: 'failed', metadata: expect.any(Object) })
    ]);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'sql.preview_failed',
          metadata: { code: 'SQL_WORKER_UNAVAILABLE', previewId: `PRV_${executionId}` }
        })
      ])
    );
    expect(JSON.stringify(audit)).not.toContain('ENOENT');
  });
});
