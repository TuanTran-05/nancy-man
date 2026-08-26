import { describe, expect, it } from 'vitest';

import { PostgresOpsAuditLedger } from './postgresAuditLedger.js';

describe('PostgresOpsAuditLedger', () => {
  it('serializes an append-only hash-chain entry inside one database transaction', async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const ledger = new PostgresOpsAuditLedger({
      database: {
        transaction: async (operation) =>
          operation({
            query: async <T>(sql: string, parameters?: readonly unknown[]) => {
              calls.push({ sql, ...(parameters === undefined ? {} : { parameters }) });
              if (sql.includes('SELECT entry_hash')) {
                return { rows: [{ entryHash: 'a'.repeat(64) }] as T[] };
              }
              return { rows: [] as T[] };
            }
          })
      },
      now: () => new Date('2026-08-22T10:00:00.000Z'),
      issueId: () => 'f16f9426-010c-4e06-a459-9fd18c4a442d'
    });

    const result = await ledger.append({
      actorUserId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
      action: 'sql.previewed',
      subjectType: 'sql_execution',
      subjectId: 'SQL_20260822_000123',
      requestId: 'REQ_01K3',
      ipHash: 'b'.repeat(64),
      metadata: { rowCount: 2, truncated: false }
    });

    expect(result).toEqual({
      id: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
      entryHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(calls[0]?.sql).toContain('pg_advisory_xact_lock');
    expect(calls[1]?.sql).toContain('SELECT entry_hash');
    expect(calls[1]?.sql).toContain('FOR UPDATE');
    expect(calls[2]?.sql).toContain('INSERT INTO ops_audit_entries');
    expect(calls[2]?.parameters).toEqual(
      expect.arrayContaining([
        'f16f9426-010c-4e06-a459-9fd18c4a442d',
        'sql.previewed',
        'sql_execution',
        'SQL_20260822_000123',
        'a'.repeat(64),
        result.entryHash
      ])
    );
  });
});
