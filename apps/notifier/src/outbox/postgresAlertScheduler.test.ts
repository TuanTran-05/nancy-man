import { describe, expect, it } from 'vitest';

import { PostgresAlertScheduler } from './postgresAlertScheduler.js';

describe('PostgresAlertScheduler', () => {
  it('schedules created/regressed alerts from immutable issue activity timestamps', async () => {
    const scheduled: unknown[] = [];
    const scheduler = new PostgresAlertScheduler({
      database: {
        query: async <T>(sql: string) => {
          if (sql.includes('FROM error_issue_activity')) {
            return {
              rows: [
                {
                  id: 'activity-1',
                  event: 'created',
                  occurredAt: new Date('2026-08-22T08:00:00.000Z'),
                  issueId: 'ISS_01K3ZABCDEF0123456789ABCDE',
                  severity: 'critical',
                  status: 'new',
                  source: 'database',
                  errorCode: 'DB_UNAVAILABLE',
                  firstSeenAt: new Date('2026-08-22T08:00:00.000Z'),
                  lastSeenAt: new Date('2026-08-22T08:00:00.000Z'),
                  occurrenceCount: 1
                }
              ] as T[]
            };
          }
          if (sql.includes("severity = 'critical'")) return { rows: [] as T[] };
          throw new Error(`Unexpected query: ${sql}`);
        }
      },
      outbox: {
        enqueue: async (input) => {
          scheduled.push(input);
        }
      }
    });

    await scheduler.schedule(new Date('2026-08-22T08:10:00.000Z'));

    expect(scheduled).toEqual([
      {
        issue: expect.objectContaining({ id: 'ISS_01K3ZABCDEF0123456789ABCDE' }),
        event: 'created',
        occurredAt: new Date('2026-08-22T08:00:00.000Z')
      }
    ]);
  });

  it('schedules unresolved delivery kinds once and includes a resolved activity', async () => {
    const scheduled: unknown[] = [];
    let activityQuery = '';
    const scheduler = new PostgresAlertScheduler({
      database: {
        query: async <T>(sql: string) => {
          if (sql.includes('FROM error_issue_activity')) {
            activityQuery = sql;
            if (!sql.includes("'resolved'")) {
              throw new Error('resolved activities must be selected');
            }
            if (!sql.includes('NOT EXISTS')) {
              throw new Error('already scheduled activities must be excluded');
            }
            return {
              rows: [
                {
                  id: 'activity-2',
                  event: 'resolved',
                  occurredAt: new Date('2026-08-22T08:20:00.000Z'),
                  issueId: 'ISS_01K3ZABCDEF0123456789ABCDE',
                  severity: 'high',
                  status: 'resolved',
                  source: 'api',
                  errorCode: 'REQUEST_FAILED',
                  firstSeenAt: new Date('2026-08-22T08:00:00.000Z'),
                  lastSeenAt: new Date('2026-08-22T08:20:00.000Z'),
                  occurrenceCount: 4
                }
              ] as T[]
            };
          }
          if (sql.includes("severity = 'critical'")) return { rows: [] as T[] };
          throw new Error(`Unexpected query: ${sql}`);
        }
      },
      outbox: {
        enqueue: async (input) => {
          scheduled.push(input);
        }
      }
    });

    await scheduler.schedule(new Date('2026-08-22T08:21:00.000Z'));

    expect(activityQuery).toContain('ORDER BY activity.occurred_at DESC');
    expect(scheduled).toEqual([
      {
        issue: expect.objectContaining({ status: 'resolved' }),
        event: 'resolved',
        occurredAt: new Date('2026-08-22T08:20:00.000Z')
      }
    ]);
  });
});
