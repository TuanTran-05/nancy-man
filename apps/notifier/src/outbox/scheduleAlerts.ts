import { planIssueAlerts } from '../policy/alertPolicy.js';

type Severity = 'critical' | 'high' | 'medium' | 'low';
type IssueStatus = 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored' | 'regressed';
type DeliveryKind = 'new' | 'digest' | 'reminder' | 'escalation' | 'resolved' | 'regressed';

const severityRank: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

export type AlertRule = {
  id: string;
  minimumSeverity: Severity;
  source?: string;
  errorCode?: string;
  channel: 'zalo' | 'email';
  recipientReference: string;
};

export type AlertIssue = {
  id: string;
  severity: Severity;
  status: IssueStatus;
  source: string;
  errorCode: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
};

function matches(rule: AlertRule, issue: AlertIssue): boolean {
  return (
    severityRank[issue.severity] >= severityRank[rule.minimumSeverity] &&
    (!rule.source || rule.source === issue.source) &&
    (!rule.errorCode || rule.errorCode === issue.errorCode)
  );
}

export function scheduleIssueAlerts(input: {
  issue: AlertIssue;
  event: 'created' | 'regressed' | 'resolved' | 'tick';
  occurredAt: Date;
  rules: readonly AlertRule[];
}): Array<{
  ruleId: string;
  channel: 'zalo' | 'email';
  recipientReference: string;
  kind: DeliveryKind;
  deliverAt: Date;
  dedupKey: string;
}> {
  const planned = planIssueAlerts({
    issue: input.issue,
    now: input.occurredAt,
    event: input.event
  });
  return planned.flatMap((alert) =>
    input.rules
      .filter((rule) => matches(rule, input.issue))
      .map((rule) => ({
        ruleId: rule.id,
        channel: rule.channel,
        recipientReference: rule.recipientReference,
        kind: alert.kind,
        deliverAt: alert.deliverAt,
        dedupKey: `${alert.dedupKey}:${rule.id}`
      }))
  );
}
