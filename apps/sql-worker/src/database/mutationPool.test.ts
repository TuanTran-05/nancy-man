import { describe, expect, it } from 'vitest';

import { assertProductionMutationIdentity, createMutationPreviewer } from './mutationPool.js';

describe('production mutation pool', () => {
  it('accepts only a dedicated writable role on the expected production database', async () => {
    await expect(
      assertProductionMutationIdentity({
        database: {
          query: async <T>() => ({
            rows: [
              {
                role: 'ops_production_mutator',
                database: 'edutrack_production',
                defaultTransactionReadOnly: 'off'
              }
            ] as T[]
          })
        },
        expectedRole: 'ops_production_mutator',
        expectedDatabase: 'edutrack_production'
      })
    ).resolves.toEqual({ role: 'ops_production_mutator', database: 'edutrack_production' });
  });

  it('rejects a read-only transaction or unexpected identity before previewing a mutation', async () => {
    await expect(
      assertProductionMutationIdentity({
        database: {
          query: async <T>() => ({
            rows: [
              {
                role: 'ops_production_mutator',
                database: 'edutrack_production',
                defaultTransactionReadOnly: 'on'
              }
            ] as T[]
          })
        },
        expectedRole: 'ops_production_mutator',
        expectedDatabase: 'edutrack_production'
      })
    ).rejects.toThrow(/mutation/i);
  });

  it('checks out and releases one worker-owned connection for a rollback-only preview', async () => {
    const calls: string[] = [];
    let released = false;
    const preview = createMutationPreviewer({
      pool: {
        connect: async () => ({
          query: async <T>(sql: string) => {
            calls.push(sql);
            if (sql.startsWith('DELETE')) return { rows: [] as T[], rowCount: 1 };
            if (sql.includes('FROM _ops.row_change_journal')) {
              return { rows: [{ operation: 'DELETE' }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release: () => {
            released = true;
          }
        })
      }
    });

    await expect(
      preview({
        executionId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        executionKey: 'SQL-20260822-preview',
        actorUserId: 'actor',
        actorSessionId: 'session',
        reason: 'Correct incorrect data.',
        sql: 'DELETE FROM public.students WHERE id = 1'
      })
    ).resolves.toMatchObject({ affectedRows: 1, changes: [{ operation: 'DELETE' }] });
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('ROLLBACK');
    expect(released).toBe(true);
  });
});
