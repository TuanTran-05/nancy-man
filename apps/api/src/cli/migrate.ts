import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getOpsPool } from '../../../../packages/db/src/client.js';
import { migrateOpsDatabase } from '../../../../packages/db/src/migrate.js';
import {
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot
} from '../../../../packages/telemetry-sdk/src/oneShot.js';
import type { RuntimeTelemetry } from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';

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

export function runOpsDatabaseMigrationEntrypoint(
  input: {
    environment?: NodeJS.ProcessEnv;
    telemetry?: RuntimeTelemetry;
    run?: () => Promise<{ appliedMigrations: string[] }>;
    onFailure?: (error: unknown) => void | Promise<void>;
    rethrow?: boolean;
  } = {}
): Promise<{ appliedMigrations: string[] } | undefined> {
  const environment = input.environment ?? process.env;
  const common = {
    createTelemetry: () =>
      input.telemetry ??
      createOpsProcessRuntimeTelemetryFromEnvironment({
        environment,
        resolveHmacSecret: async (reference) => {
          const secretDirectory = environment.OPS_SECRET_DIRECTORY?.trim();
          if (!secretDirectory) throw new Error('OPS_SECRET_DIRECTORY is required');
          return new FileSecretResolver(secretDirectory).resolve(reference);
        },
        service: 'edutrack-ops-migrate',
        spoolName: 'migrate'
      }),
    failureContext: {
      code: 'OPS_DATABASE_MIGRATION_FAILED',
      source: 'database' as const,
      level: 'fatal' as const
    },
    run: input.run ?? (() => runOpsDatabaseMigrations(environment)),
    ...(input.onFailure ? { onFailure: input.onFailure } : {})
  };
  return input.rethrow === false
    ? runConfiguredOpsTelemetryOneShot({ ...common, rethrow: false })
    : runConfiguredOpsTelemetryOneShot({ ...common, rethrow: true });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void runOpsDatabaseMigrationEntrypoint({
    rethrow: false,
    run: async () => {
      const result = await runOpsDatabaseMigrations();
      process.stdout.write(`Applied ${result.appliedMigrations.length} Ops migrations\n`);
      return result;
    },
    onFailure: () => {
      process.stderr.write('Ops database migration failed\n');
      process.exitCode = 1;
    }
  });
}
