export type PostgresContractEnvironment = Record<string, string | undefined>;

function parseApprovedTarget(environment: PostgresContractEnvironment): string | null {
  const raw = environment.OPS_TEST_DATABASE_URL;
  if (!raw) return null;

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error('OPS_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (target.protocol !== 'postgres:' && target.protocol !== 'postgresql:')
    throw new Error('OPS_TEST_DATABASE_URL must use PostgreSQL');
  if (!new Set(['127.0.0.1', 'localhost', '[::1]']).has(target.hostname))
    throw new Error('OPS_TEST_DATABASE_URL must target a loopback host');
  if (target.search || target.hash)
    throw new Error('OPS_TEST_DATABASE_URL must not contain connection overrides');

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(target.pathname.slice(1));
  } catch {
    throw new Error('OPS_TEST_DATABASE_URL has an invalid database name');
  }
  if (
    databaseName.includes('/') ||
    !/(?:^|[_-])test(?:$|[_-])/iu.test(databaseName) ||
    /(?:^|[_-])(?:prod|production|live|runtime)(?:$|[_-])/iu.test(databaseName)
  )
    throw new Error('OPS_TEST_DATABASE_URL must name an unmistakable test database');

  const runtimeRaw = environment.OPS_MONITOR_DATABASE_URL;
  if (runtimeRaw) {
    let matchesRuntime = runtimeRaw === raw;
    try {
      matchesRuntime ||= new URL(runtimeRaw).href === target.href;
    } catch {
      // An invalid runtime value cannot authorize or identify a contract target.
    }
    if (matchesRuntime)
      throw new Error('OPS_TEST_DATABASE_URL must not match OPS_MONITOR_DATABASE_URL');
  }
  return raw;
}

export function createPostgresContractClient<T>(
  environment: PostgresContractEnvironment,
  factory: (connectionString: string) => T
): T | null {
  const connectionString = parseApprovedTarget(environment);
  return connectionString ? factory(connectionString) : null;
}
