import { describe, expect, it } from 'vitest';

import { PostgresStepUpRepository } from './postgresStepUpRepository.js';

describe('PostgresStepUpRepository', () => {
  it('uses the typed elevation table and atomically consumes one-use grants', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        if (sql.includes('RETURNING id')) return { rows: [{ id: 'grant-id' }] as T[] };
        return { rows: [] as T[] };
      }
    });

    await repository.consume({
      grantId: 'grant-id',
      capability: 'accounts_write',
      userId: 'user-id',
      sessionId: 'session-id',
      ipHash: 'a'.repeat(64),
      userAgentHash: 'b'.repeat(64)
    });
    const sql = calls.map(({ sql: value }) => value).join('\n');
    expect(sql).toContain('ops_secret_elevations');
    expect(sql).toContain('consumed_at IS NULL');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > now()');
    expect(sql).not.toMatch(/password_hash|encrypted_totp|cleartext/iu);
  });
});
