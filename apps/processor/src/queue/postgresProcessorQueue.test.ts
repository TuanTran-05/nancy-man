import { describe, expect, it } from 'vitest';

import { PostgresProcessorQueue } from './postgresProcessorQueue.js';

describe('PostgresProcessorQueue', () => {
  it('claims one ready raw envelope with SKIP LOCKED and carries its ingest identity to the processor', async () => {
    const queries: string[] = [];
    const queue = new PostgresProcessorQueue({
      query: async <T>(sql: string) => {
        queries.push(sql);
        if (sql.includes('UPDATE ingest_processing')) {
          return {
            rows: [
              {
                envelopeId: 'env-1',
                receivedAt: new Date('2026-08-22T08:00:00.000Z'),
                ingestClientId: 'e4eec74b-9dfd-4ba7-9b6a-3689ccbb9d49',
                payload: {
                  envelope: {
                    schemaVersion: 1,
                    eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
                    idempotencyKey: 'idem-0123456789abcdef',
                    capturedAt: '2026-08-22T08:00:00.000Z',
                    source: 'api',
                    level: 'error',
                    error: { name: 'Error', code: 'SERVER_EXCEPTION', safeMessage: 'failed' },
                    context: {
                      release: 'release',
                      service: 'edutrack-api',
                      environment: 'production'
                    }
                  }
                }
              }
            ] as T[]
          };
        }
        return { rows: [] as T[] };
      }
    });

    await expect(
      queue.claimNext('processor-1', new Date('2026-08-22T08:00:01.000Z'))
    ).resolves.toMatchObject({
      envelopeId: 'env-1',
      ingestClientId: 'e4eec74b-9dfd-4ba7-9b6a-3689ccbb9d49',
      envelope: { eventId: 'EVT_01K3ZABCDEF0123456789ABCDE' }
    });
    expect(queries[0]).toContain('FOR UPDATE OF processing SKIP LOCKED');
    expect(queries[0]).toContain("SET state = 'claimed'");
  });

  it('returns a claimed envelope to retry with a bounded next attempt', async () => {
    const queries: string[] = [];
    const queue = new PostgresProcessorQueue({
      query: async <T>(sql: string) => {
        queries.push(sql);
        return { rows: [] as T[] };
      }
    });

    await queue.markRetry('env-1', new Date('2026-08-22T08:00:00.000Z'));
    expect(queries[0]).toContain("SET state = 'retrying'");
    expect(queries[0]).toContain('attempt_count = attempt_count + 1');
  });

  it('casts the claim release clock before subtracting an interval', async () => {
    const queries: string[] = [];
    const queue = new PostgresProcessorQueue({
      query: async <T>(sql: string) => {
        queries.push(sql);
        return { rows: [] as T[] };
      }
    });

    await queue.releaseExpiredClaims(new Date('2026-08-22T08:00:00.000Z'));
    expect(queries[0]).toContain('claimed_at < $1::timestamptz - INTERVAL');
  });
});
