export type PostgresContractEnvironment = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function normalizedHostname(target: URL): string {
  const hostname = target.hostname.toLowerCase();
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
}

function decodedDatabaseName(target: URL): string | null {
  try {
    return decodeURIComponent(target.pathname.slice(1));
  } catch {
    return null;
  }
}

function canonicalResourceIdentity(target: URL): string | null {
  if (target.protocol !== 'postgres:' && target.protocol !== 'postgresql:') return null;
  const hostname = normalizedHostname(target);
  const host = LOOPBACK_HOSTS.has(hostname) ? 'loopback' : hostname;
  const databaseName = decodedDatabaseName(target);
  if (databaseName === null) return null;
  return JSON.stringify([host, target.port || '5432', databaseName]);
}

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
  if (!LOOPBACK_HOSTS.has(normalizedHostname(target)))
    throw new Error('OPS_TEST_DATABASE_URL must target a loopback host');
  if (target.search || target.hash)
    throw new Error('OPS_TEST_DATABASE_URL must not contain connection overrides');

  const databaseName = decodedDatabaseName(target);
  if (databaseName === null) throw new Error('OPS_TEST_DATABASE_URL has an invalid database name');
  if (
    databaseName.includes('/') ||
    !/(?:^|[_-])test(?:$|[_-])/iu.test(databaseName) ||
    /(?:^|[_-])(?:prod|production|live|runtime)(?:$|[_-])/iu.test(databaseName)
  )
    throw new Error('OPS_TEST_DATABASE_URL must name an unmistakable test database');

  const runtimeRaw = environment.OPS_MONITOR_DATABASE_URL;
  if (runtimeRaw) {
    try {
      const runtimeTarget = new URL(runtimeRaw);
      if (runtimeTarget.search || runtimeTarget.hash) return null;
      if (decodedDatabaseName(runtimeTarget) === databaseName) return null;
      if (canonicalResourceIdentity(runtimeTarget) === canonicalResourceIdentity(target))
        return null;
    } catch {
      // An invalid runtime value cannot authorize or identify a contract target.
    }
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
