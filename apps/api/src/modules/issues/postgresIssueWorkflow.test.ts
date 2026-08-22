import { describe, expect, it } from 'vitest';
import { PostgresIssueWorkflow } from './postgresIssueWorkflow.js';
describe('PostgresIssueWorkflow', () => {
  it('updates status and appends immutable activity atomically', async () => {
    const queries: string[] = [];
    const workflow = new PostgresIssueWorkflow({
      query: async <T>(sql: string) => {
        queries.push(sql);
        return { rows: [{ id: 'issue' }] as T[] };
      }
    });
    await expect(
      workflow.transition({ issueId: 'issue', actorUserId: 'actor', status: 'resolved' })
    ).resolves.toBe(true);
    expect(queries[0]).toContain('WITH changed');
    expect(queries[0]).toContain('error_issue_activity');
  });
});
