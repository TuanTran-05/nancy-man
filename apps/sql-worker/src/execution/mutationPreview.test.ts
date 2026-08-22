import { describe, expect, it } from 'vitest';

import { previewMutation } from './mutationPreview.js';

describe('previewMutation', () => {
  it('runs a DML statement in a rollback-only transaction and returns bounded row journal changes', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const database = {
      query: async <T>(sql: string, values: readonly unknown[] = []) => {
        calls.push({ sql, values });
        if (sql.startsWith('UPDATE public.students')) return { rows: [] as T[], rowCount: 1 };
        if (sql.includes('FROM _ops.row_change_journal')) {
          return {
            rows: [
              {
                journalId: '1',
                schemaName: 'public',
                tableName: 'students',
                operation: 'UPDATE',
                primaryKey: { id: 'student-1' },
                beforeRow: { id: 'student-1', name: 'Old' },
                afterRow: { id: 'student-1', name: 'New' },
                walLsn: '0/16B6A90',
                changedAt: '2026-08-22T10:00:01.000Z'
              }
            ] as T[]
          };
        }
        return { rows: [] as T[] };
      }
    };

    await expect(
      previewMutation({
        database,
        executionId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        executionKey: 'SQL-20260822-preview',
        actorUserId: 'maintainer-id',
        actorSessionId: 'session-id',
        reason: 'Correct incorrectly assigned class.',
        sql: "UPDATE public.students SET name = 'New' WHERE id = 'student-1'",
        maxChanges: 50
      })
    ).resolves.toEqual({
      affectedRows: 1,
      changes: [
        expect.objectContaining({
          operation: 'UPDATE',
          primaryKey: { id: 'student-1' },
          beforeRow: { id: 'student-1', name: 'Old' },
          afterRow: { id: 'student-1', name: 'New' }
        })
      ],
      truncated: false
    });

    expect(calls.map((call) => call.sql)).toEqual([
      'BEGIN',
      "SET LOCAL statement_timeout = '30s'",
      "SET LOCAL lock_timeout = '3s'",
      "SELECT set_config('app.ops_execution_id', $1, true)",
      expect.stringContaining('INSERT INTO _ops.execution_registry'),
      "UPDATE public.students SET name = 'New' WHERE id = 'student-1'",
      expect.stringContaining('FROM _ops.row_change_journal'),
      'ROLLBACK'
    ]);
    expect(calls.at(-2)?.values).toEqual(['f16f9426-010c-4e06-a459-9fd18c4a442d', 51]);
  });

  it('rejects non-DML before beginning a transaction and rolls back a failed DML preview', async () => {
    const calls: string[] = [];
    const database = {
      query: async <T>(sql: string) => {
        calls.push(sql);
        if (sql.startsWith('DELETE')) throw new Error('constraint failure secret=never-returned');
        return { rows: [] as T[] };
      }
    };
    const base = {
      database,
      executionId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
      executionKey: 'SQL-20260822-preview',
      actorUserId: 'maintainer-id',
      actorSessionId: 'session-id',
      reason: 'Correct incorrect data.'
    };

    await expect(previewMutation({ ...base, sql: 'DROP TABLE public.students' })).rejects.toThrow(
      'SQL_DML_REQUIRED'
    );
    expect(calls).toEqual([]);

    await expect(
      previewMutation({ ...base, sql: 'DELETE FROM public.students WHERE id = 1' })
    ).rejects.toThrow('SQL_MUTATION_PREVIEW_FAILED');
    expect(calls.at(-1)).toBe('ROLLBACK');
  });
});
