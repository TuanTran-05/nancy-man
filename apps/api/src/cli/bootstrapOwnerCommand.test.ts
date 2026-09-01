import { describe, expect, it } from 'vitest';

import { runOwnerBootstrap } from './bootstrapOwnerCommand.js';

describe('offline owner bootstrap command', () => {
  const baseInput = {
    publicUrl: 'https://man.thienuy.edu.vn',
    additionalOwner: true,
    interactiveTty: true,
    prompts: ['tuan.dev', 'tuan@example.test', 'Tuan Dev', 'CREATE OWNER'],
    secrets: ['a-strong-owner-password', 'a-strong-owner-password'],
    repository: {
      countActiveOwners: async () => 1,
      createPendingOwner: async () => ({ id: 'owner-id' })
    },
    hashPassword: async () => '$argon2id$encoded',
    passwordFingerprint: (password: string, pepper: string) => `${password}:${pepper}`,
    passwordFingerprintPepper: 'fingerprint-pepper',
    issueEnrollmentToken: () => ({ plainToken: 'one-time-token', tokenHash: 'hashed-token' })
  };

  it('requires an interactive TTY and explicit confirmation', async () => {
    await expect(
      runOwnerBootstrap({ ...baseInput, interactiveTty: false, output: () => undefined })
    ).rejects.toThrow(/TTY/i);

    await expect(
      runOwnerBootstrap({
        ...baseInput,
        prompts: ['tuan.dev', 'tuan@example.test', 'Tuan Dev', 'CANCEL'],
        output: () => undefined
      })
    ).rejects.toThrow(/confirmation/i);
  });

  it('prints the one-time enrollment URL once and never prints the password', async () => {
    const output: string[] = [];
    await expect(
      runOwnerBootstrap({ ...baseInput, output: (line) => output.push(line) })
    ).resolves.toEqual({
      userId: 'owner-id'
    });
    expect(output).toEqual([
      'Enrollment URL: https://man.thienuy.edu.vn/bootstrap/mfa?token=one-time-token&userId=owner-id'
    ]);
    expect(output.join('\n')).not.toContain('a-strong-owner-password');
  });
});
