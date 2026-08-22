import { describe, expect, it } from 'vitest';

import { planIssueAlerts } from './alertPolicy.js';

const now = new Date('2026-08-22T08:00:00.000Z');

describe('alert policy', () => {
  it('notifies a new Critical issue immediately, then reminds and escalates if unacknowledged', () => {
    const issue = {
      id: 'ISS_01K3ZABCDEF0123456789ABCDE',
      severity: 'critical' as const,
      status: 'new' as const,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: 1
    };

    expect(planIssueAlerts({ issue, now, event: 'created' })).toEqual([
      expect.objectContaining({ kind: 'new', deliverAt: now, dedupKey: `${issue.id}:new` })
    ]);
    expect(
      planIssueAlerts({ issue, now: new Date('2026-08-22T08:05:00.000Z'), event: 'tick' })
    ).toEqual([expect.objectContaining({ kind: 'reminder', dedupKey: `${issue.id}:reminder:1` })]);
    expect(
      planIssueAlerts({ issue, now: new Date('2026-08-22T08:15:00.000Z'), event: 'tick' })
    ).toEqual([expect.objectContaining({ kind: 'escalation', dedupKey: `${issue.id}:escalation:1` })]);
  });

  it('aggregates a new High issue for five minutes and gives resolved/regressed distinct idempotency keys', () => {
    const issue = {
      id: 'ISS_01K3ZABCDEF0123456789ABCDE',
      severity: 'high' as const,
      status: 'new' as const,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: 1
    };

    expect(planIssueAlerts({ issue, now, event: 'created' })).toEqual([
      expect.objectContaining({
        kind: 'digest',
        deliverAt: new Date('2026-08-22T08:05:00.000Z'),
        dedupKey: `${issue.id}:digest:2026-08-22T08:05`
      })
    ]);
    expect(planIssueAlerts({ issue, now, event: 'resolved' })).toEqual([
      expect.objectContaining({ kind: 'resolved', dedupKey: `${issue.id}:resolved:2026-08-22T08:00` })
    ]);
    expect(planIssueAlerts({ issue, now, event: 'regressed' })).toEqual([
      expect.objectContaining({ kind: 'regressed', dedupKey: `${issue.id}:regressed:2026-08-22T08:00` })
    ]);
  });
});
