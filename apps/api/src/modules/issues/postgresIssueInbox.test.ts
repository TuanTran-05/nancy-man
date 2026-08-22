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
});
