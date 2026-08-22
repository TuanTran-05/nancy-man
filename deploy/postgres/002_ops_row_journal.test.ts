import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const artifact = new URL('./002_ops_row_journal.sql', import.meta.url);

describe('production Ops row journal install artifact', () => {
  it('requires an explicit business-schema and owner scope before changing production', async () => {
    const sql = await readFile(artifact, 'utf8').catch(() => '');

    expect(sql).toContain('\\set ON_ERROR_STOP on');
    expect(sql).toContain('ops_business_schemas is required');
    expect(sql).toContain('ops_schema_owner_role is required');
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });

  it('records before/after rows and an execution identity in the same business transaction', async () => {
    const sql = await readFile(artifact, 'utf8').catch(() => '');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS _ops.execution_registry');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS _ops.row_change_journal');
    expect(sql).toContain("current_setting('app.ops_execution_id', true)");
    expect(sql).toContain('to_jsonb(OLD)');
    expect(sql).toContain('to_jsonb(NEW)');
    expect(sql).toContain('txid_current()');
    expect(sql).toContain('pg_current_wal_lsn()');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE');
  });

  it('attaches a guarded trigger to every ordinary table in the explicitly scoped business schemas', async () => {
    const sql = await readFile(artifact, 'utf8').catch(() => '');

    expect(sql).toContain(
      "FOREACH schema_name IN ARRAY string_to_array(:'ops_business_schemas', ',')"
    );
    expect(sql).toContain("class.relkind IN ('r', 'p')");
    expect(sql).toContain("namespace.nspname <> '_ops'");
    expect(sql).toContain('DROP TRIGGER IF EXISTS ops_capture_row_change');
    expect(sql).toContain('CREATE TRIGGER ops_capture_row_change');
  });

  it('does not expose production journal data or the journal function to public/read-only logins', async () => {
    const sql = await readFile(artifact, 'utf8').catch(() => '');

    expect(sql).toContain('REVOKE ALL ON SCHEMA _ops FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM PUBLIC, ops_readonly');
    expect(sql).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM PUBLIC, ops_readonly');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = pg_catalog, _ops');
  });
});
