import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string
  ) => Promise<{ rows: T[] }>;
};

type Fixture = { schema: string; table: string; column: string };

type RolePosture = {
  role: string;
  database: string;
  defaultTransactionReadOnly: string | null;
  hasReadonlyMembership: boolean;
  isSuperuser: boolean;
  hasBypassRls: boolean;
  hasReplication: boolean;
  isMemberOfElevatedRole: boolean;
  hasTemporaryPrivilege: boolean;
  canAccessOpsSchema: boolean;
  canAccessOpsTables: boolean;
  canAccessOpsFunctions: boolean;
  canSetCancelRole: boolean;
};

export type ReadonlyRoleVerificationReport = {
  status: 'pass' | 'fail';
  checkedAt: string;
  role: string;
  database: string;
  failures: string[];
  reads: Array<{ name: string; passed: boolean }>;
  prohibitedOperations: Array<{ name: string; rejected: boolean }>;
};

const identifier = /^[a-z][a-z0-9_]{0,62}$/;

function quoteIdentifier(value: string): string {
  if (!identifier.test(value)) throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  return `"${value}"`;
}

function fixtureRelation(fixture: Fixture): string {
  return `${quoteIdentifier(fixture.schema)}.${quoteIdentifier(fixture.table)}`;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

function rolePostureFailures(posture: RolePosture, expectedDatabase?: string): string[] {
  const failures: string[] = [];
  if (expectedDatabase && posture.database !== expectedDatabase) {
    failures.push(
      `connected database ${posture.database} does not match expected database ${expectedDatabase}`
    );
  }
  if (posture.defaultTransactionReadOnly !== 'on') {
    failures.push('default_transaction_read_only is not on');
  }
  if (!posture.hasReadonlyMembership) failures.push('login is not a member of ops_readonly');
  if (posture.isSuperuser) failures.push('login is a superuser');
  if (posture.hasBypassRls) failures.push('login has BYPASSRLS');
  if (posture.hasReplication) failures.push('login has replication');
  if (posture.isMemberOfElevatedRole) failures.push('login is a member of an elevated role');
  if (posture.hasTemporaryPrivilege) failures.push('login has TEMPORARY database privilege');
  if (posture.canAccessOpsSchema) failures.push('login can use the _ops schema');
  if (posture.canAccessOpsTables) failures.push('login can read _ops tables');
  if (posture.canAccessOpsFunctions) failures.push('login can execute _ops functions');
  if (posture.canSetCancelRole) failures.push('login can SET ROLE ops_cancel');
  return failures;
}

async function readPosture(database: Queryable): Promise<RolePosture> {
  const { rows } = await database.query<RolePosture>(`
    SELECT
      current_user AS role,
      current_database() AS database,
      current_setting('default_transaction_read_only', true) AS "defaultTransactionReadOnly",
      pg_has_role(current_user, 'ops_readonly', 'member') AS "hasReadonlyMembership",
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
      EXISTS (
        SELECT 1
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = '_ops'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege(current_user, relation.oid, 'SELECT')
      ) AS "canAccessOpsTables",
      EXISTS (
        SELECT 1
        FROM pg_proc procedure
        JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = '_ops'
          AND has_function_privilege(current_user, procedure.oid, 'EXECUTE')
      ) AS "canAccessOpsFunctions",
      pg_has_role(current_user, 'ops_cancel', 'set') AS "canSetCancelRole"
  `);
  if (rows.length !== 1) throw new Error('Role posture query returned no result');
  const row = rows[0];
  return {
    role: String(row.role),
    database: String(row.database),
    defaultTransactionReadOnly:
      row.defaultTransactionReadOnly == null ? null : String(row.defaultTransactionReadOnly),
    hasReadonlyMembership: normalizeBoolean(row.hasReadonlyMembership),
    isSuperuser: normalizeBoolean(row.isSuperuser),
    hasBypassRls: normalizeBoolean(row.hasBypassRls),
    hasReplication: normalizeBoolean(row.hasReplication),
    isMemberOfElevatedRole: normalizeBoolean(row.isMemberOfElevatedRole),
    hasTemporaryPrivilege: normalizeBoolean(row.hasTemporaryPrivilege),
    canAccessOpsSchema: normalizeBoolean(row.canAccessOpsSchema),
    canAccessOpsTables: normalizeBoolean(row.canAccessOpsTables),
    canAccessOpsFunctions: normalizeBoolean(row.canAccessOpsFunctions),
    canSetCancelRole: normalizeBoolean(row.canSetCancelRole)
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

export async function verifyReadonlyRole(input: {
  database: Queryable;
  fixture: Fixture;
  expectedDatabase?: string;
  now?: () => Date;
}): Promise<ReadonlyRoleVerificationReport> {
  const relation = fixtureRelation(input.fixture);
  const column = quoteIdentifier(input.fixture.column);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const probeName = quoteIdentifier(`ops_readonly_probe_${suffix}`);
  const reads = [
    { name: 'simple SELECT', sql: 'SELECT 1' },
    {
      name: 'catalog read',
      sql: 'SELECT nspname FROM pg_catalog.pg_namespace ORDER BY nspname LIMIT 1'
    },
    { name: 'business schema read', sql: `SELECT * FROM ${relation} LIMIT 1` }
  ];
  const prohibitedStatements = [
    { name: 'INSERT', sql: `INSERT INTO ${relation} SELECT * FROM ${relation} LIMIT 0` },
    { name: 'UPDATE', sql: `UPDATE ${relation} SET ${column} = ${column} WHERE false` },
    { name: 'DELETE', sql: `DELETE FROM ${relation} WHERE false` },
    { name: 'TRUNCATE', sql: `TRUNCATE ${relation}` },
    {
      name: 'CREATE TABLE',
      sql: `CREATE TABLE ${fixtureRelation({ schema: input.fixture.schema, table: `ops_readonly_probe_${suffix}`, column: input.fixture.column })} (id integer)`
    },
    { name: 'CREATE TEMP TABLE', sql: `CREATE TEMP TABLE ${probeName} (id integer)` },
    { name: 'ALTER TABLE', sql: `ALTER TABLE ${relation} ADD COLUMN ${probeName} integer` },
    { name: 'DROP TABLE', sql: `DROP TABLE ${relation}` },
    {
      name: 'CREATE FUNCTION',
      sql: `CREATE FUNCTION ${quoteIdentifier(input.fixture.schema)}.${probeName}() RETURNS integer LANGUAGE sql AS 'SELECT 1'`
    },
    { name: 'SET ROLE', sql: 'SET ROLE ops_cancel' }
  ];
  const posture = await readPosture(input.database);
  const readResults: Array<{ name: string; passed: boolean }> = [];
  for (const { name, sql } of reads) {
    readResults.push({ name, passed: await queryPasses(input.database, sql) });
  }
  const prohibitedResults: Array<{ name: string; rejected: boolean }> = [];
  for (const { name, sql } of prohibitedStatements) {
    prohibitedResults.push({ name, rejected: await queryIsRejected(input.database, sql) });
  }
  const failures = rolePostureFailures(posture, input.expectedDatabase);
  for (const read of readResults)
    if (!read.passed) failures.push(`required read failed: ${read.name}`);
  for (const operation of prohibitedResults) {
    if (!operation.rejected) failures.push(`prohibited operation succeeded: ${operation.name}`);
  }
  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    role: posture.role,
    database: posture.database,
    failures,
    reads: readResults,
    prohibitedOperations: prohibitedResults
  };
}

function parseArguments(argumentsList: readonly string[]): {
  databaseUrlFile: string;
  fixture: Fixture;
  expectedDatabase?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!flag?.startsWith('--') || !value)
      throw new Error('Expected --database-url-file, --fixture and --fixture-column');
    values.set(flag, value);
  }
  const databaseUrlFile = values.get('--database-url-file');
  const fixtureValue = values.get('--fixture');
  const fixtureColumn = values.get('--fixture-column');
  if (!databaseUrlFile || !fixtureValue || !fixtureColumn) {
    throw new Error('Expected --database-url-file, --fixture and --fixture-column');
  }
  const [schema, table, extra] = fixtureValue.split('.');
  if (
    !schema ||
    !table ||
    extra ||
    !identifier.test(schema) ||
    !identifier.test(table) ||
    !identifier.test(fixtureColumn)
  ) {
    throw new Error('Fixture must use lower-case schema.table and a lower-case fixture column');
  }
  const expectedDatabase = values.get('--expected-database');
  if (expectedDatabase && !identifier.test(expectedDatabase))
    throw new Error('Expected database must be a lower-case PostgreSQL identifier');
  return { databaseUrlFile, fixture: { schema, table, column: fixtureColumn }, expectedDatabase };
}

async function readMode0600File(path: string): Promise<string> {
  const metadata = await stat(path);
  if ((metadata.mode & 0o777) !== 0o600) throw new Error('Credential file mode must be 0600');
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
    const report = await verifyReadonlyRole({
      database,
      fixture: options.fixture,
      expectedDatabase: options.expectedDatabase
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.status !== 'pass') process.exitCode = 2;
  } finally {
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'role verification failed';
    process.stderr.write(`verify-readonly-role: ${message}\n`);
    process.exitCode = 2;
  });
}
