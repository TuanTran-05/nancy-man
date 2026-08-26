import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const artifact = new URL('./002_ops_row_journal.sql', import.meta.url);

describe('retired broad row-journal install artifact', () => {
  it('fails closed rather than attaching a trigger to every table in a schema', async () => {
    const sql = await readFile(artifact, 'utf8').catch(() => '');

    expect(sql).toContain('\\set ON_ERROR_STOP on');
    expect(sql).toContain('RETIRED: do not execute this file');
    expect(sql).toContain('0020_ops_execution_journal.sql');
    expect(sql).not.toContain('CREATE TRIGGER ops_capture_row_change');
    expect(sql).not.toContain('FOREACH schema_name IN ARRAY');
  });
});
