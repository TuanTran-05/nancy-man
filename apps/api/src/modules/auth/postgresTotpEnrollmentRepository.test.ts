import { describe, expect, it } from 'vitest';
import { PostgresTotpEnrollmentRepository } from './postgresTotpEnrollmentRepository.js';
describe('PostgresTotpEnrollmentRepository', () => {
  it('requires unexpired token and activates account atomically', async () => {
    const calls: string[] = [];
    const repo = new PostgresTotpEnrollmentRepository({
      query: async <T>(sql: string) => {
        calls.push(sql);
        return { rows: [{ id: 'factor' }] as T[] };
      }
    });
    await expect(
      repo.createPendingFactor({
        userId: 'u',
        tokenHash: 'a'.repeat(64),
        factorId: 'f',
        encryptedSecret: 'v1.secret'
      })
    ).resolves.toBe(true);
    await expect(
      repo.activate({ userId: 'u', tokenHash: 'a'.repeat(64), factorId: 'f' })
    ).resolves.toBe(true);
    expect(calls.join('\n')).toContain("status='active'");
    expect(calls.join('\n')).toContain('used_at=now()');
  });
});
