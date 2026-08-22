import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0006_release_publishers.sql', import.meta.url),
  'utf8'
);

describe('release publisher migration', () => {
  it('separates signed source-map publishers from telemetry clients and indexes maps by generated file', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS release_publishers');
    expect(migration).toContain('key_id text PRIMARY KEY');
    expect(migration).toContain('service_name text NOT NULL');
    expect(migration).toContain('secret_reference text NOT NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS generated_file text');
    expect(migration).toContain('source_map_objects_release_generated_file_key');
  });
});
