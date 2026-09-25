import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string
  ) => Promise<{ rows: T[] }>;
};

export type ExplorerFixture = {
  schema: string;
  table: string;
  safeColumn: string;
  blockedColumn?: string;
};

type RolePosture = {
  role: string;
  database: string;
  canLogin: boolean;
  defaultTransactionReadOnly: string | null;
  hasExplorerMembership: boolean;
  isSuperuser: boolean;
  hasBypassRls: boolean;
  hasReplication: boolean;
  isMemberOfElevatedRole: boolean;
  hasTemporaryPrivilege: boolean;
  canAccessOpsSchema: boolean;
  sslSetting: string | null;
  hasDefaultPrivileges: boolean;
};

export type ExplorerRoleVerificationReport = {
  status: 'pass' | 'fail';
  checkedAt: string;
  roleDigest: string;
  databaseDigest: string;
  role: string;
  database: string;
  failures: string[];
  safeReads: Array<{ name: string; passed: boolean }>;
  prohibitedOperations: Array<{ name: string; rejected: boolean }>;
  blockedColumnChecks: Array<{ name: string; rejected: boolean }>;
};

const identifier = /^[a-z][a-z0-9_]{0,62}$/;

function quoteIdentifier(value: string): string {
  if (!identifier.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function fixtureRelation(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function rolePostureFailures(
  posture: RolePosture,
  options: { expectedDatabase?: string; expectedRole?: string; requireTls?: boolean }
): string[] {
  const failures: string[] = [];

  if (options.expectedDatabase && posture.database !== options.expectedDatabase) {
    failures.push(
      `connected database ${posture.database} does not match expected database ${options.expectedDatabase}`
    );
  }
  if (options.expectedRole && posture.role !== options.expectedRole) {
    failures.push(
      `connected role ${posture.role} does not match expected role ${options.expectedRole}`
    );
  }
  if (!posture.canLogin) {
    failures.push('current role is not a LOGIN role');
  }
  if (posture.defaultTransactionReadOnly !== 'on') {
    failures.push('default_transaction_read_only is not on');
  }
  if (!posture.hasExplorerMembership) {
    failures.push('login is not a member of ops_database_browser');
  }
  if (posture.isSuperuser) {
    failures.push('login is a superuser');
  }
  if (posture.hasBypassRls) {
    failures.push('login has BYPASSRLS');
  }
  if (posture.hasReplication) {
    failures.push('login has replication');
  }
  if (posture.isMemberOfElevatedRole) {
    failures.push('login is a member of an elevated role');
  }
  if (posture.hasTemporaryPrivilege) {
    failures.push('login has TEMPORARY database privilege');
  }
  if (posture.canAccessOpsSchema) {
    failures.push('login can use the _ops schema');
  }
  if (options.requireTls && posture.sslSetting !== 'on') {
    failures.push('TLS is required but not active');
  }
  if (posture.hasDefaultPrivileges) {
    failures.push('default privileges grant table access to ops_database_browser');
  }

  return failures;
}

async function readPosture(database: Queryable): Promise<RolePosture> {
  const { rows } = await database.query<Record<string, unknown>>(`
    SELECT
      current_user AS role,
      current_database() AS database,
      (SELECT rolcanlogin FROM pg_roles WHERE rolname = current_user) AS "canLogin",
      current_setting('default_transaction_read_only', true) AS "defaultTransactionReadOnly",
      pg_has_role(current_user, 'ops_database_browser', 'member') AS "hasExplorerMembership",
      current_setting('is_superuser', true) = 'on' AS "isSuperuser",
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS "hasBypassRls",
      (SELECT rolreplication FROM pg_roles WHERE rolname = current_user) AS "hasReplication",
      EXISTS (
        SELECT 1
        FROM pg_roles candidate
        WHERE pg_has_role(current_user, candidate.oid, 'member')
          AND (candidate.rolsuper OR candidate.rolcreaterole OR candidate.rolcreatedb OR candidate.rolreplication OR candidate.rolbypassrls)
      ) AS "isMemberOfElevatedRole",
      has_database_privilege(current_user, current_database(), 'TEMPORARY') AS "hasTemporaryPrivilege",
      CASE WHEN to_regnamespace('_ops') IS NULL THEN false ELSE has_schema_privilege(current_user, '_ops', 'USAGE') END AS "canAccessOpsSchema",
      current_setting('ssl', true) AS "sslSetting",
      EXISTS (
        SELECT 1 FROM pg_default_acl def
        JOIN pg_roles r ON r.oid = def.defaclrole
        WHERE def.defaclacl::text LIKE '%ops_database_browser%'
      ) AS "hasDefaultPrivileges"
  `);

  if (rows.length !== 1) {
    throw new Error('Role posture query returned no result');
  }
  const row = rows[0];
  return {
    role: String(row.role),
    database: String(row.database),
    canLogin: normalizeBoolean(row.canLogin),
    defaultTransactionReadOnly:
      row.defaultTransactionReadOnly == null ? null : String(row.defaultTransactionReadOnly),
    hasExplorerMembership: normalizeBoolean(row.hasExplorerMembership),
    isSuperuser: normalizeBoolean(row.isSuperuser),
    hasBypassRls: normalizeBoolean(row.hasBypassRls),
    hasReplication: normalizeBoolean(row.hasReplication),
    isMemberOfElevatedRole: normalizeBoolean(row.isMemberOfElevatedRole),
    hasTemporaryPrivilege: normalizeBoolean(row.hasTemporaryPrivilege),
    canAccessOpsSchema: normalizeBoolean(row.canAccessOpsSchema),
    sslSetting: row.sslSetting == null ? null : String(row.sslSetting),
    hasDefaultPrivileges: normalizeBoolean(row.hasDefaultPrivileges)
  };
}

async function queryPasses(database: Queryable, sql: string): Promise<boolean> {
  try {
    await database.query(sql);
    return true;
  } catch {
    return false;
  }
}

async function queryIsRejected(database: Queryable, sql: string): Promise<boolean> {
  await database.query('BEGIN');
  try {
    await database.query(sql);
    await database.query('ROLLBACK');
    return false;
  } catch {
    await database.query('ROLLBACK');
    return true;
  }
}

export async function verifyDatabaseExplorerRole(input: {
  database: Queryable;
  fixture: ExplorerFixture;
  expectedDatabase?: string;
  expectedRole?: string;
  requireTls?: boolean;
  now?: () => Date;
}): Promise<ExplorerRoleVerificationReport> {
  const relation = fixtureRelation(input.fixture.schema, input.fixture.table);
  const safeColumn = quoteIdentifier(input.fixture.safeColumn);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const probeName = quoteIdentifier(`ops_explorer_probe_${suffix}`);

  const safeReads = [
    { name: 'simple SELECT', sql: 'SELECT 1' },
    {
      name: 'catalog read',
      sql: 'SELECT nspname FROM pg_catalog.pg_namespace ORDER BY nspname LIMIT 1'
    },
    {
      name: 'safe column read',
      sql: `SELECT ${safeColumn} FROM ${relation} LIMIT 1`
    }
  ];

  const prohibitedStatements = [
    { name: 'INSERT', sql: `INSERT INTO ${relation} SELECT * FROM ${relation} LIMIT 0` },
    { name: 'UPDATE', sql: `UPDATE ${relation} SET ${safeColumn} = ${safeColumn} WHERE false` },
    { name: 'DELETE', sql: `DELETE FROM ${relation} WHERE false` },
    { name: 'TRUNCATE', sql: `TRUNCATE ${relation}` },
    {
      name: 'CREATE TABLE',
      sql: `CREATE TABLE ${fixtureRelation(input.fixture.schema, `ops_explorer_probe_${suffix}`)} (id integer)`
    },
    { name: 'CREATE TEMP TABLE', sql: `CREATE TEMP TABLE ${probeName} (id integer)` },
    { name: 'ALTER TABLE', sql: `ALTER TABLE ${relation} ADD COLUMN ${probeName} integer` },
    { name: 'DROP TABLE', sql: `DROP TABLE ${relation}` },
    {
      name: 'CREATE FUNCTION',
      sql: `CREATE FUNCTION ${quoteIdentifier(input.fixture.schema)}.${probeName}() RETURNS integer LANGUAGE sql AS 'SELECT 1'`
    },
    { name: 'COPY TO PROGRAM', sql: `COPY ${relation} TO PROGRAM 'echo 1'` },
    { name: 'SET ROLE', sql: 'SET ROLE ops_database_browser' }
  ];

  const posture = await readPosture(input.database);

  const safeReadResults: Array<{ name: string; passed: boolean }> = [];
  for (const { name, sql } of safeReads) {
    safeReadResults.push({ name, passed: await queryPasses(input.database, sql) });
  }

  const prohibitedResults: Array<{ name: string; rejected: boolean }> = [];
  for (const { name, sql } of prohibitedStatements) {
    prohibitedResults.push({ name, rejected: await queryIsRejected(input.database, sql) });
  }

  const blockedColumnChecks: Array<{ name: string; rejected: boolean }> = [];
  if (input.fixture.blockedColumn) {
    const blockedColQuoted = quoteIdentifier(input.fixture.blockedColumn);
    const sql = `SELECT ${blockedColQuoted} FROM ${relation} LIMIT 1`;
    const rejected = await queryIsRejected(input.database, sql);
    blockedColumnChecks.push({ name: input.fixture.blockedColumn, rejected });
  }

  const failures = rolePostureFailures(posture, {
    expectedDatabase: input.expectedDatabase,
    expectedRole: input.expectedRole,
    requireTls: input.requireTls
  });

  for (const read of safeReadResults) {
    if (!read.passed) {
      failures.push(`required safe read failed: ${read.name}`);
    }
  }

  for (const op of prohibitedResults) {
    if (!op.rejected) {
      failures.push(`prohibited operation succeeded: ${op.name}`);
    }
  }

  for (const b of blockedColumnChecks) {
    if (!b.rejected) {
      failures.push(`blocked column read succeeded: ${b.name}`);
    }
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    roleDigest: digest(posture.role),
    databaseDigest: digest(posture.database),
    role: posture.role,
    database: posture.database,
    failures,
    safeReads: safeReadResults,
    prohibitedOperations: prohibitedResults,
    blockedColumnChecks
  };
}

function parseArguments(argumentsList: readonly string[]): {
  databaseUrlFile: string;
  fixture: ExplorerFixture;
  expectedDatabase?: string;
  expectedRole?: string;
  requireTls?: boolean;
} {
  const values = new Map<string, string>();
  let requireTls = false;

  for (let index = 0; index < argumentsList.length; index++) {
    const flag = argumentsList[index];
    if (flag === '--require-tls') {
      requireTls = true;
      continue;
    }
    if (flag?.startsWith('--')) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Expected value after flag ${flag}`);
      }
      values.set(flag, value);
      index++;
    }
  }

  const databaseUrlFile = values.get('--database-url-file');
  const fixtureValue = values.get('--fixture');
  const safeColumn = values.get('--safe-column');
  const blockedColumn = values.get('--blocked-column');

  if (!databaseUrlFile || !fixtureValue || !safeColumn) {
    throw new Error('Expected --database-url-file, --fixture and --safe-column');
  }

  const [schema, table, extra] = fixtureValue.split('.');
  if (
    !schema ||
    !table ||
    extra ||
    !identifier.test(schema) ||
    !identifier.test(table) ||
    !identifier.test(safeColumn)
  ) {
    throw new Error('Fixture must use lower-case schema.table and a lower-case safe column');
  }

  if (blockedColumn && !identifier.test(blockedColumn)) {
    throw new Error('Blocked column must be a lower-case PostgreSQL identifier');
  }

  const expectedDatabase = values.get('--expected-database');
  if (expectedDatabase && !identifier.test(expectedDatabase)) {
    throw new Error('Expected database must be a lower-case PostgreSQL identifier');
  }

  const expectedRole = values.get('--expected-role');
  if (expectedRole && !identifier.test(expectedRole)) {
    throw new Error('Expected role must be a lower-case PostgreSQL identifier');
  }

  return {
    databaseUrlFile,
    fixture: {
      schema,
      table,
      safeColumn,
      blockedColumn: blockedColumn || undefined
    },
    expectedDatabase,
    expectedRole,
    requireTls
  };
}

async function readMode0600File(path: string): Promise<string> {
  const metadata = await stat(path);
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error('Credential file mode must be 0600');
  }
  const value = (await readFile(path, 'utf8')).trim();
  if (!value.startsWith('postgres://') && !value.startsWith('postgresql://')) {
    throw new Error('Read login credential file must contain a PostgreSQL URL');
  }
  return value;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const connectionString = await readMode0600File(options.databaseUrlFile);
  const pg = await import('pg');
  const database = new pg.Client({ connectionString });
  await database.connect();
  try {
    const report = await verifyDatabaseExplorerRole({
      database,
      fixture: options.fixture,
      expectedDatabase: options.expectedDatabase,
      expectedRole: options.expectedRole,
      requireTls: options.requireTls
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.status !== 'pass') {
      process.exitCode = 2;
    }
  } finally {
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'role verification failed';
    process.stderr.write(`verify-database-explorer-role: ${message}\n`);
    process.exitCode = 2;
  });
}
