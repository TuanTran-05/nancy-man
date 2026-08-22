import { executeReadOnly } from '../execution/readExecution.js';

type QueryDatabase = {
  query: <T>(sql: string) => Promise<{ rows: T[] }>;
};

type ReadConnection = QueryDatabase & { release: () => void };

type ReadPool = {
  connect: () => Promise<ReadConnection>;
};

type ReadIdentity = {
  role: string;
  database: string;
  defaultTransactionReadOnly: string | null;
};

export function assertTlsProtectedPostgresUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Production read database URL must use PostgreSQL with TLS verify-full');
  }
  if (
    (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') ||
    parsed.searchParams.get('sslmode')?.toLowerCase() !== 'verify-full'
  ) {
    throw new Error('Production read database URL must use TLS verify-full');
  }
}

export async function assertProductionReadIdentity(input: {
  database: QueryDatabase;
  expectedRole: string;
  expectedDatabase: string;
}): Promise<{ role: string; database: string }> {
  const { rows } = await input.database.query<ReadIdentity>(
    'SELECT current_user::text AS "role", current_database()::text AS "database", current_setting(\'default_transaction_read_only\', true) AS "defaultTransactionReadOnly"'
  );
  const identity = rows[0];
  if (
    !identity ||
    identity.role !== input.expectedRole ||
    identity.database !== input.expectedDatabase ||
    identity.defaultTransactionReadOnly !== 'on'
  ) {
    throw new Error('Production read connection identity is not read-only');
  }
  return { role: identity.role, database: identity.database };
}

export function createReadPreviewer(input: {
  pool: ReadPool;
}): (input: { sql: string; maxRows?: number }) => Promise<{ rows: unknown[]; truncated: boolean }> {
  return async ({ sql, maxRows }) => {
    const connection = await input.pool.connect();
    try {
      return await executeReadOnly({
        sql,
        ...(maxRows === undefined ? {} : { maxRows }),
        database: connection
      });
    } finally {
      connection.release();
    }
  };
}
