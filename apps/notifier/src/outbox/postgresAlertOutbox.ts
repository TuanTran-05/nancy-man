import { randomUUID } from 'node:crypto';

import { scheduleIssueAlerts, type AlertIssue, type AlertRule } from './scheduleAlerts.js';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type RuleRow = {
  id: string;
  minimumSeverity: AlertRule['minimumSeverity'];
  source: string | null;
  errorCode: string | null;
  channel: 'zalo' | 'email';
  recipientReference: string;
};

export class PostgresAlertOutbox {
  constructor(private readonly database: QueryDatabase) {}

  async enqueue(input: {
    issue: AlertIssue;
    event: 'created' | 'regressed' | 'resolved' | 'tick';
    occurredAt: Date;
  }): Promise<void> {
    const { rows } = await this.database.query<RuleRow>(
      `
        SELECT
          id,
          minimum_severity AS "minimumSeverity",
          source,
          error_code AS "errorCode",
          notification_channel AS channel,
          destination_reference AS "recipientReference"
        FROM alert_rules
        WHERE enabled = true
      `
    );
    const rules: AlertRule[] = rows.map((rule) => ({
      id: rule.id,
      minimumSeverity: rule.minimumSeverity,
      ...(rule.source ? { source: rule.source } : {}),
      ...(rule.errorCode ? { errorCode: rule.errorCode } : {}),
      channel: rule.channel,
      recipientReference: rule.recipientReference
    }));
    const deliveries = scheduleIssueAlerts({ ...input, rules });
    for (const delivery of deliveries) {
      await this.database.query(
        `
          INSERT INTO alert_deliveries (
            id,
            issue_id,
            alert_rule_id,
            delivery_kind,
            notification_channel,
            requested_at,
            metadata,
            dedup_key
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          ON CONFLICT (dedup_key) DO NOTHING
        `,
        [
          randomUUID(),
          input.issue.id,
          delivery.ruleId,
          delivery.kind,
          delivery.channel,
          delivery.deliverAt,
          JSON.stringify({ recipientReference: delivery.recipientReference }),
          delivery.dedupKey
        ]
      );
    }
  }
}
