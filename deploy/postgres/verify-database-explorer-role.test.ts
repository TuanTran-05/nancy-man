import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  verifyDatabaseExplorerRole,
  type ExplorerFixture,
  type Queryable
} from './verify-database-explorer-role.js';

const artifacts = {
  rolesSql: new URL('./003_database_explorer_roles.sql', import.meta.url),
  apply: new URL('./apply-role-grants.sh', import.meta.url),
  verifier: new URL('./verify-database-explorer-role.ts', import.meta.url),
  rolloutRunbook: new URL('../../docs/runbooks/database-explorer-rollout.md', import.meta.url),
  rotationRunbook: new URL('../../docs/runbooks/sql-role-rotation.md', import.meta.url)
};

async function readArtifact(path: URL): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

function extractDoBodies(sql: string): Array<{ tag: string; body: string; start: number }> {
  const bodies: Array<{ tag: string; body: string; start: number }> = [];
  const doBlockPattern = /\bDO\s+(\$[A-Za-z0-9_]*\$)\s*([\s\S]*?)\1\s*;/gim;
  for (const match of sql.matchAll(doBlockPattern)) {
    bodies.push({
      tag: match[1],
      body: match[2],
      start: match.index ?? -1
    });
  }
  return bodies;
}

describe('database explorer roles and verifier', () => {
  it('provisions separate no-login explorer capability role with column-level restrictions', async () => {
    const sql = await readArtifact(artifacts.rolesSql);

    expect(sql).toContain(
      'CREATE ROLE ops_database_browser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS'
    );
    expect(sql).toMatch(/ALTER ROLE ops_database_browser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/i);
    expect(sql).toContain('ops_browser_edutrack');
    expect(sql).toContain('ops_browser_ops');
    expect(sql).toContain('CONNECTION LIMIT 2');
    expect(sql).toContain('WITH INHERIT TRUE, SET FALSE');
    expect(sql).toContain('REVOKE TEMPORARY ON DATABASE :"ops_database_name" FROM PUBLIC');
    expect(sql).toContain('GRANT CONNECT ON DATABASE :"ops_database_name" TO ops_database_browser');
    expect(sql).toContain("default_transaction_read_only = 'on'");
    expect(sql).toContain("statement_timeout = '15s'");
    expect(sql).toContain("lock_timeout = '2s'");
    expect(sql).toContain("idle_in_transaction_session_timeout = '30s'");
    expect(sql).toContain("search_path = 'pg_catalog'");
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC');
    expect(sql).toContain('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM ops_database_browser');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %I');
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC'
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM ops_database_browser'
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I'
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM ops_database_browser'
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM %I'
    );
    expect(sql).toContain('REVOKE ALL ON SCHEMA _ops FROM ops_database_browser');
    expect(sql).toContain('REVOKE ALL ON SCHEMA _ops FROM %I');
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON TABLES FROM ops_database_browser'
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON SEQUENCES FROM ops_database_browser'
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM ops_database_browser'
    );
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|SELECT)\s+ON\s+ALL\s+TABLES/i);
  });

  it('revokes every existing login membership before granting only the capability role', async () => {
    const sql = await readArtifact(artifacts.rolesSql);

    const revokeLoop = sql.indexOf('FOR membership IN');
    const revokeLoopEnd = sql.indexOf('END LOOP;', revokeLoop);
    const membershipCleanup = sql.slice(revokeLoop, revokeLoopEnd);
    const capabilityGrant = sql.indexOf('GRANT ops_database_browser TO %I');
    expect(sql).toContain('FROM pg_auth_members');
    expect(sql).toContain('REVOKE %I FROM %I GRANTED BY %I CASCADE');
    expect(membershipCleanup).toContain('REVOKE %I FROM %I GRANTED BY %I CASCADE');
    expect(revokeLoop).toBeGreaterThanOrEqual(0);
    expect(capabilityGrant).toBeGreaterThan(revokeLoop);
    expect(sql).toContain('WITH INHERIT TRUE, SET FALSE');
  });

  it('revokes every stale capability member, including LOGINs and groups, per grantor before grants', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const cleanupStart = sql.indexOf('FOR capability_member IN');
    const cleanupEnd = sql.indexOf('END LOOP;', cleanupStart);
    const cleanup = sql.slice(cleanupStart, cleanupEnd);

    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanup).toContain("granted_role.rolname = 'ops_database_browser'");
    expect(cleanup).toContain('member_role.rolname <> browser_login');
    expect(cleanup).toContain('existing.grantor');
    expect(cleanup).toContain('grantor.rolname');
    expect(cleanup).toContain('REVOKE %I FROM %I GRANTED BY %I CASCADE');
    expect(cleanup).not.toContain('rolcanlogin');
    expect(sql).toContain('REVOKE %I FROM %I GRANTED BY %I CASCADE');
    expect(sql.indexOf('GRANT CONNECT ON DATABASE')).toBeGreaterThan(cleanupEnd);
    expect(sql).toContain('ops_database_browser has an unexpected direct member or membership option');
  });

  it('preflights superuser authority and every unexpected CREATE grantor before mutations', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const preflightStart = sql.indexOf('DO $provisioning_preflight$');
    const preflightEnd = sql.indexOf('$provisioning_preflight$;', preflightStart);
    const preflight = sql.slice(preflightStart, preflightEnd);

    expect(preflightStart).toBeGreaterThanOrEqual(0);
    expect(preflightEnd).toBeGreaterThan(preflightStart);
    expect(preflight).toContain('current_user');
    expect(preflight).toContain('rolsuper');
    expect(preflight).toContain('FOREACH schema_name IN ARRAY input_business_schemas');
    expect(preflight).toContain('INTO STRICT');
    expect(preflight).toContain('current_database()::text <> input_database_name');
    expect(preflight).toContain('aclexplode');
    expect(preflight).toContain("acl.privilege_type = 'CREATE'");
    expect(preflight).toContain('acl.grantor <>');
    expect(preflight).toContain('PG16 permits GRANTED BY only for current_user');
    expect(preflight).toContain('Revoke the unexpected CREATE ACL as its grantor, then rerun provisioning');
    expect(preflightStart).toBeLessThan(sql.indexOf('DO $roles$'));
    expect(preflightStart).toBeLessThan(sql.indexOf('CREATE ROLE ops_database_browser'));
    expect(preflightStart).toBeLessThan(sql.indexOf('GRANT CONNECT ON DATABASE'));
  });

  it('qualifies the schema column that collides with the preflight PL/pgSQL variable', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const preflight = extractDoBodies(sql).find(({ tag }) => tag === '$provisioning_preflight$');
    const schemaCountQuery = preflight?.body.match(
      /\bSELECT\s+count\(\*\)\s*,\s*count\s*\(\s*DISTINCT[\s\S]*?FROM\s+unnest\(input_business_schemas\)\s+AS\s+schemas\(schema_name\);/i
    )?.[0];

    expect(preflight?.body).toMatch(/\bDECLARE[\s\S]*?\bschema_name\s+text\s*;/i);
    expect(schemaCountQuery).toBeDefined();
    expect(schemaCountQuery).toMatch(
      /count\s*\(\s*DISTINCT\s+btrim\s*\(\s*schemas\.schema_name\s*\)\s*\)/i
    );
  });

  it('keeps psql variables outside every dollar-quoted DO body', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const doBodies = extractDoBodies(sql);
    const doStatementCount = Array.from(sql.matchAll(/\bDO\s+\$[A-Za-z0-9_]*\$/gim)).length;

    expect(doBodies).toHaveLength(doStatementCount);
    expect(doBodies.length).toBeGreaterThan(0);
    for (const { tag, body } of doBodies) {
      const strictInputReads =
        body.match(
          /\bSELECT\b[^;]*?\bINTO\s+STRICT\b[^;]*?\bFROM\s+pg_temp\.ops_database_explorer_input\b[^;]*?;/gims
        ) ?? [];
      expect(
        strictInputReads,
        `DO ${tag} body must have exactly one strict staged-input read`
      ).toHaveLength(1);
      expect(body, `DO ${tag} body must read staged values instead of psql variables`).not.toMatch(
        /(?<!:):(?!:)(?:'[^']*'|"[^"]*"|\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/
      );
    }
  });

  it('stages the typed psql inputs outside DO bodies before preflight', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const doBodies = extractDoBodies(sql);
    const firstDoStart = doBodies[0]?.start ?? -1;
    const stagedTableStart = sql.indexOf('CREATE TEMP TABLE ops_database_explorer_input');
    const stagedInputStart = sql.indexOf('INSERT INTO ops_database_explorer_input');
    const stagedSql = sql.slice(stagedTableStart, firstDoStart);

    expect(doBodies.length).toBeGreaterThan(0);
    expect(stagedTableStart).toBeGreaterThanOrEqual(0);
    expect(stagedInputStart).toBeGreaterThan(stagedTableStart);
    expect(stagedInputStart).toBeLessThan(firstDoStart);
    expect(stagedSql).toContain('business_schemas text[] NOT NULL');
    expect(stagedSql).toContain('string_to_array(:\'ops_business_schemas\', \',\')');
    for (const input of [
      'ops_database_name',
      'ops_business_schemas',
      'ops_schema_owner_role',
      'ops_browser_login',
      'ops_target_id',
      'ops_browser_password_verifier'
    ]) {
      expect(stagedSql).toContain(`:'${input}'`);
    }
  });

  it('clears the staged browser password immediately after creating or altering the login', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const loginBlock = extractDoBodies(sql).find(({ tag }) => tag === '$logins$');
    const passwordUse = loginBlock?.body.lastIndexOf('PASSWORD %L') ?? -1;
    const stagedPasswordClear = loginBlock?.body.indexOf(
      'UPDATE pg_temp.ops_database_explorer_input SET browser_password_verifier = NULL'
    ) ?? -1;
    const localPasswordClear = loginBlock?.body.indexOf('browser_password_verifier := NULL') ?? -1;

    expect(loginBlock).toBeDefined();
    expect(passwordUse).toBeGreaterThanOrEqual(0);
    expect(stagedPasswordClear).toBeGreaterThan(passwordUse);
    expect(localPasswordClear).toBeGreaterThan(stagedPasswordClear);
  });

  it('stages and sets the browser role password only from a SCRAM verifier', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const insertStart = sql.indexOf('INSERT INTO ops_database_explorer_input');
    const firstDoStart = extractDoBodies(sql)[0]?.start ?? -1;
    const stagedSql = sql.slice(insertStart, firstDoStart);
    const preflight =
      extractDoBodies(sql).find(({ tag }) => tag === '$provisioning_preflight$')?.body ?? '';
    const loginBlock = extractDoBodies(sql).find(({ tag }) => tag === '$logins$')?.body ?? '';

    expect(stagedSql).toContain(":'ops_browser_password_verifier'");
    expect(stagedSql).not.toContain(":'ops_browser_password'");
    expect(preflight).toContain(
      "input_browser_password_verifier !~ '^SCRAM-SHA-256\\$4096:[A-Za-z0-9+/]{22}==\\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$'"
    );
    const dynamicPasswordValues = Array.from(
      loginBlock.matchAll(/PASSWORD %L'[\s\S]*?browser_login,\s*([A-Za-z_]\w*)\s*\)/g),
      ([, value]) => value
    );
    expect(dynamicPasswordValues).toEqual([
      'browser_password_verifier',
      'browser_password_verifier'
    ]);
    expect(loginBlock).not.toMatch(/\bbrowser_password\b/);
  });

  it('removes direct CREATE ACLs from PUBLIC and unapproved role grantees in each business schema', async () => {
    const sql = await readArtifact(artifacts.rolesSql);
    const cleanupStart = sql.indexOf('FOR schema_create_grant IN');
    const cleanupEnd = sql.indexOf('END LOOP;', cleanupStart);
    const cleanup = sql.slice(cleanupStart, cleanupEnd);

    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanup).toContain('aclexplode');
    expect(cleanup).toContain('acl.privilege_type = \'CREATE\'');
    expect(cleanup).toContain('acl.grantee = 0');
    expect(cleanup).toContain('schema_owner');
    expect(cleanup).toContain('namespace.nspowner');
    expect(cleanup).toContain('REVOKE CREATE ON SCHEMA %I FROM %s CASCADE');
    expect(cleanup).not.toContain('FROM %s GRANTED BY');
    expect(sql).toContain("pg_has_role(candidate.oid, acl.grantee, 'USAGE')");
    expect(sql).toContain("pg_has_role(candidate.oid, acl.grantee, 'SET')");
    expect(sql).toContain('Business schema % has an unexpected effective CREATE privilege route');
    expect(sql.indexOf('GRANT USAGE ON SCHEMA %I TO ops_database_browser')).toBeGreaterThan(cleanupEnd);
  });

  it('serializes target claims and rejects provisioning both targets on one cluster', async () => {
    const sql = await readArtifact(artifacts.rolesSql);

    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('other_browser_login');
    expect(sql).toContain('ops_browser_edutrack');
    expect(sql).toContain('ops_browser_ops');
    expect(sql).toContain('already provisioned for the other target');
  });

  it('removes global default ACLs for PUBLIC, capability, and login on tables, sequences, and functions', async () => {
    const sql = await readArtifact(artifacts.rolesSql);

    for (const objectType of ['TABLES', 'SEQUENCES']) {
      for (const grantee of ['PUBLIC', 'ops_database_browser', '%I']) {
        expect(sql).toContain(
          `ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON ${objectType} FROM ${grantee}`
        );
      }
    }
    for (const grantee of ['PUBLIC', 'ops_database_browser', '%I']) {
      expect(sql).toContain(
        `ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM ${grantee}`
      );
    }
  });

  it('documents authenticated structural snapshots, approvals, both gates, and the approved grant CLI', async () => {
    const runbook = await readArtifact(artifacts.rolloutRunbook);
    const rotation = await readArtifact(artifacts.rotationRunbook);

    expect(runbook).toContain('GET /api/v1/database/:targetId/schema');
    expect(runbook).toContain('--snapshot-file');
    expect(runbook).toContain('--approval-file');
    expect(runbook).toContain('--target');
    expect(runbook).toContain('--role ops_database_browser');
    expect(runbook).toContain('--output');
    expect(runbook).toContain('OPS_SQL_WORKER_ENABLED=false');
    expect(runbook).toContain('OPS_DATABASE_EXPLORER_ENABLED=false');
    expect(runbook).toContain('ops_browser_edutrack');
    expect(runbook).toContain('ops_browser_ops');
    expect(runbook).toContain('ops-database-cursor-key');
    expect(runbook).toContain('current_user` phải là PostgreSQL `superuser`');
    expect(runbook).toContain('PG16 chỉ chấp nhận `GRANTED BY current_user` cho object privilege');
    expect(runbook).toContain('thu hồi CREATE trong context của grantor gốc');
    expect(rotation).toContain('ops_browser_edutrack');
    expect(rotation).toContain('ops_browser_ops');
    expect(rotation).toContain('current_user` phải là PostgreSQL `superuser`');
  });

  it('passes verification when posture is valid and prohibited actions are rejected', async () => {
    let activeQueries = 0;
    let maxConcurrentQueries = 0;
    let inTransaction = false;

    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        activeQueries += 1;
        maxConcurrentQueries = Math.max(maxConcurrentQueries, activeQueries);
        await new Promise((r) => setTimeout(r, 1));
        activeQueries -= 1;

        if (maxConcurrentQueries > 1) {
          throw new Error('Concurrent queries detected on single connection');
        }

        if (sql.includes('current_user AS role')) {
          return {
            rows: [
              {
                role: 'ops_browser_login',
                database: 'edutrack_production',
                canLogin: true,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: false
              }
            ] as T[]
          };
        }

        if (sql === 'BEGIN') {
          if (inTransaction) throw new Error('Transaction already active');
          inTransaction = true;
          return { rows: [] as T[] };
        }

        if (sql === 'ROLLBACK') {
          inTransaction = false;
          return { rows: [] as T[] };
        }

        // Prohibited actions and blocked column SELECT must throw
        if (
          /(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/.test(
            sql
          ) ||
          sql.includes('"password_hash"')
        ) {
          throw new Error('permission denied');
        }

        return { rows: [] as T[] };
      }
    };

    const fixture: ExplorerFixture = {
      schema: 'public',
      table: 'users',
      safeColumn: 'id',
      blockedColumn: 'password_hash'
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture,
      businessSchemas: ['public'],
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_login',
      expectedSchemaOwner: 'edutrack_owner',
      requireTls: true,
      now: () => new Date('2026-09-25T00:00:00Z')
    });

    expect(report.status).toBe('pass');
    expect(report.failures).toHaveLength(0);
    expect(report.safeReads.every((r) => r.passed)).toBe(true);
    expect(report.prohibitedOperations.every((p) => p.rejected)).toBe(true);
    expect(report.blockedColumnChecks.every((b) => b.rejected)).toBe(true);
    expect(maxConcurrentQueries).toBe(1);
  });

  it('fails verification if blocked column can be selected', async () => {
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          return {
            rows: [
              {
                role: 'ops_browser_login',
                database: 'edutrack_production',
                canLogin: true,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: false
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] as T[] };
        // Mutations throw
        if (
          /(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/.test(
            sql
          )
        ) {
          throw new Error('permission denied');
        }
        // Blocked column unexpectedly succeeds!
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: {
        schema: 'public',
        table: 'users',
        safeColumn: 'id',
        blockedColumn: 'password_hash'
      },
      businessSchemas: ['public'],
      expectedSchemaOwner: 'edutrack_owner'
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain('blocked column read succeeded: password_hash');
  });

  it('fails verification for unexpected memberships reachable through inherited or SET paths', async () => {
    let postureQuery = '';
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          postureQuery = sql;
          return {
            rows: [
              {
                role: 'ops_browser_edutrack',
                database: 'edutrack_production',
                canLogin: true,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                hasUnexpectedMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: false
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] as T[] };
        if (/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/i.test(sql)) {
          throw new Error('permission denied');
        }
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: { schema: 'public', table: 'users', safeColumn: 'id' },
      businessSchemas: ['public'],
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_edutrack',
      expectedSchemaOwner: 'edutrack_owner',
      requireTls: true
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain('login has unexpected role memberships');
    expect(postureQuery).toContain('WITH RECURSIVE');
    expect(postureQuery).toContain('pg_auth_members');
    expect(postureQuery).toContain('inherit_option');
    expect(postureQuery).toContain('set_option');
  });

  it('fails when the capability has any direct member beyond the exact current LOGIN', async () => {
    let postureQuery = '';
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          postureQuery = sql;
          return {
            rows: [
              {
                role: 'ops_browser_edutrack',
                database: 'edutrack_production',
                canLogin: true,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                hasUnexpectedMembership: false,
                hasUnexpectedCapabilityMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: false,
                hasUnexpectedSchemaCreator: false
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] as T[] };
        if (/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/i.test(sql)) {
          throw new Error('permission denied');
        }
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: { schema: 'public', table: 'users', safeColumn: 'id' },
      businessSchemas: ['public'],
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_edutrack',
      expectedSchemaOwner: 'edutrack_owner',
      requireTls: true
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain('capability role has unexpected direct members');
    expect(postureQuery).toContain('hasUnexpectedCapabilityMembership');
    expect(postureQuery).toContain('membership.inherit_option');
    expect(postureQuery).toContain('membership.set_option');
    expect(postureQuery).toContain('membership.admin_option');
    expect(postureQuery).toContain('SELECT count(*)');
    expect(postureQuery).toContain(') <> 1');
    expect(postureQuery).not.toContain('member_role.rolcanlogin');
  });

  it('fails when a configured business schema retains an unexpected CREATE route', async () => {
    let postureQuery = '';
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          postureQuery = sql;
          return {
            rows: [
              {
                role: 'ops_browser_edutrack',
                database: 'edutrack_production',
                canLogin: true,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                hasUnexpectedMembership: false,
                hasUnexpectedCapabilityMembership: false,
                hasUnexpectedSchemaCreator: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: false
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] as T[] };
        if (/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/i.test(sql)) {
          throw new Error('permission denied');
        }
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: { schema: 'public', table: 'users', safeColumn: 'id' },
      businessSchemas: ['public'],
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_edutrack',
      expectedSchemaOwner: 'edutrack_owner',
      requireTls: true
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain(
      'configured business schemas retain an unexpected CREATE privilege route'
    );
    expect(postureQuery).toContain('hasUnexpectedSchemaCreator');
    expect(postureQuery).toContain('aclexplode');
    expect(postureQuery).toContain('acl.privilege_type = \'CREATE\'');
    expect(postureQuery).toContain('acl.grantee = 0');
    expect(postureQuery).toContain("pg_has_role(candidate.oid, acl.grantee, 'USAGE')");
    expect(postureQuery).toContain("pg_has_role(candidate.oid, acl.grantee, 'SET')");
    expect(postureQuery).toContain("rolname = 'edutrack_owner'");
  });

  it('checks CREATE routes in every configured business schema, not only the fixture schema', async () => {
    let postureQuery = '';
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          postureQuery = sql;
          return {
            rows: [
              {
                role: 'ops_browser_edutrack',
                database: 'edutrack_production',
                canLogin: true,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                hasUnexpectedMembership: false,
                hasUnexpectedCapabilityMembership: false,
                hasUnexpectedSchemaCreator: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: false
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] as T[] };
        if (/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/i.test(sql)) {
          throw new Error('permission denied');
        }
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: { schema: 'public', table: 'users', safeColumn: 'id' },
      businessSchemas: ['public', 'tenant_data'],
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_edutrack',
      expectedSchemaOwner: 'edutrack_owner',
      requireTls: true
    });

    expect(report.status).toBe('fail');
    expect(postureQuery).toContain("'tenant_data'");
    expect(postureQuery).toContain('business_namespace.nspname IN');
  });

  it('fails verification when effective default ACLs expose PUBLIC or browser roles', async () => {
    let postureQuery = '';
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          postureQuery = sql;
          return {
            rows: [
              {
                role: 'ops_browser_edutrack',
                database: 'edutrack_production',
                canLogin: true,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                hasUnexpectedMembership: false,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: true
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] as T[] };
        if (/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/i.test(sql)) {
          throw new Error('permission denied');
        }
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: { schema: 'public', table: 'users', safeColumn: 'id' },
      businessSchemas: ['public'],
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_edutrack',
      expectedSchemaOwner: 'edutrack_owner',
      requireTls: true
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain(
      'default ACLs expose tables, sequences, or functions to PUBLIC or browser roles'
    );
    expect(postureQuery).toContain('pg_default_acl');
    expect(postureQuery).toContain('aclexplode');
    expect(postureQuery).toContain('defaclobjtype');
    expect(postureQuery).toContain("rolname = 'edutrack_owner'");
  });

  it('fails verification on elevated posture or mutation success', async () => {
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          return {
            rows: [
              {
                role: 'postgres',
                database: 'edutrack_production',
                canLogin: false,
                defaultTransactionReadOnly: 'off',
                hasExplorerMembership: false,
                isSuperuser: true,
                hasBypassRls: true,
                hasReplication: true,
                isMemberOfElevatedRole: true,
                hasTemporaryPrivilege: true,
                canAccessOpsSchema: true,
                sslSetting: 'off',
                hasUnsafeDefaultPrivileges: true
              }
            ] as T[]
          };
        }
        // Operations succeed (bad!)
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: { schema: 'public', table: 'users', safeColumn: 'id' },
      businessSchemas: ['public'],
      expectedDatabase: 'wrong_db',
      expectedRole: 'ops_browser_login',
      expectedSchemaOwner: 'edutrack_owner',
      requireTls: true
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain('login is a superuser');
    expect(report.failures).toContain('login has BYPASSRLS');
    expect(report.failures).toContain('login has replication');
    expect(report.failures).toContain('login is a member of an elevated role');
    expect(report.failures).toContain('login has TEMPORARY database privilege');
    expect(report.failures).toContain('login can use the _ops schema');
    expect(report.failures).toContain('default_transaction_read_only is not on');
    expect(report.failures).toContain('login is not a member of ops_database_browser');
    expect(report.failures).toContain(
      'connected database edutrack_production does not match expected database wrong_db'
    );
    expect(report.failures).toContain(
      'connected role postgres does not match expected role ops_browser_login'
    );
    expect(report.failures).toContain('TLS is required but not active');
    expect(report.failures).toContain(
      'default ACLs expose tables, sequences, or functions to PUBLIC or browser roles'
    );
    expect(report.failures.some((f) => f.includes('prohibited operation succeeded'))).toBe(true);
  });

  it('fails verification when current_user is not a LOGIN identity', async () => {
    const mockDb: Queryable = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('current_user AS role')) {
          return {
            rows: [
              {
                role: 'ops_database_browser',
                database: 'edutrack_production',
                canLogin: false,
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasUnsafeDefaultPrivileges: false
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] as T[] };
        if (
          /(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|COPY.*TO PROGRAM|SET ROLE)/.test(
            sql
          )
        ) {
          throw new Error('permission denied');
        }
        return { rows: [] as T[] };
      }
    };

    const report = await verifyDatabaseExplorerRole({
      database: mockDb,
      fixture: { schema: 'public', table: 'users', safeColumn: 'id' },
      businessSchemas: ['public'],
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_edutrack',
      expectedSchemaOwner: 'edutrack_owner',
      now: () => new Date('2026-09-25T00:00:00Z')
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain('current role is not a LOGIN role');
  });

  it('rejects an explorer LOGIN that does not belong to the closed target before applying grants', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-role-'));
    try {
      const pgpassPath = join(directory, 'admin.pgpass');
      const passwordPath = join(directory, 'browser.pass');
      const urlPath = join(directory, 'browser.url');
      await writeFile(pgpassPath, 'localhost:5432:edutrack_ops:admin:unused\n', { mode: 0o600 });
      await writeFile(passwordPath, 'A'.repeat(32), { mode: 0o600 });
      await writeFile(urlPath, 'postgresql://reader:unused@localhost/edutrack_ops', {
        mode: 0o600
      });

      const invoke = (database: string, browserLogin: string) =>
        spawnSync(
          'bash',
          [
            artifacts.apply.pathname,
            '--role-type',
            'explorer',
            '--target',
            'ops',
            '--database',
            database,
            '--admin-pgpass-file',
            pgpassPath,
            '--browser-login',
            browserLogin,
            '--browser-password-file',
            passwordPath,
            '--business-schemas',
            'public',
            '--schema-owner-role',
            'edutrack_owner',
            '--browser-database-url-file',
            urlPath,
            '--fixture',
            'public.users',
            '--safe-column',
            'id',
            '--blocked-column',
            'password_hash',
            '--revoke-public-privileges'
          ],
          { encoding: 'utf8', env: { ...process.env, PSQL_BIN: '/bin/true' } }
        );

      const wrongLogin = invoke('edutrack_ops', 'ops_browser_edutrack');
      expect(wrongLogin.status).not.toBe(0);
      expect(wrongLogin.stderr).toContain('--browser-login must be ops_browser_ops for target ops');

      const wrongDatabase = invoke('edutrack_production', 'ops_browser_ops');
      expect(wrongDatabase.status).not.toBe(0);
      expect(wrongDatabase.stderr).toContain('--database must be edutrack_ops for target ops');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('sends a SCRAM verifier to psql without exposing the clear browser password', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-scram-'));
    try {
      const pgpassPath = join(directory, 'admin.pgpass');
      const passwordPath = join(directory, 'browser.pass');
      const urlPath = join(directory, 'browser.url');
      const psqlPath = join(directory, 'capture-psql');
      const nodePath = join(directory, 'node');
      const psqlInputPath = join(directory, 'psql-input.txt');
      const nodeArgsPath = join(directory, 'node-args.txt');
      const sentinelPassword = 'wrapper-sentinel-password-0123456789-abcdefghijklmnopqrstuvwxyz';

      await writeFile(pgpassPath, 'localhost:5432:edutrack_ops:admin:unused\n', { mode: 0o600 });
      await writeFile(passwordPath, sentinelPassword, { mode: 0o600 });
      await writeFile(urlPath, 'postgresql://reader:unused@localhost/edutrack_ops', {
        mode: 0o600
      });
      await writeFile(psqlPath, '#!/bin/sh\ncat > "$TASK6_PSQL_INPUT_CAPTURE"\n', { mode: 0o700 });
      await writeFile(
        nodePath,
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$TASK6_NODE_ARGS_CAPTURE"\ncase "$*" in\n  *derive-scram-verifier.mjs*) exec "$TASK6_REAL_NODE" "$@" ;;\n  *verify-database-explorer-role.ts*) exit 0 ;;\nesac\nexit 97\n',
        { mode: 0o700 }
      );

      const run = spawnSync(
        'bash',
        [
          artifacts.apply.pathname,
          '--role-type',
          'explorer',
          '--target',
          'ops',
          '--database',
          'edutrack_ops',
          '--admin-pgpass-file',
          pgpassPath,
          '--browser-login',
          'ops_browser_ops',
          '--browser-password-file',
          passwordPath,
          '--business-schemas',
          'public',
          '--schema-owner-role',
          'edutrack_owner',
          '--browser-database-url-file',
          urlPath,
          '--fixture',
          'public.users',
          '--safe-column',
          'id',
          '--revoke-public-privileges'
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH ?? '/usr/bin:/bin'}`,
            PSQL_BIN: psqlPath,
            TASK6_PSQL_INPUT_CAPTURE: psqlInputPath,
            TASK6_NODE_ARGS_CAPTURE: nodeArgsPath,
            TASK6_REAL_NODE: process.execPath
          }
        }
      );

      expect(run.status).toBe(0);
      expect(run.stdout).not.toContain(sentinelPassword);
      expect(run.stderr).not.toContain(sentinelPassword);

      const psqlInput = await readFile(psqlInputPath, 'utf8');
      const nodeArgs = await readFile(nodeArgsPath, 'utf8');
      expect(psqlInput).not.toContain(sentinelPassword);
      expect(nodeArgs).not.toContain(sentinelPassword);
      const stagedVerifier = psqlInput.match(
        /^\\set ops_browser_password_verifier '([^']+)'$/m
      )?.[1];
      expect(stagedVerifier).toMatch(
        /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires expected database, role, schema owner, and TLS in the verifier CLI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-verifier-'));
    try {
      const urlPath = join(directory, 'browser.url');
      await writeFile(urlPath, 'postgresql://reader:unused@127.0.0.1:1/edutrack_production', {
        mode: 0o600
      });
      const fullArgs = [
        '--database-url-file',
        urlPath,
        '--fixture',
        'public.users',
        '--business-schemas',
        'public',
        '--safe-column',
        'id',
        '--expected-database',
        'edutrack_production',
        '--expected-role',
        'ops_browser_edutrack',
        '--schema-owner-role',
        'edutrack_owner',
        '--require-tls'
      ];
      const withoutOption = (option: string) => {
        const index = fullArgs.indexOf(option);
        return fullArgs.filter((_, candidate) => candidate !== index && candidate !== index + 1);
      };
      const cases = [
        {
          args: withoutOption('--expected-database'),
          message: 'Expected --expected-database, --expected-role, --schema-owner-role and --require-tls'
        },
        {
          args: withoutOption('--expected-role'),
          message: 'Expected --expected-database, --expected-role, --schema-owner-role and --require-tls'
        },
        {
          args: withoutOption('--schema-owner-role'),
          message: 'Expected --expected-database, --expected-role, --schema-owner-role and --require-tls'
        },
        {
          args: withoutOption('--require-tls'),
          message: 'Expected --expected-database, --expected-role, --schema-owner-role and --require-tls'
        },
        {
          args: withoutOption('--business-schemas'),
          message: 'Expected --database-url-file, --fixture, --business-schemas and --safe-column'
        }
      ];
      for (const { args, message } of cases) {
        const run = spawnSync(
          process.execPath,
          ['--experimental-strip-types', artifacts.verifier.pathname, ...args],
          { encoding: 'utf8' }
        );
        expect(run.status).not.toBe(0);
        expect(run.stdout).toBe('');
        expect(run.stderr).toContain(message);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('passes schema owner and TLS enforcement to the verifier from the apply wrapper', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-apply-tls-'));
    try {
      const pgpassPath = join(directory, 'admin.pgpass');
      const passwordPath = join(directory, 'browser.pass');
      const urlPath = join(directory, 'browser.url');
      const nodePath = join(directory, 'node');
      const argsPath = join(directory, 'verifier-args.txt');
      await writeFile(pgpassPath, 'localhost:5432:edutrack_ops:admin:unused\n', { mode: 0o600 });
      await writeFile(passwordPath, 'A'.repeat(32), { mode: 0o600 });
      await writeFile(urlPath, 'postgresql://reader:unused@localhost/edutrack_ops', {
        mode: 0o600
      });
      await writeFile(nodePath, '#!/bin/sh\ncase "$*" in\n  *derive-scram-verifier.mjs*) exec "$TASK6_REAL_NODE" "$@" ;;\nesac\nprintf \'%s\\n\' "$@" > "$TASK6_NODE_ARGS_CAPTURE"\n', {
        mode: 0o700
      });

      const run = spawnSync(
        'bash',
        [
          artifacts.apply.pathname,
          '--role-type',
          'explorer',
          '--target',
          'ops',
          '--database',
          'edutrack_ops',
          '--admin-pgpass-file',
          pgpassPath,
          '--browser-login',
          'ops_browser_ops',
          '--browser-password-file',
          passwordPath,
          '--business-schemas',
          'public',
          '--schema-owner-role',
          'edutrack_owner',
          '--browser-database-url-file',
          urlPath,
          '--fixture',
          'public.users',
          '--safe-column',
          'id',
          '--revoke-public-privileges'
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PSQL_BIN: '/bin/true',
            PATH: `${directory}:${process.env.PATH ?? '/usr/bin:/bin'}`,
            TASK6_NODE_ARGS_CAPTURE: argsPath,
            TASK6_REAL_NODE: process.execPath
          }
        }
      );

      expect(run.status).toBe(0);
      const verifierArgs = (await readFile(argsPath, 'utf8')).split(/\r?\n/u);
      expect(verifierArgs).toContain('--require-tls');
      const businessSchemasFlag = verifierArgs.indexOf('--business-schemas');
      expect(businessSchemasFlag).toBeGreaterThanOrEqual(0);
      expect(verifierArgs[businessSchemasFlag + 1]).toBe('public');
      const schemaOwnerFlag = verifierArgs.indexOf('--schema-owner-role');
      expect(schemaOwnerFlag).toBeGreaterThanOrEqual(0);
      expect(verifierArgs[schemaOwnerFlag + 1]).toBe('edutrack_owner');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
