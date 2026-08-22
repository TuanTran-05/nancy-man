import { describe, expect, it } from 'vitest';

import { scheduleIssueAlerts } from './scheduleAlerts.js';

const issue = {
  id: 'ISS_01K3ZABCDEF0123456789ABCDE',
  severity: 'critical' as const,
  status: 'new' as const,
  source: 'database',
  errorCode: 'DB_UNAVAILABLE',
  firstSeenAt: new Date('2026-08-22T08:00:00.000Z'),
  lastSeenAt: new Date('2026-08-22T08:00:00.000Z'),
  occurrenceCount: 1
};

describe('scheduleIssueAlerts', () => {
  it('creates an immediate, rule-specific delivery for every matching Critical channel', () => {
    const deliveries = scheduleIssueAlerts({
      issue,
      event: 'created',
      occurredAt: issue.firstSeenAt,
      rules: [
        {
          id: 'rule-zalo',
          minimumSeverity: 'critical',
          channel: 'zalo',
          recipientReference: 'on-call-zalo'
        },
        {
          id: 'rule-email',
          minimumSeverity: 'high',
          source: 'database',
          channel: 'email',
          recipientReference: 'on-call@thienuy.edu.vn'
        },
        {
          id: 'rule-not-matched',
          minimumSeverity: 'critical',
          source: 'browser',
          channel: 'email',
          recipientReference: 'ignored@example.test'
        }
      ]
    });

    expect(deliveries).toEqual([
      {
        ruleId: 'rule-zalo',
        channel: 'zalo',
        recipientReference: 'on-call-zalo',
        kind: 'new',
        deliverAt: issue.firstSeenAt,
        dedupKey: `${issue.id}:new:rule-zalo`
      },
      {
        ruleId: 'rule-email',
        channel: 'email',
        recipientReference: 'on-call@thienuy.edu.vn',
        kind: 'new',
        deliverAt: issue.firstSeenAt,
        dedupKey: `${issue.id}:new:rule-email`
      }
    ]);
  });

  it('retains the five-minute High aggregation window and stable delivery key', () => {
    const highIssue = { ...issue, severity: 'high' as const, source: 'api' };
    const [delivery] = scheduleIssueAlerts({
      issue: highIssue,
      event: 'created',
      occurredAt: highIssue.firstSeenAt,
      rules: [
        {
          id: 'rule-email',
          minimumSeverity: 'high',
          channel: 'email',
          recipientReference: 'on-call@thienuy.edu.vn'
        }
      ]
    });

    expect(delivery).toEqual({
      ruleId: 'rule-email',
      channel: 'email',
      recipientReference: 'on-call@thienuy.edu.vn',
      kind: 'digest',
      deliverAt: new Date('2026-08-22T08:05:00.000Z'),
      dedupKey: `${issue.id}:digest:2026-08-22T08:05:rule-email`
    });
  });
});
