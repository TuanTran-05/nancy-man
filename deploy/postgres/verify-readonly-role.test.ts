import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { verifyReadonlyRole } from './verify-readonly-role.js';

const artifacts = {
  grants: new URL('./001_ops_readonly_roles.sql', import.meta.url),
  apply: new URL('./apply-role-grants.sh', import.meta.url),
  verifier: new URL('./verify-readonly-role.ts', import.meta.url),
  runbook: new URL('../../docs/runbooks/sql-role-rotation.md', import.meta.url)
};

async function readArtifact(path: URL): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

describe('least-privilege Ops PostgreSQL roles', () => {
  it('provisions separate no-login group roles with only explicit business-schema reads', async () => {
    const grants = await readArtifact(artifacts.grants);

    expect(grants).toContain(
      'CREATE ROLE ops_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS'
    );
    expect(grants).toContain(
      'CREATE ROLE ops_cancel NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS'
    );
    expect(grants).toContain('REVOKE TEMPORARY ON DATABASE :"ops_database_name" FROM PUBLIC');
    expect(grants).toContain(
      'GRANT CONNECT ON DATABASE :"ops_database_name" TO ops_readonly, ops_cancel'
    );
    expect(grants).toContain('GRANT pg_signal_backend TO ops_cancel');
    expect(grants).not.toContain('GRANT pg_signal_backend TO ops_readonly');
    expect(grants).toContain("default_transaction_read_only = 'on'");
    expect(grants).toContain("statement_timeout = '30s'");
    expect(grants).toContain("lock_timeout = '3s'");
    expect(grants).toContain("idle_in_transaction_session_timeout = '30s'");
    expect(grants).toContain("schema_name IN ('_ops', 'pg_catalog', 'information_schema')");
    expect(grants).toContain('REVOKE ALL ON SCHEMA _ops FROM PUBLIC');
    expect(grants).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM PUBLIC');
    expect(grants).not.toMatch(/GRANT\s+(?:ALL|SELECT)\s+ON\s+ALL\s+TABLES\s+IN\s+DATABASE/i);
  });

  it('removes inherited PUBLIC write and function paths before granting read access', async () => {
    const grants = await readArtifact(artifacts.grants);

    expect(grants).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC');
    expect(grants).toContain('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC');
    expect(grants).toContain('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC');
    expect(grants).toContain('REVOKE ALL ON TABLES FROM PUBLIC');
    expect(grants).toContain('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
  });

  it('uses protected credential files, verifies the new read login, then retires old logins only after sessions drain', async () => {
    const apply = await readArtifact(artifacts.apply);

    expect(apply).toContain('set -euo pipefail');
    expect(apply).not.toMatch(/^\s*set\s+-[^\n]*x/m);
    expect(apply).toContain('mode must be 0600');
    expect(apply).toContain('--revoke-public-privileges');
    expect(apply).toContain('node --experimental-strip-types');
    expect(apply).toContain('pg_stat_activity');
    expect(apply).toContain('ALTER ROLE :"ops_retire_login" NOLOGIN');
    expect(apply).not.toMatch(/(?:echo|printf).*password/i);
  });

  it('checks the effective read-login posture and probes mutations inside rollback transactions', async () => {
    const verifier = await readArtifact(artifacts.verifier);

    expect(verifier).toContain("current_setting('default_transaction_read_only', true)");
    expect(verifier).toContain(
      "has_database_privilege(current_user, current_database(), 'TEMPORARY')"
    );
    expect(verifier).toContain("pg_has_role(current_user, 'ops_readonly', 'member')");
    expect(verifier).toContain('INSERT INTO');
    expect(verifier).toContain('CREATE TEMP TABLE');
    expect(verifier).toContain('CREATE FUNCTION');
    expect(verifier).toContain('SET ROLE ops_cancel');
    expect(verifier).toContain("await database.query('BEGIN')");
    expect(verifier).toContain("await database.query('ROLLBACK')");
  });

  it('serializes probes because a PostgreSQL client has one transaction state', async () => {
    let activeQueries = 0;
    let maximumConcurrentQueries = 0;
    let inTransaction = false;
    const database = {
      query: async <T extends Record<string, unknown>>(sql: string) => {
        activeQueries += 1;
        maximumConcurrentQueries = Math.max(maximumConcurrentQueries, activeQueries);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeQueries -= 1;

        if (maximumConcurrentQueries > 1) throw new Error('queries were sent concurrently');
        if (sql.includes('current_user AS role')) {
          return {
            rows: [
              {
                role: 'ops_read_20260822',
                database: 'edutrack',
                defaultTransactionReadOnly: 'on',
                hasReadonlyMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                canAccessOpsTables: false,
                canAccessOpsFunctions: false,
                canSetCancelRole: false
              }
            ] as T[]
          };
        }
        if (sql === 'BEGIN') {
          if (inTransaction) throw new Error('transaction is already active');
          inTransaction = true;
          return { rows: [] as T[] };
        }
        if (sql === 'ROLLBACK') {
          inTransaction = false;
          return { rows: [] as T[] };
        }
        if (
          /(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|CREATE TEMP TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|SET ROLE)/.test(
            sql
          )
        ) {
          throw new Error('permission denied');
        }
        return { rows: [] as T[] };
      }
    };

    const report = await verifyReadonlyRole({
      database,
      fixture: { schema: 'public', table: 'role_probe_fixture', column: 'id' },
      expectedDatabase: 'edutrack',
      now: () => new Date('2026-08-22T00:00:00.000Z')
    });

    expect(report).toMatchObject({ status: 'pass', failures: [] });
    expect(maximumConcurrentQueries).toBe(1);
  });

  it('documents a no-secret rotation and production-approval procedure', async () => {
    const runbook = await readArtifact(artifacts.runbook);

    expect(runbook).toContain('OPS_SQL_READ_ENABLED=false');
    expect(runbook).toContain('0600');
    expect(runbook).toContain('RPO');
    expect(runbook).toContain('RTO');
    expect(runbook).toContain('không được ghi mật khẩu');
    expect(runbook).toContain('pg_stat_activity');
  });
});
