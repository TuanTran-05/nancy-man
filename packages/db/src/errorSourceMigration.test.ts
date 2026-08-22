import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0004_error_source_extensions.sql', import.meta.url),
  'utf8'
);

describe('error source extension migration', () => {
  it('allows document-store and deployment failures without weakening the source allowlist', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS ingest_envelopes_source_check');
    expect(migration).toContain("'document_store'");
    expect(migration).toContain("'deployment'");
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS error_events_source_check');
  });
});
