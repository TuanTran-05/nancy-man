import { opsMigrationManifest } from './migrationManifest.js';

export type QueryResult<T> = { rows: T[] };

export type MigrationDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<QueryResult<T>>;
};

type AppliedMigration = {
  migrationId: string;
  checksum?: string | null;
};

const migrationById = new Map(opsMigrationManifest.map((migration) => [migration.id, migration]));

function validateAppliedMigrations(appliedRows: readonly AppliedMigration[]): Set<string> {
  const appliedMigrationIds = new Set<string>();

  for (const applied of appliedRows) {
    const migration = migrationById.get(applied.migrationId);
    if (!migration) {
      throw new Error(`OPS_MIGRATION_UNKNOWN_APPLIED_ID:${applied.migrationId}`);
    }
    if (applied.checksum != null && applied.checksum !== migration.checksum) {
      throw new Error(`OPS_MIGRATION_CHECKSUM_MISMATCH:${migration.id}`);
    }
    appliedMigrationIds.add(migration.id);
  }

  for (const [index, migration] of opsMigrationManifest.entries()) {
    if (appliedMigrationIds.has(migration.id)) continue;
    if (opsMigrationManifest.slice(index + 1).some((later) => appliedMigrationIds.has(later.id))) {
      throw new Error(`OPS_MIGRATION_PREDECESSOR_MISSING:${migration.id}`);
    }
  }

  return appliedMigrationIds;
}

async function applyMigration(
  database: MigrationDatabase,
  migration: (typeof opsMigrationManifest)[number]
) {
  await database.query('BEGIN');
  try {
    await database.query(migration.sql);
    await database.query(
      'INSERT INTO ops_schema_migrations (migration_id, checksum) VALUES ($1, $2)',
      [migration.id, migration.checksum]
    );
    await database.query('COMMIT');
  } catch (error) {
    try {
      await database.query('ROLLBACK');
    } catch {
      // Preserve the original migration failure after a best-effort rollback.
    }
    throw error;
  }
}

export async function migrateOpsDatabase(
  database: MigrationDatabase
): Promise<{ appliedMigrations: string[] }> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ops_schema_migrations (
      migration_id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum char(64)
    )
  `);
  await database.query(
    'ALTER TABLE ops_schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)'
  );

  const { rows: appliedRows } = await database.query<AppliedMigration>(
    'SELECT migration_id AS "migrationId", checksum FROM ops_schema_migrations ORDER BY migration_id'
  );
  const alreadyApplied = validateAppliedMigrations(appliedRows);

  for (const applied of appliedRows) {
    if (applied.checksum != null) continue;
    const migration = migrationById.get(applied.migrationId)!;
    await database.query(
      'UPDATE ops_schema_migrations SET checksum = $2 WHERE migration_id = $1 AND checksum IS NULL',
      [migration.id, migration.checksum]
    );
  }

  await database.query('ALTER TABLE ops_schema_migrations ALTER COLUMN checksum SET NOT NULL');

  const appliedMigrations: string[] = [];
  for (const migration of opsMigrationManifest) {
    if (alreadyApplied.has(migration.id)) continue;
    await applyMigration(database, migration);
    appliedMigrations.push(migration.id);
  }

  return { appliedMigrations };
}
