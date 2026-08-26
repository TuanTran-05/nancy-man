import { describe, expect, it } from 'vitest';

import { createRestorePoint, createRestorePointName } from './restorePoint.js';

describe('restore points', () => {
  it('creates a safe name from a SQL execution identifier', () => {
    expect(createRestorePointName('SQL-20260822-000123')).toBe('ops_sql_20260822_000123');
    expect(createRestorePointName('SQL / dangerous whitespace')).toMatch(/^ops_[a-z0-9_]{1,55}$/);
  });

  it('uses a parameterized restore-point name and waits for archived WAL', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const archiveLsns = ['0/16B6C00', '0/16B6C50'];

    const evidence = await createRestorePoint({
      executionId: 'SQL-20260822-000123',
      now: () => new Date('2026-08-22T03:14:00Z'),
      maxArchivePolls: 2,
      database: {
        queryOne: async <T>(sql: string, parameters: readonly unknown[]) => {
          calls.push({ sql, parameters });
          if (sql.includes('pg_create_restore_point')) return { restoreLsn: '0/16B6C50' } as T;
          if (sql.includes('pg_current_wal_lsn')) return { walLsn: '0/16B6C50' } as T;
          throw new Error(`unexpected query: ${sql}`);
        },
        execute: async (sql: string) => {
          expect(sql).toContain('pg_switch_wal');
        }
      },
      archiveProbe: {
        latestArchivedLsn: async () => archiveLsns.shift() ?? '0/16B6C50'
      }
    });

    expect(calls[0]).toEqual({
      sql: 'SELECT pg_create_restore_point($1)::text AS "restoreLsn"',
      parameters: ['ops_sql_20260822_000123']
    });
    expect(evidence).toEqual({
      executionId: 'SQL-20260822-000123',
      restorePointName: 'ops_sql_20260822_000123',
      createdAt: '2026-08-22T03:14:00.000Z',
      walLsn: '0/16B6C50',
      archivedThroughLsn: '0/16B6C50',
      archiveVerified: true
    });
  });

  it('refuses to return evidence while archive progress has not reached the restore point', async () => {
    await expect(
      createRestorePoint({
        executionId: 'SQL-20260822-000123',
        maxArchivePolls: 2,
        database: {
          queryOne: async <T>() => ({ restoreLsn: '0/16B6C50', walLsn: '0/16B6C50' }) as T,
          execute: async () => undefined
        },
        archiveProbe: { latestArchivedLsn: async () => '0/16B6C00' }
      })
    ).rejects.toThrow(/archived WAL/i);
  });
});
