import { describe, expect, it } from 'vitest';
import { PostgresOwnerBootstrapRepository } from './postgresOwnerBootstrapRepository.js';
describe('PostgresOwnerBootstrapRepository', () => {
  it('creates owner, credential and enrollment hash atomically with parameters', async () => {
    const startedAt = Date.now();
    let sql = '';
    let parameters: readonly unknown[] = [];
    const repository = new PostgresOwnerBootstrapRepository({
      query: async <T>(statement, values: readonly unknown[] = []) => {
        sql = statement;
        parameters = values;
        return { rows: [{ id: 'user-id' }] as T[] };
      }
    });
    await expect(
      repository.createPendingOwner({
        username: 'owner',
        email: 'o@test',
        displayName: 'Owner',
        passwordHash: '$argon2id$secret',
        passwordFingerprint: 'a'.repeat(64),
        status: 'pending_mfa',
        enrollmentTokenHash: 'b'.repeat(64)
      })
    ).resolves.toEqual({ id: 'user-id' });
    expect(sql).toContain('ops_mfa_enrollment_tokens');
    expect(sql).toContain('ops_password_credentials');
    expect(sql).not.toContain('$argon2id$secret');
    expect(parameters).toContain('$argon2id$secret');
    const expiry = Date.parse(String(parameters.at(-1)));
    expect(expiry).toBeGreaterThanOrEqual(startedAt + 24 * 60 * 60 * 1_000 - 1_000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1_000 + 1_000);
  });
});
