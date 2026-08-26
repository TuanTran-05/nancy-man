import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const rolesArtifact = new URL('./002_ops_mutation_roles.sql', import.meta.url);
const verifierArtifact = new URL('./verify-journal-security.ts', import.meta.url);

describe('Ops mutation role and journal-security artifacts', () => {
  it('keeps journal ownership, DML, DDL, and break-glass identities separate', async () => {
    const sql = await readFile(rolesArtifact, 'utf8').catch(() => '');

    expect(sql).toContain('\\set ON_ERROR_STOP on');
    expect(sql).toContain('app_schema_owner_role is required');
    expect(sql).toContain('ops_dml_login_role is required');
    expect(sql).toContain('ops_ddl_login_role is required');
    expect(sql).toContain('CREATE ROLE ops_journal_owner NOLOGIN NOINHERIT');
    expect(sql).toContain('CREATE ROLE ops_dml NOLOGIN NOINHERIT');
    expect(sql).toContain('CREATE ROLE ops_ddl NOLOGIN NOINHERIT');
    expect(sql).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    expect(sql).toContain('GRANT TRIGGER ON ALL TABLES IN SCHEMA public TO ops_journal_owner');
    expect(sql).toContain('FROM _ops.journaled_tables');
    expect(sql).toContain('GRANT INSERT, UPDATE, DELETE ON TABLE');
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM ops_dml, ops_ddl');
    expect(sql).toContain('ops_ddl is intentionally not made a member of the application owner');
    expect(sql).toContain('ops_breakglass_login must be provisioned separately');
  });

  it('runs destructive privilege probes only inside rollback-only transactions', async () => {
    const source = await readFile(verifierArtifact, 'utf8').catch(() => '');

    expect(source).toContain('OPS_JOURNAL_VERIFY_DATABASE_URL');
    expect(source).toContain('OPS_JOURNAL_VERIFY_EXPECTED_DATABASE');
    expect(source).toContain("await client.query('BEGIN')");
    expect(source).toContain("await client.query('ROLLBACK')");
    expect(source).toContain('ALTER TABLE public.students DISABLE TRIGGER ops_capture_row_change');
    expect(source).toContain(
      'UPDATE _ops.row_change_journal SET operation = operation WHERE false'
    );
    expect(source).toContain('SET LOCAL session_replication_role = replica');
    expect(source).toContain('CREATE OR REPLACE FUNCTION _ops.capture_row_change()');
    expect(source).toContain('ALTER TABLE public.students OWNER TO ops_dml');
  });

  it('does not mistake a failed role switch for a rejected security probe', async () => {
    const source = await readFile(verifierArtifact, 'utf8');
    const roleSwitch = source.indexOf('await client.query(`SET LOCAL ROLE ${role}`)');
    const transactionStart = source.indexOf("await client.query('BEGIN')");
    const probeTry = source.indexOf('try {', transactionStart);

    expect(roleSwitch).toBeGreaterThanOrEqual(0);
    expect(transactionStart).toBeGreaterThanOrEqual(0);
    expect(probeTry).toBeGreaterThan(roleSwitch);
  });
});
