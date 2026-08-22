import { describe, expect, it } from 'vitest';

import { migrateOpsDatabase } from './migrate.js';

const requiredTables = [
  'ops_users',
  'ops_password_credentials',
  'ops_mfa_factors',
  'ops_recovery_codes',
  'ops_sessions',
  'ops_login_events',
  'ops_elevation_events',
  'ops_audit_entries',
  'ops_audit_checkpoints',
  'service_heartbeats'
];

describe('Ops database migration runner', () => {
  it('creates every foundation table from an empty database', async () => {
    const executed: string[] = [];
    const applied = new Set<string>();

    const result = await migrateOpsDatabase({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        if (sql.includes('SELECT migration_id')) {
          return { rows: [...applied].map((migrationId) => ({ migrationId })) as T[] };
        }
        if (sql.includes('INSERT INTO ops_schema_migrations')) {
          applied.add(String(parameters[0]));
        }
        executed.push(sql);
        return { rows: [] as T[] };
      }
    });

    expect(result.appliedMigrations).toEqual(['0001_ops_foundation']);
    const migrationSql = executed.join('\n');
    for (const table of requiredTables) {
      expect(migrationSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
  });

  it('is idempotent when the migration is already recorded', async () => {
    const executed: string[] = [];

    const result = await migrateOpsDatabase({
      query: async <T>(sql: string) => {
        if (sql.includes('SELECT migration_id')) {
          return { rows: [{ migrationId: '0001_ops_foundation' }] as T[] };
        }
        executed.push(sql);
        return { rows: [] as T[] };
      }
    });

    expect(result.appliedMigrations).toEqual([]);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain('CREATE TABLE IF NOT EXISTS ops_schema_migrations');
  });
});
