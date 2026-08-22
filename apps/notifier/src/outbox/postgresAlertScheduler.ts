import { type AlertIssue } from './scheduleAlerts.js';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type ActivityRow = {
  id: string;
  event: 'created' | 'regressed' | 'resolved';
  occurredAt: Date;
  issueId: string;
  severity: AlertIssue['severity'];
  status: AlertIssue['status'];
  source: string;
  errorCode: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number | string;
};

function issue(row: ActivityRow): AlertIssue {
  return {
    id: row.issueId,
    severity: row.severity,
    status: row.status,
    source: row.source,
    errorCode: row.errorCode,
    firstSeenAt: new Date(row.firstSeenAt),
    lastSeenAt: new Date(row.lastSeenAt),
    occurrenceCount: Number(row.occurrenceCount)
  };
}

export class PostgresAlertScheduler {
  constructor(
    private readonly input: {
      database: QueryDatabase;
      outbox: {
        enqueue: (input: {
          issue: AlertIssue;
          event: 'created' | 'regressed' | 'resolved' | 'tick';
          occurredAt: Date;
        }) => Promise<void>;
      };
    }
  ) {}

  async schedule(now: Date): Promise<void> {
    const activities = await this.input.database.query<ActivityRow>(
      `
        SELECT
          activity.id,
          activity.activity_type AS event,
          activity.occurred_at AS "occurredAt",
          issue.id AS "issueId",
          issue.severity,
          issue.status,
          issue.source,
          issue.error_code AS "errorCode",
          issue.first_seen_at AS "firstSeenAt",
          issue.last_seen_at AS "lastSeenAt",
          issue.occurrence_count AS "occurrenceCount"
        FROM error_issue_activity AS activity
        JOIN error_issues AS issue ON issue.id = activity.issue_id
        WHERE activity.activity_type IN ('created', 'regressed', 'resolved')
          AND issue.status <> 'ignored'
          AND NOT EXISTS (
            SELECT 1
            FROM alert_deliveries AS delivery
            WHERE delivery.issue_id = issue.id
              AND (
                (activity.activity_type = 'created' AND delivery.delivery_kind IN ('new', 'digest'))
                OR (activity.activity_type = 'regressed' AND delivery.delivery_kind = 'regressed')
                OR (activity.activity_type = 'resolved' AND delivery.delivery_kind = 'resolved')
              )
          )
        ORDER BY activity.occurred_at DESC
        LIMIT 100
      `
    );
    for (const activity of activities.rows) {
      await this.input.outbox.enqueue({
        issue: issue(activity),
        event: activity.event,
        occurredAt: new Date(activity.occurredAt)
      });
    }

    const critical = await this.input.database.query<ActivityRow>(
      `
        SELECT
          issue.id AS "issueId",
          issue.severity,
          issue.status,
          issue.source,
          issue.error_code AS "errorCode",
          issue.first_seen_at AS "firstSeenAt",
          issue.last_seen_at AS "lastSeenAt",
          issue.occurrence_count AS "occurrenceCount"
        FROM error_issues AS issue
        WHERE issue.severity = 'critical' AND issue.status = 'new'
        ORDER BY issue.first_seen_at ASC
        LIMIT 100
      `
    );
    for (const candidate of critical.rows) {
      await this.input.outbox.enqueue({ issue: issue(candidate), event: 'tick', occurredAt: now });
    }
  }
}
