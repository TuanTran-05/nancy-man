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
}
