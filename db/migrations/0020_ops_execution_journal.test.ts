import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(import.meta.dirname, '0020_ops_execution_journal.sql');

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('0020_ops_execution_journal migration', () => {
  it('stays portable to the SQL-only disposable migration validator', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migrationSql()).not.toMatch(/^\\[A-Za-z]/m);
  });

  it('creates a separately owned, registered-table-only journal boundary', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = migrationSql();

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS _ops AUTHORIZATION ops_journal_owner');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS _ops.execution_registry');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS _ops.journaled_tables');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS _ops.row_change_journal');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION _ops.register_journaled_table');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION _ops.capture_row_change');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = pg_catalog, _ops');
    expect(sql).toContain("current_setting('ops.execution_id', true)");
    expect(sql).toContain("current_setting('ops.actor_user_id', true)");
    expect(sql).toContain("current_setting('ops.actor_session_id', true)");
    expect(sql).toContain("current_setting('ops.statement_index', true)");
    expect(sql).toContain("public.digest(convert_to(before_document::text, 'UTF8'), 'sha256')");
    expect(sql).toContain("public.digest(convert_to(after_document::text, 'UTF8'), 'sha256')");
    expect(sql).toContain('pg_current_wal_lsn()');
    expect(sql).toContain('FROM _ops.journaled_tables');
    expect(sql).toContain('WHERE table_oid = TG_RELID');
    expect(sql).not.toContain('FOREACH schema_name IN ARRAY');
    expect(sql).toContain('ALTER FUNCTION _ops.capture_row_change() OWNER TO ops_journal_owner');
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM PUBLIC, ops_dml, ops_ddl');
    expect(sql).toContain(
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM PUBLIC, ops_dml, ops_ddl'
    );
  });
});
