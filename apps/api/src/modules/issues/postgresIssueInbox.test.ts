import { describe, expect, it } from 'vitest';

import { PostgresIssueInbox } from './postgresIssueInbox.js';

describe('PostgresIssueInbox', () => {
  it('returns redacted, cursor-paginated issue summaries without event payloads', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const inbox = new PostgresIssueInbox({
      query: async <T>(sql, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        return {
          rows: [
            {
              id: 'issue-id',
              fingerprint: 'fp',
              title: 'API failed',
              errorCode: 'API_FAILURE',
              source: 'api',
              severity: 'high',
              status: 'new',
              firstSeenAt: '2026-08-22T03:00:00.000Z',
              lastSeenAt: '2026-08-22T03:01:00.000Z',
              occurrenceCount: '2',
              affectedUserCount: '1'
            }
          ] as T[]
        };
      }
    });
    await expect(inbox.list({ limit: 20 })).resolves.toEqual([
      expect.objectContaining({ severity: 'high', occurrenceCount: 2 })
    ]);
    expect(calls[0]?.sql).toContain('FROM error_issues');
    expect(calls[0]?.sql).not.toContain('stack_trace');
    expect(calls[0]?.parameters).toEqual([21]);
  });

  it('loads a bounded sanitized event timeline for a single issue', async () => {
    const calls: string[] = [];
    const inbox = new PostgresIssueInbox({
      query: async <T>(sql: string) => {
        calls.push(sql);
        if (sql.includes('WHERE id = $1'))
          return {
            rows: [
              {
                id: 'issue-id',
                fingerprint: 'fp',
                title: 'failed',
                errorCode: 'FAIL',
                source: 'api',
                severity: 'high',
                status: 'new',
                firstSeenAt: '2026-08-22T03:00:00.000Z',
                lastSeenAt: '2026-08-22T03:01:00.000Z',
                occurrenceCount: '1',
                affectedUserCount: '1'
              }
            ] as T[]
          };
        if (sql.includes('FROM error_issue_activity'))
          return {
            rows: [
              {
                id: 'activity-id',
                activityType: 'commented',
                occurredAt: '2026-08-22T03:02:00.000Z',
                comment: 'Investigating the timeout.',
                metadata: {},
                actorUserId: 'maintainer-id',
                actorDisplayName: 'Maintainer'
              }
            ] as T[]
          };
        return { rows: [{ eventId: 'EVT_1', safeMessage: 'failed' }] as T[] };
      }
    });
    await expect(inbox.detail('issue-id')).resolves.toMatchObject({
      events: [{ eventId: 'EVT_1' }],
      activities: [
        {
          activityType: 'commented',
          actorDisplayName: 'Maintainer',
          comment: 'Investigating the timeout.'
        }
      ]
    });
    const eventQuery = calls.find((sql) => sql.includes('FROM error_events'));
    expect(eventQuery).toContain('LIMIT 50');
    expect(eventQuery).not.toContain(' context');
    const activityQuery = calls.find((sql) => sql.includes('FROM error_issue_activity'));
    expect(activityQuery).toContain('LEFT JOIN ops_users AS actor');
    expect(activityQuery).toContain('LIMIT 100');
  });
});
