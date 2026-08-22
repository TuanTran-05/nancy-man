import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

export function getOpsPool(
  databaseUrl: string,
  options: Omit<PoolConfig, 'connectionString'> = {}
): Pool {
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error('Ops database URL must use PostgreSQL');
  }

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    ...options
  });
}

export function getOpsDb(pool: Pool) {
  return drizzle({ client: pool, schema });
}
