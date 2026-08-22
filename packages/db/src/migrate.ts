import { readFileSync } from 'node:fs';

export type QueryResult<T> = { rows: T[] };

export type MigrationDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<QueryResult<T>>;
};

type Migration = {
  id: string;
  sql: string;
};

const migrations: readonly Migration[] = [
  {
    id: '0001_ops_foundation',
    sql: readFileSync(new URL('../migrations/0001_ops_foundation.sql', import.meta.url), 'utf8')
  },
  {
    id: '0002_error_operations',
    sql: readFileSync(new URL('../migrations/0002_error_operations.sql', import.meta.url), 'utf8')
  },
  {
    id: '0003_ingest_processing_state',
    sql: readFileSync(
      new URL('../migrations/0003_ingest_processing_state.sql', import.meta.url),
      'utf8'
    )
  },
  {
    id: '0004_error_source_extensions',
    sql: readFileSync(
      new URL('../migrations/0004_error_source_extensions.sql', import.meta.url),
      'utf8'
    )
  },
  {
    id: '0005_error_issue_affected_users',
    sql: readFileSync(
      new URL('../migrations/0005_error_issue_affected_users.sql', import.meta.url),
      'utf8'
    )
  },
  {
    id: '0006_release_publishers',
    sql: readFileSync(new URL('../migrations/0006_release_publishers.sql', import.meta.url), 'utf8')
  },
  {
    id: '0007_ingest_nonces',
    sql: readFileSync(new URL('../migrations/0007_ingest_nonces.sql', import.meta.url), 'utf8')
  },
  {
    id: '0008_ingest_rate_limits',
    sql: readFileSync(new URL('../migrations/0008_ingest_rate_limits.sql', import.meta.url), 'utf8')
  },
  {
    id: '0009_alert_delivery_outbox',
    sql: readFileSync(
      new URL('../migrations/0009_alert_delivery_outbox.sql', import.meta.url),
      'utf8'
    )
  }
];

export async function migrateOpsDatabase(
  database: MigrationDatabase
): Promise<{ appliedMigrations: string[] }> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ops_schema_migrations (
      migration_id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows: appliedRows } = await database.query<{ migrationId: string }>(
    'SELECT migration_id AS "migrationId" FROM ops_schema_migrations ORDER BY migration_id'
  );
  const alreadyApplied = new Set(appliedRows.map((row) => row.migrationId));
  const appliedMigrations: string[] = [];

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.id)) {
      continue;
    }

    await database.query(migration.sql);
    await database.query('INSERT INTO ops_schema_migrations (migration_id) VALUES ($1)', [
      migration.id
    ]);
    appliedMigrations.push(migration.id);
  }

  return { appliedMigrations };
}
