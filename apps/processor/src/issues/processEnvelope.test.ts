import type { TelemetryEnvelopeV1 } from '../../../../packages/contracts/src/telemetry.js';
import { describe, expect, it } from 'vitest';

import { processEnvelope, type IssueProcessorRepository } from './processEnvelope.js';

type FakeIssue = {
  id: string;
  status: 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored' | 'regressed';
  occurrenceCount: number;
  affectedUserCount: number;
};

function envelope(eventId: `EVT_${string}`, userRef = 'USR_1'): TelemetryEnvelopeV1 {
  return {
    schemaVersion: 1,
    eventId,
    idempotencyKey: `idem-${eventId}`,
    capturedAt: '2026-08-22T08:00:00.000Z',
    source: 'browser',
    level: 'error',
    error: {
      name: 'TypeError',
      code: 'STUDENT_LOAD_FAILED',
      safeMessage: 'Failed to load students'
    },
    context: {
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'edutrack-web',
      environment: 'production',
      route: '/students',
      tags: { studentId: userRef }
    }
  };
}

function repository(): IssueProcessorRepository & {
  issues: Map<string, FakeIssue>;
  activities: string[];
  events: Set<string>;
} {
  const issues = new Map<string, FakeIssue>();
  const events = new Set<string>();
  const activities: string[] = [];
  const store: IssueProcessorRepository & {
    issues: Map<string, FakeIssue>;
    activities: string[];
    events: Set<string>;
  } = {
    issues,
    events,
    activities,
    withTransaction: async (operation) => operation(store),
    findIssue: async (fingerprint) => issues.get(fingerprint) ?? null,
    createIssue: async (input) => {
      const issue: FakeIssue = {
        id: `ISS_${String(issues.size + 1).padStart(26, '0')}`,
        status: 'new',
        occurrenceCount: 0,
        affectedUserCount: 0
      };
      issues.set(input.fingerprint, issue);
      activities.push('created');
      return { issue, created: true };
    },
    insertOccurrence: async ({ event }) => {
      if (events.has(event.eventId)) return { inserted: false, newAffectedUser: false };
      events.add(event.eventId);
      return { inserted: true, newAffectedUser: true };
    },
    updateIssue: async (input) => {
      const issue = [...issues.values()].find((candidate) => candidate.id === input.issueId);
      if (!issue) throw new Error('Unknown issue');
      issue.status = input.status;
      issue.occurrenceCount = input.occurrenceCount;
      issue.affectedUserCount = input.affectedUserCount;
    },
    appendActivity: async ({ activityType }) => {
      activities.push(activityType);
    },
    markProcessed: async () => undefined
  };
  return store;
}

describe('processEnvelope', () => {
  it('creates one NEW issue then groups repeat occurrences into it', async () => {
    const store = repository();
    const first = await processEnvelope(
      {
        envelopeId: 'env-1',
        receivedAt: new Date('2026-08-22T08:00:01.000Z'),
        envelope: envelope('EVT_01K3ZABCDEF0123456789ABCDE')
      },
      store
    );
    const repeat = await processEnvelope(
      {
        envelopeId: 'env-2',
        receivedAt: new Date('2026-08-22T08:01:01.000Z'),
        envelope: envelope('EVT_01K3ZABCDEF0123456789ABCDF', 'USR_2')
      },
      store
    );

    expect(repeat.issueId).toBe(first.issueId);
    expect([...store.issues.values()][0]).toMatchObject({
      status: 'new',
      occurrenceCount: 2,
      affectedUserCount: 2
    });
    expect(store.activities).toEqual(['created']);
  });

  it('regresses a resolved issue once, but an ignored issue never emits an alert candidate', async () => {
    const store = repository();
    const first = await processEnvelope(
      {
        envelopeId: 'env-1',
        receivedAt: new Date('2026-08-22T08:00:01.000Z'),
        envelope: envelope('EVT_01K3ZABCDEF0123456789ABCDE')
      },
      store
    );
    const issue = [...store.issues.values()][0];
    if (!issue) throw new Error('Expected issue');
    issue.status = 'resolved';

    await expect(
      processEnvelope(
        {
          envelopeId: 'env-2',
          receivedAt: new Date('2026-08-22T08:01:01.000Z'),
          envelope: envelope('EVT_01K3ZABCDEF0123456789ABCDF')
        },
        store
      )
    ).resolves.toMatchObject({
      issueId: first.issueId,
      stateChange: 'regressed',
      shouldNotify: true
    });
    await processEnvelope(
      {
        envelopeId: 'env-3',
        receivedAt: new Date('2026-08-22T08:02:01.000Z'),
        envelope: envelope('EVT_01K3ZABCDEF0123456789ABCDG')
      },
      store
    );
    expect(store.activities.filter((activity) => activity === 'regressed')).toHaveLength(1);

    issue.status = 'ignored';
    await expect(
      processEnvelope(
        {
          envelopeId: 'env-4',
          receivedAt: new Date('2026-08-22T08:03:01.000Z'),
          envelope: envelope('EVT_01K3ZABCDEF0123456789ABCDH')
        },
        store
      )
    ).resolves.toMatchObject({ shouldNotify: false });
  });

  it('uses source-map frames when available but does not let symbolication block processing', async () => {
    const store = repository();
    const calls: unknown[] = [];
    const mapped = await processEnvelope(
      {
        envelopeId: 'env-source-map',
        receivedAt: new Date('2026-08-22T08:00:01.000Z'),
        envelope: {
          ...envelope('EVT_01K3ZABCDEF0123456789ABCDE'),
          error: {
            name: 'TypeError',
            code: 'STUDENT_LOAD_FAILED',
            safeMessage: 'Failed',
            stack: 'TypeError: failed\n    at a (https://thienuy.edu.vn/assets/app.min.js:1:10)'
          }
        }
      },
      store,
      {
        symbolicate: async (input) => {
          calls.push(input);
          return {
            status: 'symbolicated' as const,
            stackFrames: ['loadStudents (src/Students.tsx:42:9)']
          };
        }
      }
    );

    expect(calls).toEqual([
      {
        serviceName: 'edutrack-web',
        release: '0123456789abcdef0123456789abcdef01234567',
        stack: 'TypeError: failed\n    at a (https://thienuy.edu.vn/assets/app.min.js:1:10)'
      }
    ]);
    expect(mapped.fingerprint).toMatch(/^sha256:/);
  });
});
