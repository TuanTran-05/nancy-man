import { describe, expect, it } from 'vitest';

import { createPoolDatabase } from './poolDatabase.js';

function createPool() {
  const calls: string[] = [];
  const client = {
    query: async <T>(sql: string) => {
      calls.push(sql);
      return { rows: [{ value: 'transaction-result' }] as T[] };
    },
    release: () => calls.push('release')
  };
  return {
    calls,
    pool: {
      query: async <T>(sql: string) => {
        calls.push(`pool:${sql}`);
        return { rows: [] as T[] };
      },
      connect: async () => client
    }
  };
}

describe('createPoolDatabase', () => {
  it('runs every ingest write on one checked-out client and releases it after commit', async () => {
    const { pool, calls } = createPool();
    const database = createPoolDatabase(pool);

    await expect(
      database.transaction(async (transaction) => {
        const result = await transaction.query<{ value: string }>('INSERT INTO ingest_envelopes');
        return result.rows[0]?.value;
      })
    ).resolves.toBe('transaction-result');
    expect(calls).toEqual(['BEGIN', 'INSERT INTO ingest_envelopes', 'COMMIT', 'release']);
  });

  it('rolls back and releases the checked-out client when an ingest write fails', async () => {
    const { pool, calls } = createPool();
    const database = createPoolDatabase(pool);

    await expect(
      database.transaction(async () => {
        throw new Error('write failed');
      })
    ).rejects.toThrow('write failed');
    expect(calls).toEqual(['BEGIN', 'ROLLBACK', 'release']);
  });
});
