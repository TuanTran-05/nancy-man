import { describe, expect, it } from 'vitest';

import { bootstrapOwner } from './bootstrapOwner.js';

describe('offline owner bootstrap', () => {
  const input = {
    username: 'ops.owner',
    email: 'owner@example.test',
    displayName: 'Ops Owner',
    password: 'a-long-unique-passphrase',
    publicUrl: 'https://man.thienuy.edu.vn'
  };

  it('requires an interactive confirmation and refuses a second owner unless explicitly requested', async () => {
    const repository = {
      countActiveOwners: async () => 1,
      createPendingOwner: async () => ({ id: 'unused' })
    };

    await expect(
      bootstrapOwner({
        ...input,
        interactiveConfirmation: false,
        additionalOwner: true,
        repository,
        hashPassword: async () => 'hash',
        passwordFingerprint: () => 'fingerprint',
        issueEnrollmentToken: () => ({ plainToken: 'token', tokenHash: 'hash' })
      })
    ).rejects.toThrow(/TTY confirmation/i);

    await expect(
      bootstrapOwner({
        ...input,
        interactiveConfirmation: true,
        additionalOwner: false,
        repository,
        hashPassword: async () => 'hash',
        passwordFingerprint: () => 'fingerprint',
        issueEnrollmentToken: () => ({ plainToken: 'token', tokenHash: 'hash' })
      })
    ).rejects.toThrow(/active owner/i);
  });

  it('creates a pending-MFA owner and emits only one single-use enrollment URL', async () => {
    const createCalls: unknown[] = [];
    const result = await bootstrapOwner({
      ...input,
      interactiveConfirmation: true,
      additionalOwner: false,
      repository: {
        countActiveOwners: async () => 0,
        createPendingOwner: async (owner) => {
          createCalls.push(owner);
          return { id: 'f16f9426-010c-4e06-a459-9fd18c4a442d' };
        }
      },
      hashPassword: async () => '$argon2id$encoded',
      passwordFingerprint: () => 'fingerprint',
      issueEnrollmentToken: () => ({ plainToken: 'single-use-token', tokenHash: 'hashed-token' })
    });

    expect(createCalls).toEqual([
      expect.objectContaining({ status: 'pending_mfa', passwordHash: '$argon2id$encoded' })
    ]);
    expect(result).toEqual({
      enrollmentUrl:
        'https://man.thienuy.edu.vn/bootstrap/mfa?token=single-use-token&userId=f16f9426-010c-4e06-a459-9fd18c4a442d',
      userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d'
    });
    expect(JSON.stringify(result)).not.toContain(input.password);
  });
});
