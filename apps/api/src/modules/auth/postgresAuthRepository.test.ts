import { describe, expect, it } from 'vitest';

import { PostgresOpsAuthRepository } from './postgresAuthRepository.js';

describe('PostgresOpsAuthRepository', () => {
  it('uses parameterized queries and consumes a verified MFA challenge atomically with session creation', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresOpsAuthRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        if (sql.includes('jsonb_agg')) {
          return {
            rows: [
              {
                id: 'user-id',
                username: 'ops.owner',
                displayName: 'Ops Owner',
                role: 'ops_owner',
                status: 'active',
                passwordHash: '$argon2id$encoded',
                mfaFactors: [{ id: 'factor-id', type: 'totp', label: 'Authenticator' }]
              }
            ] as T[]
          };
        }
        if (sql.includes('WITH consumed_challenge'))
          return { rows: [{ authenticated: true }] as T[] };
        return { rows: [] as T[] };
      }
    });

    await expect(repository.findPasswordCredential('ops.owner')).resolves.toMatchObject({
      username: 'ops.owner',
      mfaFactors: [{ id: 'factor-id', type: 'totp' }]
    });
    await expect(
      repository.consumeMfaChallengeAndCreateSession({
        challengeHash: 'a'.repeat(64),
        sessionId: 'session-id',
        userId: 'user-id',
        sessionHash: 'b'.repeat(64),
        csrfSecretHash: 'c'.repeat(64),
        idleExpiresAt: '2026-08-22T03:44:00.000Z',
        absoluteExpiresAt: '2026-08-22T15:14:00.000Z',
        ipHash: 'd'.repeat(64),
        userAgent: 'test-agent',
        loginEventId: 'event-id'
      })
    ).resolves.toBe(true);

    expect(calls[0]).toMatchObject({ parameters: ['ops.owner'] });
    const consume = calls.at(-1);
    expect(consume?.sql).toContain('WITH consumed_challenge');
    expect(consume?.sql).toContain('INSERT INTO ops_sessions');
    expect(consume?.parameters).toContain('session-id');
  });
});
