import { describe, expect, it } from 'vitest';

import { PostgresStepUpRepository } from './postgresStepUpRepository.js';

describe('PostgresStepUpRepository', () => {
  it('returns the stored UTF-8 TOTP envelope for step-up verification', async () => {
    let statement = '';
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string) => {
        statement = sql;
        return {
          rows: [
            {
              passwordHash: '$argon2id$encoded',
              encryptedTotpSecret: 'v1.iv.ciphertext.tag'
            }
          ] as T[]
        };
      }
    });

    await expect(
      repository.findProof({ userId: 'user-id', factorId: 'factor-id' })
    ).resolves.toMatchObject({ encryptedTotpSecret: 'v1.iv.ciphertext.tag' });
    expect(statement).toContain("convert_from(factor.encrypted_secret, 'UTF8')");
    expect(statement).not.toContain("encode(factor.encrypted_secret, 'base64')");
  });

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
