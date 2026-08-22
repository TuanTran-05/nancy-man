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

  it('assigns an active operator and appends an assignment activity in one statement', async () => {
    const queries: string[] = [];
    const workflow = new PostgresIssueWorkflow({
      query: async <T>(sql: string) => {
        queries.push(sql);
        return { rows: [{ id: 'issue' }] as T[] };
      }
    });

    await expect(
      workflow.assign({ issueId: 'issue', actorUserId: 'actor', assignedUserId: 'maintainer' })
    ).resolves.toBe(true);
    expect(queries[0]).toContain("user_record.status = 'active'");
    expect(queries[0]).toContain("'assigned'");
    expect(queries[0]).toContain('error_issue_activity');
  });

  it('adds a bounded investigation comment as append-only issue activity', async () => {
    const queries: string[] = [];
    const workflow = new PostgresIssueWorkflow({
      query: async <T>(sql: string) => {
        queries.push(sql);
        return { rows: [{ id: 'issue' }] as T[] };
      }
    });

    await expect(
      workflow.comment({
        issueId: 'issue',
        actorUserId: 'actor',
        comment: 'Reproduced on release 123.'
      })
    ).resolves.toBe(true);
    expect(queries[0]).toContain("'commented'");
    expect(queries[0]).toContain('error_issue_activity');
  });
});
