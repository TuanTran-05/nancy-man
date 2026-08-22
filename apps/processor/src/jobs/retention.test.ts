import { describe, expect, it } from 'vitest';

import { planEventPartitionRetention } from './retention.js';

describe('event partition retention', () => {
  it('drops only monthly raw/occurrence partitions older than 90 days', () => {
    const plan = planEventPartitionRetention({
      now: new Date('2026-08-22T08:00:00.000Z'),
      partitions: [
        'ingest_envelopes_202604',
        'ingest_envelopes_202605',
        'error_events_202604',
        'error_events_202605',
        'error_issues',
        'incidents',
        'error_issue_activity'
      ]
    });

    expect(plan.drop).toEqual(['error_events_202604', 'ingest_envelopes_202604']);
    expect(plan.keep).toEqual(
      expect.arrayContaining([
        'error_events_202605',
        'ingest_envelopes_202605',
        'error_issues',
        'incidents',
        'error_issue_activity'
      ])
    );
  });

  it('never accepts a partition name outside the append-only raw event families', () => {
    const plan = planEventPartitionRetention({
      now: new Date('2026-12-01T00:00:00.000Z'),
      partitions: ['ops_users_202001', 'error_events_bad', 'ingest_envelopes_202001']
    });

    expect(plan.drop).toEqual(['ingest_envelopes_202001']);
    expect(plan.keep).toEqual(expect.arrayContaining(['ops_users_202001', 'error_events_bad']));
  });
});
