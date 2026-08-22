import { describe, expect, it } from 'vitest';

import { PostgresAlertOutbox } from './postgresAlertOutbox.js';

describe('PostgresAlertOutbox', () => {
  it('persists one deduplicated delivery per matching rule without sending a provider request', async () => {
    const inserts: readonly unknown[][] = [];
    const database = {
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        if (sql.includes('FROM alert_rules')) {
          return {
            rows: [
              {
                id: 'rule-zalo',
                minimumSeverity: 'critical',
                source: null,
                errorCode: null,
                channel: 'zalo',
                recipientReference: 'on-call-zalo'
              },
              {
                id: 'rule-email',
                minimumSeverity: 'high',
                source: 'database',
                errorCode: null,
                channel: 'email',
                recipientReference: 'on-call@thienuy.edu.vn'
              }
            ] as T[]
          };
        }
        if (sql.includes('INSERT INTO alert_deliveries')) {
          (inserts as unknown[][]).push([...parameters]);
          return { rows: [] as T[] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };
    const outbox = new PostgresAlertOutbox(database);

    await outbox.enqueue({
      issue: {
        id: 'ISS_01K3ZABCDEF0123456789ABCDE',
        severity: 'critical',
        status: 'new',
        source: 'database',
        errorCode: 'DB_UNAVAILABLE',
        firstSeenAt: new Date('2026-08-22T08:00:00.000Z'),
        lastSeenAt: new Date('2026-08-22T08:00:00.000Z'),
        occurrenceCount: 1
      },
      event: 'created',
      occurredAt: new Date('2026-08-22T08:00:00.000Z')
    });

    expect(inserts).toHaveLength(2);
    expect(inserts.map((parameters) => parameters.at(-1))).toEqual([
      'ISS_01K3ZABCDEF0123456789ABCDE:new:rule-zalo',
      'ISS_01K3ZABCDEF0123456789ABCDE:new:rule-email'
    ]);
  });
});
