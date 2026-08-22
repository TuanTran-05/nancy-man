import { randomUUID } from 'node:crypto';

type Database = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};
type Status = 'acknowledged' | 'investigating' | 'resolved' | 'ignored';

export class PostgresIssueWorkflow {
  constructor(private readonly database: Database) {}
  async transition(input: {
    issueId: string;
    actorUserId: string;
    status: Status;
  }): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `WITH changed AS (
         UPDATE error_issues SET status = $3,
           acknowledged_at = CASE WHEN $3 = 'acknowledged' THEN now() ELSE acknowledged_at END,
           resolved_at = CASE WHEN $3 = 'resolved' THEN now() ELSE resolved_at END,
           ignored_at = CASE WHEN $3 = 'ignored' THEN now() ELSE ignored_at END
         WHERE id = $1 RETURNING id
       ) INSERT INTO error_issue_activity (id, issue_id, actor_user_id, activity_type, occurred_at)
       SELECT $4, id, $2, $3, now() FROM changed RETURNING issue_id AS id`,
      [input.issueId, input.actorUserId, input.status, randomUUID()]
    );
    return rows.length === 1;
  }

  async assign(input: {
    issueId: string;
    actorUserId: string;
    assignedUserId: string | null;
  }): Promise<boolean> {
    const activityId = randomUUID();
    const { rows } = input.assignedUserId
      ? await this.database.query<{ id: string }>(
          `WITH active_assignee AS (
             SELECT user_record.id
             FROM ops_users AS user_record
             WHERE user_record.id = $3 AND user_record.status = 'active'
           ), changed AS (
             UPDATE error_issues SET assigned_user_id = $3
             WHERE id = $1 AND EXISTS (SELECT 1 FROM active_assignee)
             RETURNING id
           ) INSERT INTO error_issue_activity (
             id, issue_id, actor_user_id, activity_type, occurred_at, metadata
           ) SELECT $4, id, $2, 'assigned', now(), jsonb_build_object('assignedUserId', $3)
             FROM changed RETURNING issue_id AS id`,
          [input.issueId, input.actorUserId, input.assignedUserId, activityId]
        )
      : await this.database.query<{ id: string }>(
          `WITH changed AS (
             UPDATE error_issues SET assigned_user_id = NULL
             WHERE id = $1 AND assigned_user_id IS NOT NULL
             RETURNING id
           ) INSERT INTO error_issue_activity (
             id, issue_id, actor_user_id, activity_type, occurred_at
           ) SELECT $3, id, $2, 'unassigned', now() FROM changed RETURNING issue_id AS id`,
          [input.issueId, input.actorUserId, activityId]
        );
    return rows.length === 1;
  }

  async comment(input: {
    issueId: string;
    actorUserId: string;
    comment: string;
  }): Promise<boolean> {
    const comment = input.comment.trim();
    if (comment.length < 1 || comment.length > 2_000) return false;
    const { rows } = await this.database.query<{ id: string }>(
      `WITH existing_issue AS (
         SELECT id FROM error_issues WHERE id = $1
       ) INSERT INTO error_issue_activity (
         id, issue_id, actor_user_id, activity_type, occurred_at, comment
       ) SELECT $3, id, $2, 'commented', now(), $4 FROM existing_issue RETURNING issue_id AS id`,
      [input.issueId, input.actorUserId, randomUUID(), comment]
    );
    return rows.length === 1;
  }
}
