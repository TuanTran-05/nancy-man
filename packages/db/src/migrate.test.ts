import { describe, expect, it } from 'vitest';

import { opsMigrationManifest } from './migrationManifest.js';
import { migrateOpsDatabase } from './migrate.js';

const requiredTables = [
  'ops_users',
  'ops_password_credentials',
  'ops_mfa_factors',
  'ops_recovery_codes',
  'ops_sessions',
  'ops_login_events',
  'ops_elevation_events',
  'ops_sql_elevations',
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

    expect(result.appliedMigrations).toEqual([
      '0001_ops_foundation',
      '0002_error_operations',
      '0003_ingest_processing_state',
      '0004_error_source_extensions',
      '0005_error_issue_affected_users',
      '0006_release_publishers',
      '0007_ingest_nonces',
      '0008_ingest_rate_limits',
      '0009_alert_delivery_outbox',
      '0010_ops_login_challenges',
      '0011_ops_mfa_enrollment_tokens',
      '0012_sql_execution_audit',
      '0013_sql_session_elevations',
      '0014_ops_account_administration',
      '0015_ops_secret_elevations',
      '0016_ops_secret_elevation_reuse',
      '0017_ops_config_changes'
    ]);
    const migrationSql = executed.join('\n');
    for (const table of requiredTables) {
      expect(migrationSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS ingest_envelopes/);
  });

  it('is idempotent when the migration is already recorded', async () => {
    const executed: string[] = [];

    const result = await migrateOpsDatabase({
      query: async <T>(sql: string) => {
        if (sql.includes('SELECT migration_id')) {
          return {
            rows: opsMigrationManifest.map(({ id: migrationId, checksum }) => ({
              migrationId,
              checksum
            })) as T[]
          };
        }
        executed.push(sql);
        return { rows: [] as T[] };
      }
    });

    expect(result.appliedMigrations).toEqual([]);
    expect(executed).toHaveLength(3);
    expect(executed[0]).toContain('CREATE TABLE IF NOT EXISTS ops_schema_migrations');
    expect(executed).toContain(
      'ALTER TABLE ops_schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)'
    );
    expect(executed).toContain(
      'ALTER TABLE ops_schema_migrations ALTER COLUMN checksum SET NOT NULL'
    );
  });

  it('rejects an applied migration whose recorded checksum differs before migration SQL runs', async () => {
    const executed: string[] = [];

    await expect(
      migrateOpsDatabase({
        query: async <T>(sql: string) => {
          if (sql.includes('SELECT migration_id')) {
            return {
              rows: [{ migrationId: '0001_ops_foundation', checksum: '0'.repeat(64) }] as T[]
            };
          }
          executed.push(sql);
          return { rows: [] as T[] };
        }
      })
    ).rejects.toThrow('OPS_MIGRATION_CHECKSUM_MISMATCH:0001_ops_foundation');

    expect(executed.join('\n')).not.toContain('CREATE TABLE IF NOT EXISTS ops_users');
  });

  it('rejects an unknown applied migration before migration SQL runs', async () => {
    const executed: string[] = [];

    await expect(
      migrateOpsDatabase({
        query: async <T>(sql: string) => {
          if (sql.includes('SELECT migration_id')) {
            return {
              rows: [{ migrationId: '9999_unknown_history', checksum: '0'.repeat(64) }] as T[]
            };
          }
          executed.push(sql);
          return { rows: [] as T[] };
        }
      })
    ).rejects.toThrow('OPS_MIGRATION_UNKNOWN_APPLIED_ID:9999_unknown_history');

    expect(executed.join('\n')).not.toContain('CREATE TABLE IF NOT EXISTS ops_users');
  });

  it('backfills a null checksum only for a recognized applied migration', async () => {
    const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];

    await migrateOpsDatabase({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        queries.push({ sql, parameters });
        if (sql.includes('SELECT migration_id')) {
          return {
            rows: [{ migrationId: '0001_ops_foundation', checksum: null }] as T[]
          };
        }
        return { rows: [] as T[] };
      }
    });

    expect(queries).toContainEqual({
      sql: 'UPDATE ops_schema_migrations SET checksum = $2 WHERE migration_id = $1 AND checksum IS NULL',
      parameters: [
        '0001_ops_foundation',
        '0e303858d2091d0f1375d2ee211062091919b8365b8e1a075173b959a780e942'
      ]
    });
    expect(queries.map((query) => query.sql)).toContain(
      'ALTER TABLE ops_schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)'
    );
    expect(queries.map((query) => query.sql)).toContain(
      'ALTER TABLE ops_schema_migrations ALTER COLUMN checksum SET NOT NULL'
    );
  });

  it('rejects a missing predecessor before executing any new migration SQL', async () => {
    const executed: string[] = [];

    await expect(
      migrateOpsDatabase({
        query: async <T>(sql: string) => {
          if (sql.includes('SELECT migration_id')) {
            return {
              rows: [
                {
                  migrationId: '0002_error_operations',
                  checksum: '1df63ed69d64e3b3449dcb1c404ffd6abae18d92a1178759aa73772c410a1619'
                }
              ] as T[]
            };
          }
          executed.push(sql);
          return { rows: [] as T[] };
        }
      })
    ).rejects.toThrow('OPS_MIGRATION_PREDECESSOR_MISSING:0001_ops_foundation');

    expect(executed.join('\n')).not.toContain('CREATE TABLE IF NOT EXISTS ops_users');
  });

  it('commits each new migration SQL and its checksum record in one transaction', async () => {
    const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];

    await migrateOpsDatabase({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        queries.push({ sql, parameters });
        if (sql.includes('SELECT migration_id')) return { rows: [] as T[] };
        return { rows: [] as T[] };
      }
    });

    const firstMigrationSql = queries.findIndex((query) =>
      query.sql.includes('CREATE TABLE IF NOT EXISTS ops_users')
    );
    expect(queries[firstMigrationSql - 1]).toEqual({ sql: 'BEGIN', parameters: [] });
    expect(queries[firstMigrationSql + 1]).toEqual({
      sql: 'INSERT INTO ops_schema_migrations (migration_id, checksum) VALUES ($1, $2)',
      parameters: [
        '0001_ops_foundation',
        '0e303858d2091d0f1375d2ee211062091919b8365b8e1a075173b959a780e942'
      ]
    });
    expect(queries[firstMigrationSql + 2]).toEqual({ sql: 'COMMIT', parameters: [] });
  });
});
