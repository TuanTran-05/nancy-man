import { describe, expect, it } from 'vitest';

import { runMigrationsWithLock, runMigrationsWithPinnedConnection } from './migrate.js';

function createDatabase() {
  let locked = false;
  let released = false;

  return {
    state: () => ({ locked, released }),
    query: async <T>(sql: string) => {
      if (sql.includes('pg_advisory_lock')) locked = true;
      if (sql.includes('pg_advisory_unlock')) released = true;
      return { rows: [] as T[] };
    }
  };
}

describe('runMigrationsWithLock', () => {
  it('holds the Ops schema lock only for the explicit migration command', async () => {
    const database = createDatabase();

    await expect(
      runMigrationsWithLock({
        database,
        migrate: async () => ({ appliedMigrations: ['0008_ingest_rate_limits'] })
      })
    ).resolves.toEqual({ appliedMigrations: ['0008_ingest_rate_limits'] });
    expect(database.state()).toEqual({ locked: true, released: true });
  });

  it('releases the schema lock even when a migration fails', async () => {
    const database = createDatabase();

    await expect(
      runMigrationsWithLock({
        database,
        migrate: async () => {
          throw new Error('migration failed');
        }
      })
    ).rejects.toThrow('migration failed');
    expect(database.state()).toEqual({ locked: true, released: true });
  });

  it('pins advisory locking and migration queries to one checked-out PostgreSQL client', async () => {
    const queries: string[] = [];
    let released = false;
    const client = {
      query: async <T>(sql: string) => {
        queries.push(sql);
        return { rows: [] as T[] };
      },
      release: () => {
        released = true;
      }
    };
    const pool = {
      connect: async () => client
    };

    await expect(
      runMigrationsWithPinnedConnection({
        pool,
        migrate: async (database) => {
          expect(database).not.toBe(pool);
          await database.query('BEGIN');
          await database.query('canonical migration SQL');
          await database.query('INSERT migration checksum');
          await database.query('COMMIT');
          return { appliedMigrations: ['0001_ops_foundation'] };
        }
      })
    ).resolves.toEqual({ appliedMigrations: ['0001_ops_foundation'] });

    expect(queries).toEqual([
      'SELECT pg_advisory_lock(hashtext($1))',
      'BEGIN',
      'canonical migration SQL',
      'INSERT migration checksum',
      'COMMIT',
      'SELECT pg_advisory_unlock(hashtext($1))'
    ]);
    expect(released).toBe(true);
  });

  it('releases the checked-out client if the migration fails', async () => {
    let released = false;
    const client = {
      query: async <T>() => ({ rows: [] as T[] }),
      release: () => {
        released = true;
      }
    };

    await expect(
      runMigrationsWithPinnedConnection({
        pool: { connect: async () => client },
        migrate: async () => {
          throw new Error('migration failed');
        }
      })
    ).rejects.toThrow('migration failed');

    expect(released).toBe(true);
  });
});
