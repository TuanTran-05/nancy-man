import { describe, expect, it } from 'vitest';

import { StepUpService, type StepUpRepository } from './stepUpService.js';

const now = new Date('2026-08-31T12:00:00.000Z');
const baseProof = {
  userId: 'user-id',
  sessionId: 'session-id',
  password: 'a-long-unique-passphrase',
  factorId: 'factor-id',
  token: '123456',
  ipHash: 'a'.repeat(64),
  userAgentHash: 'b'.repeat(64)
};

function repository(): StepUpRepository & { grants: Map<string, unknown> } {
  const grants = new Map<string, unknown>();
  return {
    grants,
    findProof: async () => ({ passwordHash: 'password-hash', encryptedTotpSecret: 'totp-secret' }),
    findParentSession: async () => ({ absoluteExpiresAt: '2026-08-31T13:00:00.000Z' }),
    replaceOlder: async () => undefined,
    insert: async (grant) => {
      grants.set(grant.id, grant);
      return true;
    },
    authorize: async ({ grantId }) => (grants.get(grantId) as never) ?? null,
    consume: async ({ grantId }) => {
      const grant = grants.get(grantId) as { consumedAt?: string } | undefined;
      if (!grant || grant.consumedAt) return false;
      (grant as { consumedAt?: string }).consumedAt = now.toISOString();
      return true;
    },
    revoke: async ({ grantId }) => {
      const grant = grants.get(grantId) as { revokedAt?: string } | undefined;
      if (grant) grant.revokedAt = now.toISOString();
    }
  };
}

describe('StepUpService', () => {
  it('issues one accounts_write grant only after password and TOTP and consumes it once', async () => {
    const repositoryValue = repository();
    const service = new StepUpService({
      repository: repositoryValue,
      now: () => now,
      verifyPassword: async () => true,
      verifyTotp: () => true,
      issueId: () => 'grant-id'
    });

    const granted = await service.grant({ capability: 'accounts_write', ...baseProof });
    expect(granted).toMatchObject({
      id: 'grant-id',
      capability: 'accounts_write',
      expiresAt: '2026-08-31T12:05:00.000Z',
      reusable: false
    });
    await expect(
      service.consume({
        grantId: granted.id,
        capability: 'accounts_write',
        userId: baseProof.userId,
        sessionId: baseProof.sessionId,
        ipHash: baseProof.ipHash,
        userAgentHash: baseProof.userAgentHash
      })
    ).resolves.toBe(true);
    await expect(
      service.consume({
        grantId: granted.id,
        capability: 'accounts_write',
        userId: baseProof.userId,
        sessionId: baseProof.sessionId,
        ipHash: baseProof.ipHash,
        userAgentHash: baseProof.userAgentHash
      })
    ).resolves.toBe(false);
  });

  it('authorizes variables_secret repeatedly until expiry or explicit revocation', async () => {
    const repositoryValue = repository();
    const service = new StepUpService({
      repository: repositoryValue,
      now: () => now,
      verifyPassword: async () => true,
      verifyTotp: () => true,
      issueId: () => 'secret-grant'
    });
    const granted = await service.grant({ capability: 'variables_secret', ...baseProof });
    const request = {
      grantId: granted.id,
      capability: 'variables_secret' as const,
      userId: baseProof.userId,
      sessionId: baseProof.sessionId,
      ipHash: baseProof.ipHash,
      userAgentHash: baseProof.userAgentHash
    };

    await expect(service.authorize(request)).resolves.toMatchObject({
      capability: 'variables_secret'
    });
    await expect(service.authorize(request)).resolves.toBeDefined();
    await service.revoke(request);
    await expect(service.authorize(request)).rejects.toMatchObject({ code: 'STEP_UP_REVOKED' });
  });

  it('rejects invalid proof and caps reusable grants at the parent session', async () => {
    const repositoryValue = repository();
    const service = new StepUpService({
      repository: repositoryValue,
      now: () => now,
      verifyPassword: async () => false,
      verifyTotp: () => true,
      issueId: () => 'rejected-grant'
    });

    await expect(service.grant({ capability: 'variables_secret', ...baseProof })).rejects.toMatchObject({
      code: 'STEP_UP_INVALID'
    });
    const accepted = new StepUpService({
      repository: repositoryValue,
      now: () => now,
      verifyPassword: async () => true,
      verifyTotp: () => true,
      issueId: () => 'capped-grant'
    });
    await expect(
      accepted.grant({
        capability: 'variables_secret',
        ...baseProof,
        parentSessionExpiresAt: '2026-08-31T12:05:00.000Z'
      })
    ).resolves.toMatchObject({ expiresAt: '2026-08-31T12:05:00.000Z' });
  });
});
