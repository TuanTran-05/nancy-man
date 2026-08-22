import { describe, expect, it } from 'vitest';

import { runMigrationsWithLock } from './migrate.js';

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
});
