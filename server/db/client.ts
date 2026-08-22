import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as relations from '../../db/drizzle/relations.js';
import * as schema from '../../db/drizzle/schema.js';

const relationalSchema = { ...schema, ...relations };

export type SqlDatabase = NodePgDatabase<typeof relationalSchema>;

let pool: Pool | undefined;
let database: SqlDatabase | undefined;

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function postgresSsl(raw: string | undefined): PoolConfig['ssl'] | undefined {
  if (!raw) return undefined;
  switch (raw.trim().toLowerCase()) {
    case 'disable':
    case 'false':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-full':
    case 'true':
      return { rejectUnauthorized: true };
    default:
      throw new Error('POSTGRES_SSL must be disable, require, or verify-full');
  }
}

export function readPostgresConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when PostgreSQL data access is enabled');
  }

  return {
    connectionString,
    max: boundedInteger(env.POSTGRES_POOL_MAX, 10, 'POSTGRES_POOL_MAX', 1, 50),
    idleTimeoutMillis: boundedInteger(
      env.POSTGRES_IDLE_TIMEOUT_MS,
      30_000,
      'POSTGRES_IDLE_TIMEOUT_MS',
      1_000,
      300_000
    ),
    connectionTimeoutMillis: boundedInteger(
      env.POSTGRES_CONNECT_TIMEOUT_MS,
      5_000,
      'POSTGRES_CONNECT_TIMEOUT_MS',
      500,
      60_000
    ),
    application_name: env.POSTGRES_APPLICATION_NAME?.trim() || 'edutrack-api',
    ssl: postgresSsl(env.POSTGRES_SSL),
  };
}

export function getPostgresPool(): Pool {
  pool ??= new Pool(readPostgresConfig());
  return pool;
}

export function getSqlDb(): SqlDatabase {
  database ??= drizzle({ client: getPostgresPool(), schema: relationalSchema });
  return database;
}

export async function checkSqlConnection(): Promise<{
  database: string;
  user: string;
  serverVersion: string;
}> {
  const result = await getPostgresPool().query<{
    database: string;
    user: string;
    server_version: string;
  }>('select current_database() as database, current_user as user, version() as server_version');
  const row = result.rows[0];
  if (!row) throw new Error('PostgreSQL health check returned no rows');
  return { database: row.database, user: row.user, serverVersion: row.server_version };
}

export async function closeSqlDb(): Promise<void> {
  const currentPool = pool;
  database = undefined;
  pool = undefined;
  if (currentPool) await currentPool.end();
}
