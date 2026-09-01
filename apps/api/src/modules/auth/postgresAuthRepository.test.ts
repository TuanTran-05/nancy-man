import { describe, expect, it } from 'vitest';

import { PostgresOpsAuthRepository } from './postgresAuthRepository.js';

describe('PostgresOpsAuthRepository', () => {
  it('returns the stored UTF-8 TOTP envelope for challenge verification', async () => {
    let statement = '';
    const repository = new PostgresOpsAuthRepository({
      query: async <T>(sql: string) => {
        statement = sql;
        return {
          rows: [
            {
              id: 'challenge-id',
              userId: 'user-id',
              role: 'ops_owner',
              encryptedTotpSecret: 'v1.iv.ciphertext.tag'
            }
          ] as T[]
        };
      }
    });

    await expect(
      repository.findTotpChallenge({
        challengeHash: 'a'.repeat(64),
        factorId: 'factor-id',
        ipHash: 'b'.repeat(64)
      })
    ).resolves.toMatchObject({ encryptedTotpSecret: 'v1.iv.ciphertext.tag' });
    expect(statement).toContain("convert_from(factor.encrypted_secret, 'UTF8')");
    expect(statement).not.toContain("encode(factor.encrypted_secret, 'base64')");
  });

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
                loginBlockedUntil: null,
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

  it('records only a login cooldown after five failed attempts in fifteen minutes', async () => {
    const calls: string[] = [];
    const repository = new PostgresOpsAuthRepository({
      query: async <T>(sql: string) => {
        calls.push(sql);
        if (sql.includes('SET login_blocked_until')) return { rows: [{ id: 'user-id' }] as T[] };
        return { rows: [] as T[] };
      }
    });
    await repository.recordLoginEvent({
      userId: 'user-id',
      outcome: 'failed',
      ipHash: 'a'.repeat(64),
      userAgent: 'agent',
      reasonCode: 'INVALID_MFA'
    });
    expect(calls.join('\n')).toContain("interval '15 minutes'");
    expect(calls.join('\n')).toContain("interval '30 minutes'");
    expect(calls.join('\n')).toContain('login_blocked_until');
    expect(calls.join('\n')).not.toContain("SET status = 'locked'");
    expect(calls.filter((sql) => sql.includes('INSERT INTO ops_login_events'))).toHaveLength(2);
  });
});
