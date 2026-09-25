import { readFile } from 'node:fs/promises';
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

describe('database explorer roles and verifier', () => {
  it('provisions separate no-login explorer capability role with column-level restrictions', async () => {
    const sql = await readArtifact(artifacts.rolesSql);

    expect(sql).toContain(
      'CREATE ROLE ops_database_browser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS'
    );
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
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC'
    );
    expect(sql).toContain('REVOKE ALL ON SCHEMA _ops FROM ops_database_browser');
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|SELECT)\s+ON\s+ALL\s+TABLES/i);
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
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasDefaultPrivileges: false
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
      expectedDatabase: 'edutrack_production',
      expectedRole: 'ops_browser_login',
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
                defaultTransactionReadOnly: 'on',
                hasExplorerMembership: true,
                isSuperuser: false,
                hasBypassRls: false,
                hasReplication: false,
                isMemberOfElevatedRole: false,
                hasTemporaryPrivilege: false,
                canAccessOpsSchema: false,
                sslSetting: 'on',
                hasDefaultPrivileges: false
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
      }
    });

    expect(report.status).toBe('fail');
    expect(report.failures).toContain('blocked column read succeeded: password_hash');
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
                defaultTransactionReadOnly: 'off',
                hasExplorerMembership: false,
                isSuperuser: true,
                hasBypassRls: true,
                hasReplication: true,
                isMemberOfElevatedRole: true,
                hasTemporaryPrivilege: true,
                canAccessOpsSchema: true,
                sslSetting: 'off',
                hasDefaultPrivileges: true
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
      expectedDatabase: 'wrong_db',
      expectedRole: 'ops_browser_login',
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
      'default privileges grant table access to ops_database_browser'
    );
    expect(report.failures.some((f) => f.includes('prohibited operation succeeded'))).toBe(true);
  });
});
