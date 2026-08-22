import { describe, expect, it } from 'vitest';

import { PostgresIssueRepository } from './postgresIssueRepository.js';

describe('PostgresIssueRepository', () => {
  it('uses a transaction, locked fingerprint lookup and idempotent affected-user registry', async () => {
    const queries: string[] = [];
    const repository = new PostgresIssueRepository({
      query: async <T>(sql: string) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO error_issues')) {
          return { rows: [{ id: 'fdb575cc-8ff6-4ef7-ae45-0a38d857b1d4' }] as T[] };
        }
        if (sql.includes('INSERT INTO error_events')) {
          return { rows: [{ inserted: true }] as T[] };
        }
        if (sql.includes('INSERT INTO error_issue_affected_users')) {
          return { rows: [{ userReference: 'USR_1' }] as T[] };
        }
        return { rows: [] as T[] };
      }
    });

    await repository.withTransaction(async () => {
      await repository.findIssue('sha256:abc');
      const created = await repository.createIssue({
        fingerprint: 'sha256:abc',
        event: {
          eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
          occurredAt: new Date('2026-08-22T08:00:00.000Z'),
          receivedAt: new Date('2026-08-22T08:00:01.000Z'),
          source: 'browser',
          severity: 'medium',
          errorCode: 'STUDENT_LOAD_FAILED',
          exceptionType: 'TypeError',
          safeMessage: 'failed',
          service: 'edutrack-web',
          release: 'release',
          ingestClientId: 'e4eec74b-9dfd-4ba7-9b6a-3689ccbb9d49',
          tags: {},
          breadcrumbs: [],
          stackFrames: []
        }
      });
      await repository.insertOccurrence({
        issueId: created.issue.id,
        event: {
          eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
          occurredAt: new Date('2026-08-22T08:00:00.000Z'),
          receivedAt: new Date('2026-08-22T08:00:01.000Z'),
          source: 'browser',
          severity: 'medium',
          errorCode: 'STUDENT_LOAD_FAILED',
          exceptionType: 'TypeError',
          safeMessage: 'failed',
          service: 'edutrack-web',
          release: 'release',
          ingestClientId: 'e4eec74b-9dfd-4ba7-9b6a-3689ccbb9d49',
          userRef: 'USR_1',
          tags: {},
          breadcrumbs: [],
          stackFrames: []
        }
      });
    });

    expect(queries).toEqual(
      expect.arrayContaining([
        'BEGIN',
        expect.stringContaining('FOR UPDATE'),
        expect.stringContaining('INSERT INTO error_issues'),
        expect.stringContaining('INSERT INTO error_events'),
        expect.stringContaining('INSERT INTO error_issue_affected_users'),
        'COMMIT'
      ])
    );
  });
});
