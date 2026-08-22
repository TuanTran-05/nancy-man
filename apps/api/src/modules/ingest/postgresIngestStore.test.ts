import { describe, expect, it } from 'vitest';

import { PostgresIngestStore } from './postgresIngestStore.js';

const record = {
  id: '8d771951-51be-451a-9c34-c77e32a7303d',
  receivedAt: new Date('2026-08-22T08:00:00.000Z'),
  ingestClientId: 'e4eec74b-9dfd-4ba7-9b6a-3689ccbb9d49',
  idempotencyKey: 'idem-0123456789abcdef',
  eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
  source: 'browser',
  payload: { envelope: { schemaVersion: 1 } },
  payloadHash: 'a'.repeat(64),
  redacted: false
};

describe('PostgreSQL ingest store', () => {
  it('commits idempotency, append-only raw envelope and processing state atomically', async () => {
    const queries: string[] = [];
    const store = new PostgresIngestStore({
      query: async <T>(sql: string) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO ingest_idempotency')) {
          return { rows: [{ eventId: record.eventId, payloadHash: record.payloadHash }] as T[] };
        }
        return { rows: [] as T[] };
      }
    });

    await expect(store.insertRaw(record)).resolves.toEqual({ duplicate: false });
    expect(queries).toEqual(
      expect.arrayContaining([
        'BEGIN',
        expect.stringContaining('INSERT INTO ingest_idempotency'),
        expect.stringContaining('INSERT INTO ingest_envelopes'),
        expect.stringContaining('INSERT INTO ingest_processing'),
        'COMMIT'
      ])
    );
  });

  it('does not insert a second raw envelope after an idempotent retry', async () => {
    const queries: string[] = [];
    const store = new PostgresIngestStore({
      query: async <T>(sql: string) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO ingest_idempotency')) {
          return { rows: [] as T[] };
        }
        if (sql.includes('SELECT event_id AS')) {
          return { rows: [{ eventId: record.eventId, payloadHash: record.payloadHash }] as T[] };
        }
        return { rows: [] as T[] };
      }
    });

    await expect(store.insertRaw(record)).resolves.toEqual({ duplicate: true });
    expect(queries.join('\n')).not.toContain('INSERT INTO ingest_envelopes');
    expect(queries.at(-1)).toBe('COMMIT');
  });
});
