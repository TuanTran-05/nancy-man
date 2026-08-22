type AlertIssue = {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored' | 'regressed';
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
};

export type PlannedAlert = {
  kind: 'new' | 'digest' | 'reminder' | 'escalation' | 'resolved' | 'regressed';
  deliverAt: Date;
  dedupKey: string;
  recipientTier: 'on_call' | 'owner';
};

function minuteKey(value: Date): string {
  return value.toISOString().slice(0, 16);
}

export function planIssueAlerts(input: {
  issue: AlertIssue;
  now: Date;
  event: 'created' | 'regressed' | 'resolved' | 'tick';
}): PlannedAlert[] {
  const { issue, now } = input;
  if (issue.status === 'ignored') return [];
  if (input.event === 'resolved') {
    return [
      {
        kind: 'resolved',
        deliverAt: now,
        dedupKey: `${issue.id}:resolved:${minuteKey(now)}`,
        recipientTier: 'on_call'
      }
    ];
  }
  if (input.event === 'regressed') {
    return [
      {
        kind: 'regressed',
        deliverAt: now,
        dedupKey: `${issue.id}:regressed:${minuteKey(now)}`,
        recipientTier: 'on_call'
      }
    ];
  }
  if (input.event === 'created') {
    if (issue.severity === 'critical') {
      return [
        { kind: 'new', deliverAt: now, dedupKey: `${issue.id}:new`, recipientTier: 'on_call' }
      ];
    }
    if (issue.severity === 'high') {
      const deliverAt = new Date(now.getTime() + 5 * 60 * 1_000);
      return [
        {
          kind: 'digest',
          deliverAt,
          dedupKey: `${issue.id}:digest:${minuteKey(deliverAt)}`,
          recipientTier: 'on_call'
        }
      ];
    }
    return [];
  }
  if (input.event === 'tick' && issue.severity === 'critical' && issue.status === 'new') {
    const elapsedMinutes = Math.floor((now.getTime() - issue.firstSeenAt.getTime()) / 60_000);
    if (elapsedMinutes >= 15) {
      return [
        {
          kind: 'escalation',
          deliverAt: now,
          dedupKey: `${issue.id}:escalation:1`,
          recipientTier: 'owner'
        }
      ];
    }
    if (elapsedMinutes >= 5) {
      return [
        {
          kind: 'reminder',
          deliverAt: now,
          dedupKey: `${issue.id}:reminder:1`,
          recipientTier: 'on_call'
        }
      ];
    }
  }
  return [];
}
