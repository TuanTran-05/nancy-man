import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0002_error_operations.sql', import.meta.url),
  'utf8'
);

describe('Error Operations migration', () => {
  it('defines append-only, idempotent ingestion and normalized issue tables', () => {
    for (const table of [
      'ingest_clients',
      'ingest_idempotency',
      'ingest_envelopes',
      'error_events',
      'error_issues',
      'error_issue_activity',
      'incidents',
      'incident_issues',
      'alert_rules',
      'alert_deliveries',
      'releases',
      'source_map_objects',
      'ingest_dead_letters'
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }

    expect(migration).toContain('PRIMARY KEY (ingest_client_id, idempotency_key)');
    expect(migration).toContain('fingerprint text NOT NULL UNIQUE');
    expect(migration).toContain('PARTITION BY RANGE (received_at)');
    expect(migration).toContain('PARTITION BY RANGE (occurred_at)');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION ensure_error_operations_partitions');
    expect(migration).toContain(
      'REVOKE UPDATE, DELETE ON ingest_envelopes, error_events FROM PUBLIC'
    );
  });
});
