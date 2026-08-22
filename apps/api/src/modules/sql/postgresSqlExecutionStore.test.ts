import { describe, expect, it } from 'vitest';

import { PostgresSqlExecutionStore } from './postgresSqlExecutionStore.js';

describe('PostgresSqlExecutionStore', () => {
  it('records a running encrypted read preview and completes it without storing result rows', async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const store = new PostgresSqlExecutionStore({
      query: async <T>(sql: string, parameters?: readonly unknown[]) => {
        calls.push({ sql, ...(parameters === undefined ? {} : { parameters }) });
        return { rows: [{ id: 'f16f9426-010c-4e06-a459-9fd18c4a442d' }] as T[] };
      }
    });
    const execution = {
      id: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
      executionKey: 'SQL_20260822_000123',
      actorUserId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
      sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442f',
      reason: 'Investigate incident INC_01K3',
      encryptedSql: 'v1.encrypted.encrypted.encrypted',
      redactedSql: 'SELECT [redacted]',
      fingerprint: 'a'.repeat(64),
      metadata: { previewId: 'PRV_01K3', expiresAt: '2026-08-22T10:05:00.000Z' }
    };

    await expect(store.startReadPreview(execution)).resolves.toBe(true);
    await expect(
      store.finishReadPreview({
        executionId: execution.id,
        status: 'previewed',
        durationMs: 83,
        rowCount: 2,
        truncated: false,
        metadata: { encodedBytes: 42 }
      })
    ).resolves.toBe(true);

    expect(calls[0]?.sql).toContain('INSERT INTO sql_executions');
    expect(calls[0]?.sql).toContain("'read', 'running'");
    expect(calls[0]?.parameters).toEqual(
      expect.arrayContaining([
        execution.executionKey,
        execution.actorUserId,
        execution.sessionId,
        execution.encryptedSql,
        execution.redactedSql,
        execution.fingerprint
      ])
    );
    expect(calls[0]?.parameters?.join(' ')).not.toContain('SELECT *');
    expect(calls[1]?.sql).toContain('SET status = $2, completed_at = now()');
    expect(calls[1]?.parameters).toEqual(
      expect.arrayContaining([execution.id, 'previewed', 83, 2, false])
    );
  });

  it('lists bounded execution metadata without selecting encrypted SQL or result artifacts', async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const store = new PostgresSqlExecutionStore({
      query: async <T>(sql: string, parameters?: readonly unknown[]) => {
        calls.push({ sql, ...(parameters === undefined ? {} : { parameters }) });
        return {
          rows: [
            {
              id: 'execution-id',
              executionKey: 'SQL-20260822-000123',
              actorUserId: 'actor-id',
              actorDisplayName: 'Maintainer',
              executionKind: 'read',
              status: 'previewed',
              reason: 'Investigate timeout',
              fingerprint: 'a'.repeat(64),
              requestedAt: '2026-08-22T08:00:00.000Z',
              completedAt: '2026-08-22T08:00:01.000Z',
              durationMs: 100,
              affectedRows: '5',
              resultTruncated: false,
              issueId: null,
              incidentId: null,
              errorCode: null
            }
          ] as T[]
        };
      }
    });

    await expect(store.list({ limit: 20 })).resolves.toEqual([
      expect.objectContaining({
        executionKey: 'SQL-20260822-000123',
        actorDisplayName: 'Maintainer',
        affectedRows: 5
      })
    ]);
    expect(calls[0]?.sql).toContain('FROM sql_executions AS execution');
    expect(calls[0]?.sql).toContain('LEFT JOIN ops_users AS actor');
    expect(calls[0]?.sql).not.toContain('original_sql_ciphertext');
    expect(calls[0]?.sql).not.toContain('result_artifact');
    expect(calls[0]?.parameters).toEqual([20]);
  });
});
