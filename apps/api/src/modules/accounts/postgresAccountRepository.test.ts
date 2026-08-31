import { describe, expect, it } from 'vitest';

import { PostgresAccountRepository } from './postgresAccountRepository.js';

describe('PostgresAccountRepository', () => {
  it('locks actor and target and revokes access state in account transactions', async () => {
    const calls: string[] = [];
    const repository = new PostgresAccountRepository({
      transaction: async <T>(operation: (database: { query: <R>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: R[] }> }) => Promise<T>) =>
        operation({
          query: async <R>(sql: string) => {
            calls.push(sql);
            return { rows: [{ id: 'target-id', username: 'target' }] as R[] };
          }
        })
    });

    await expect(repository.lock({ actorUserId: 'actor-id', targetUserId: 'target-id', reason: 'OWNER_LOCK' })).resolves.toBe(true);
    const sql = calls.join('\n');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('ops_sessions');
    expect(sql).toContain('ops_mfa_login_challenges');
    expect(sql).toContain('ops_secret_elevations');
    expect(sql).toContain('ops_mfa_enrollment_tokens');
    expect(sql).toContain('ops_account_events');
    expect(sql).not.toMatch(/password_hash|encrypted_secret/iu);
  });
});
