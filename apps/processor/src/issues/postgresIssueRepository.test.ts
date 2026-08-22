import { describe, expect, it } from 'vitest';

import { PostgresIssueRepository } from './postgresIssueRepository.js';

type Query = <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;

function transactionalDatabase(query: Query) {
  return {
    query,
    transaction: async <T>(operation: (database: { query: Query }) => Promise<T>) => {
      await query('BEGIN');
      try {
        const result = await operation({ query });
        await query('COMMIT');
        return result;
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    }
  };
}

describe('PostgresIssueRepository', () => {
  it('binds every issue write to the transaction-scoped connection', async () => {
    const rootQueries: string[] = [];
    const transactionQueries: string[] = [];
    const escapedRootQuery: Query = async (sql) => {
      rootQueries.push(sql);
      throw new Error('An issue write escaped its transaction connection');
    };
    const repository = new PostgresIssueRepository({
      query: escapedRootQuery,
      transaction: async <T>(operation: (database: { query: Query }) => Promise<T>) =>
        operation({ query: transactionQuery })
    });

    async function transactionQuery<T>(sql: string) {
      transactionQueries.push(sql);
      return { rows: [] as T[] };
    }

    await expect(
      repository.withTransaction(async (transaction) => transaction.findIssue('sha256:abc'))
    ).resolves.toBeNull();
    expect(rootQueries).toEqual([]);
    expect(transactionQueries).toEqual([expect.stringContaining('FOR UPDATE')]);
  });

  it('uses a transaction, locked fingerprint lookup and idempotent affected-user registry', async () => {
    const queries: string[] = [];
    const repository = new PostgresIssueRepository(
      transactionalDatabase(async <T>(sql: string) => {
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
      })
    );

    await repository.withTransaction(async (transaction) => {
      await transaction.findIssue('sha256:abc');
      const created = await transaction.createIssue({
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
      await transaction.insertOccurrence({
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
