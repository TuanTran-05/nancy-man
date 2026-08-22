import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { alertDeliveries, alertRules } from './alerts.js';
import { errorEvents, errorIssues, incidents, ingestDeadLetters } from './errors.js';
import { ingestClients, ingestEnvelopes, ingestIdempotency } from './ingestion.js';
import { releases, sourceMapObjects } from './releases.js';

describe('Error Operations Drizzle schema', () => {
  it('exposes the append-only ingestion and normalized issue tables', () => {
    expect([
      getTableName(ingestClients),
      getTableName(ingestIdempotency),
      getTableName(ingestEnvelopes),
      getTableName(errorEvents),
      getTableName(errorIssues),
      getTableName(incidents),
      getTableName(ingestDeadLetters),
      getTableName(alertRules),
      getTableName(alertDeliveries),
      getTableName(releases),
      getTableName(sourceMapObjects)
    ]).toEqual([
      'ingest_clients',
      'ingest_idempotency',
      'ingest_envelopes',
      'error_events',
      'error_issues',
      'incidents',
      'ingest_dead_letters',
      'alert_rules',
      'alert_deliveries',
      'releases',
      'source_map_objects'
    ]);
  });

  it('keeps the collector fields needed for idempotency, processing and issue grouping', () => {
    expect(Object.keys(ingestEnvelopes)).toEqual(
      expect.arrayContaining([
        'id',
        'receivedAt',
        'ingestClientId',
        'idempotencyKey',
        'eventId',
        'payload',
        'payloadHash'
      ])
    );
    expect(Object.keys(errorEvents)).toEqual(
      expect.arrayContaining(['eventId', 'issueId', 'occurredAt', 'safeMessage', 'context'])
    );
    expect(Object.keys(errorIssues)).toEqual(
      expect.arrayContaining(['fingerprint', 'severity', 'status', 'occurrenceCount'])
    );
  });
});
