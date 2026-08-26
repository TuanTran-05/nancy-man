import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0003_ingest_processing_state.sql', import.meta.url),
  'utf8'
);

describe('ingest processing-state migration', () => {
  it('keeps mutable processor state separate from append-only raw envelopes', () => {
    expect(migration).toMatch(
      /ALTER TABLE ingest_envelopes\s+ADD COLUMN IF NOT EXISTS redacted boolean NOT NULL DEFAULT false/
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS ingest_processing');
    expect(migration).toContain('FOREIGN KEY (envelope_id, envelope_received_at)');
    expect(migration).toContain("state text NOT NULL DEFAULT 'pending'");
    expect(migration).toContain('ON ingest_processing (state, next_attempt_at, received_at)');
  });
});
