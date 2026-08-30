import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getOpsPool } from '../../../../packages/db/src/client.js';
import { migrateOpsDatabase } from '../../../../packages/db/src/migrate.js';

import { FileSecretResolver } from '../runtime/fileSecretResolver.js';
import { readOpsRuntimeConfig } from '../runtime/runtimeConfig.js';

type MigrationDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};
type PinnedMigrationClient = {
  query: (sql: string, parameters?: unknown[]) => Promise<{ rows: unknown[] }>;
  release: () => void;
};
type MigrationPool = {
  connect: () => Promise<PinnedMigrationClient>;
};

export async function runMigrationsWithLock(input: {
  database: MigrationDatabase;
  migrate: (database: MigrationDatabase) => Promise<{ appliedMigrations: string[] }>;
}): Promise<{ appliedMigrations: string[] }> {
  await input.database.query('SELECT pg_advisory_lock(hashtext($1))', [
    'edutrack-ops-schema-migrations'
  ]);
  try {
    return await input.migrate(input.database);
  } finally {
    await input.database.query('SELECT pg_advisory_unlock(hashtext($1))', [
      'edutrack-ops-schema-migrations'
    ]);
  }
}

export async function runMigrationsWithPinnedConnection(input: {
  pool: MigrationPool;
  migrate: (database: MigrationDatabase) => Promise<{ appliedMigrations: string[] }>;
}): Promise<{ appliedMigrations: string[] }> {
  const client = await input.pool.connect();
  const database: MigrationDatabase = {
    query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      const result = await client.query(sql, [...parameters]);
      return { rows: result.rows as T[] };
    }
  };
  try {
    return await runMigrationsWithLock({ database, migrate: input.migrate });
  } finally {
    client.release();
  }
}

export async function runOpsDatabaseMigrations(
  environment: NodeJS.ProcessEnv = process.env
): Promise<{ appliedMigrations: string[] }> {
  const config = readOpsRuntimeConfig(environment);
  const databaseUrl = await new FileSecretResolver(config.secretDirectory).resolve(
    config.databaseUrlReference
  );
  if (!databaseUrl) throw new Error('Ops migration credential is unavailable');

  const pool = getOpsPool(databaseUrl);
  try {
    return await runMigrationsWithPinnedConnection({ pool, migrate: migrateOpsDatabase });
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void runOpsDatabaseMigrations()
    .then((result) =>
      process.stdout.write(`Applied ${result.appliedMigrations.length} Ops migrations\n`)
    )
    .catch(() => {
      process.stderr.write('Ops database migration failed\n');
      process.exitCode = 1;
    });
}
