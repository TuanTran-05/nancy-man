import { randomUUID } from 'node:crypto';

type Database = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'open' | 'mitigated' | 'resolved';

export type IncidentSummary = {
  id: string;
  incidentKey: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  declaredAt: string;
  linkedIssueCount: number;
};

function newIncidentKey(): string {
  return `INC_${randomUUID().replaceAll('-', '').toUpperCase()}`;
}

export class PostgresIncidentStore {
  constructor(private readonly database: Database) {}

  async create(input: {
    actorUserId: string;
    title: string;
    severity: IncidentSeverity;
    summary?: string;
    issueIds: string[];
  }): Promise<{ id: string; incidentKey: string; linkedIssueCount: number } | null> {
    const issueIds = [...new Set(input.issueIds)];
    const { rows } = await this.database.query<{
      id: string;
      incidentKey: string;
      linkedIssueCount: string | number;
    }>(
      `WITH requested_issue_ids AS (
         SELECT DISTINCT unnest($6::uuid[]) AS id
       ), matched_issue_ids AS (
         SELECT requested_issue_ids.id
         FROM requested_issue_ids
         JOIN error_issues ON error_issues.id = requested_issue_ids.id
       ), valid_request AS (
         SELECT
           (SELECT count(*) FROM requested_issue_ids) =
           (SELECT count(*) FROM matched_issue_ids) AS is_valid
       ), created AS (
         INSERT INTO incidents (
           id, incident_key, title, severity, declared_by_user_id, summary
         ) SELECT $1, $2, $3, $4, $5, $7
           FROM valid_request WHERE is_valid
         RETURNING id, incident_key AS "incidentKey"
       ), linked AS (
         INSERT INTO incident_issues (incident_id, issue_id, linked_by_user_id)
         SELECT created.id, matched_issue_ids.id, $5
         FROM created CROSS JOIN matched_issue_ids
         ON CONFLICT (incident_id, issue_id) DO NOTHING
         RETURNING issue_id
       ) SELECT created.id, created."incidentKey",
           (SELECT count(*) FROM linked) AS "linkedIssueCount"
         FROM created`,
      [
        randomUUID(),
        newIncidentKey(),
        input.title,
        input.severity,
        input.actorUserId,
        issueIds,
        input.summary ?? null
      ]
    );
    const created = rows[0];
    return created
      ? {
          id: created.id,
          incidentKey: created.incidentKey,
          linkedIssueCount: Number(created.linkedIssueCount)
        }
      : null;
  }

  async list(input: { limit: number }): Promise<IncidentSummary[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const { rows } = await this.database.query<
      IncidentSummary & { linkedIssueCount: string | number }
    >(
      `SELECT incidents.id, incidents.incident_key AS "incidentKey", incidents.title,
        incidents.severity, incidents.status, incidents.declared_at AS "declaredAt",
        count(incident_issues.issue_id) AS "linkedIssueCount"
       FROM incidents
       LEFT JOIN incident_issues ON incident_issues.incident_id = incidents.id
       GROUP BY incidents.id
       ORDER BY incidents.declared_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((row) => ({ ...row, linkedIssueCount: Number(row.linkedIssueCount) }));
  }

  async updateStatus(input: {
    incidentId: string;
    status: Exclude<IncidentStatus, 'open'>;
  }): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `UPDATE incidents
       SET status = $2,
         mitigated_at = CASE WHEN $2 = 'mitigated' THEN now() ELSE mitigated_at END,
         resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END
       WHERE id = $1 AND status <> $2
       RETURNING id`,
      [input.incidentId, input.status]
    );
    return rows.length === 1;
  }
}
