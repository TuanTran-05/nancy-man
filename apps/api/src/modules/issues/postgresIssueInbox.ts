type Database = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type IssueRow = {
  id: string;
  fingerprint: string;
  title: string;
  errorCode: string | null;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number | string;
  affectedUserCount: number | string;
};

export type InboxIssue = Omit<IssueRow, 'occurrenceCount' | 'affectedUserCount'> & {
  occurrenceCount: number;
  affectedUserCount: number;
};

export class PostgresIssueInbox {
  constructor(private readonly database: Database) {}
  async list(input: { limit: number }): Promise<InboxIssue[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const { rows } = await this.database.query<IssueRow>(
      `SELECT id, fingerprint, title, error_code AS "errorCode", source, severity, status,
        first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt",
        occurrence_count AS "occurrenceCount", affected_user_count AS "affectedUserCount"
       FROM error_issues ORDER BY last_seen_at DESC LIMIT $1`,
      [limit + 1]
    );
    return rows.slice(0, limit).map((row) => ({
      ...row,
      occurrenceCount: Number(row.occurrenceCount),
      affectedUserCount: Number(row.affectedUserCount)
    }));
  }

  async detail(issueId: string): Promise<{ issue: InboxIssue; events: unknown[] } | null> {
    const issueRows = await this.listById(issueId);
    const issue = issueRows[0];
    if (!issue) return null;
    const { rows: events } = await this.database.query(
      `SELECT event_id AS "eventId", occurred_at AS "occurredAt", source, severity,
        user_reference AS "userReference", route, method, http_status AS "httpStatus",
        error_code AS "errorCode", exception_type AS "exceptionType", safe_message AS "safeMessage",
        stack_trace AS "stackTrace", component_stack AS "componentStack", request_id AS "requestId"
       FROM error_events WHERE issue_id = $1 ORDER BY occurred_at DESC LIMIT 50`,
      [issueId]
    );
    return { issue, events };
  }

  private async listById(issueId: string): Promise<InboxIssue[]> {
    const { rows } = await this.database.query<IssueRow>(
      `SELECT id, fingerprint, title, error_code AS "errorCode", source, severity, status,
        first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", occurrence_count AS "occurrenceCount", affected_user_count AS "affectedUserCount"
       FROM error_issues WHERE id = $1 LIMIT 1`,
      [issueId]
    );
    return rows.map((row) => ({
      ...row,
      occurrenceCount: Number(row.occurrenceCount),
      affectedUserCount: Number(row.affectedUserCount)
    }));
  }
}
