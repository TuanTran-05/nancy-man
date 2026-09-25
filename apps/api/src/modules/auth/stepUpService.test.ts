import { describe, expect, it } from 'vitest';

import {
  StepUpService,
  type DatabasePiiStepUpBinding,
  type StepUpGrant,
  type StepUpRepository
} from './stepUpService.js';

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

    await expect(
      service.grant({ capability: 'variables_secret', ...baseProof })
    ).rejects.toMatchObject({
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

  it('issues reusable database_pii grant valid for 10 minutes', async () => {
    const repositoryValue = repository();
    const service = new StepUpService({
      repository: repositoryValue,
      now: () => now,
      verifyPassword: async () => true,
      verifyTotp: () => true,
      issueId: () => 'db-pii-grant'
    });

    const granted = await service.grant({
      capability: 'database_pii',
      subjectDigest: 'd'.repeat(64),
      ...baseProof
    });

    expect(Date.parse(granted.expiresAt) - Date.parse(granted.grantedAt)).toBe(600_000);
    expect(granted.reusable).toBe(true);
    expect(granted.capability).toBe('database_pii');
  });

  it('resolves a reusable database PII grant only for its complete server binding', async () => {
    const repositoryValue = repository() as StepUpRepository & {
      grants: Map<string, unknown>;
      findActiveDatabasePii?: (input: DatabasePiiStepUpBinding) => Promise<StepUpGrant | null>;
    };
    const service = new StepUpService({
      repository: repositoryValue,
      now: () => now,
      verifyPassword: async () => true,
      verifyTotp: () => true,
      issueId: () => 'bound-pii-grant'
    });
    const targetDigest = 'd'.repeat(64);
    const grant = await service.grant({
      capability: 'database_pii',
      subjectDigest: targetDigest,
      ...baseProof
    });
    repositoryValue.findActiveDatabasePii = async () =>
      (repositoryValue.grants.get(grant.id) as StepUpGrant | undefined) ?? null;
    const binding: DatabasePiiStepUpBinding = {
      capability: 'database_pii',
      userId: baseProof.userId,
      sessionId: baseProof.sessionId,
      ipHash: baseProof.ipHash,
      userAgentHash: baseProof.userAgentHash,
      subjectDigest: targetDigest
    };

    await expect(service.authorizeDatabasePii(binding)).resolves.toMatchObject({
      id: 'bound-pii-grant',
      subjectDigest: targetDigest
    });
    for (const mismatch of [
      { userId: 'another-user' },
      { sessionId: 'another-session' },
      { ipHash: 'c'.repeat(64) },
      { userAgentHash: 'e'.repeat(64) },
      { subjectDigest: 'f'.repeat(64) }
    ]) {
      await expect(service.authorizeDatabasePii({ ...binding, ...mismatch })).rejects.toMatchObject(
        { code: 'STEP_UP_REQUIRED' }
      );
    }
  });

  it('activates a pending database PII grant only for its full binding after audit', async () => {
    const received: unknown[] = [];
    const repositoryValue = repository() as StepUpRepository & {
      activateDatabasePiiGrant?: (input: unknown) => Promise<boolean>;
    };
    repositoryValue.activateDatabasePiiGrant = async (input) => {
      received.push(input);
      return true;
    };
    const service = new StepUpService({ repository: repositoryValue });
    const activate = (
      service as unknown as {
        activateDatabasePiiGrant?: (input: {
          grantId: string;
          capability: 'database_pii';
          userId: string;
          sessionId: string;
          ipHash: string;
          userAgentHash: string;
          subjectDigest: string;
        }) => Promise<boolean>;
      }
    ).activateDatabasePiiGrant;

    expect(typeof activate).toBe('function');
    if (!activate) return;
    await expect(
      activate.call(service, {
        grantId: 'grant-id',
        capability: 'database_pii',
        userId: 'user-id',
        sessionId: 'session-id',
        ipHash: 'a'.repeat(64),
        userAgentHash: 'b'.repeat(64),
        subjectDigest: 'c'.repeat(64)
      })
    ).resolves.toBe(true);
    expect(received).toEqual([
      {
        grantId: 'grant-id',
        capability: 'database_pii',
        userId: 'user-id',
        sessionId: 'session-id',
        ipHash: 'a'.repeat(64),
        userAgentHash: 'b'.repeat(64),
        subjectDigest: 'c'.repeat(64)
      }
    ]);
  });
});
