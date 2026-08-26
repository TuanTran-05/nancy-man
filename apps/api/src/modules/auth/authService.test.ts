import { createHash } from 'node:crypto';

import { encryptTotpSecret } from '../../../../../packages/security/src/mfa/totp.js';
import { describe, expect, it } from 'vitest';

import { OpsAuthService } from './authService.js';

const now = new Date('2026-08-22T03:14:00.000Z');
const mfaKey = Buffer.alloc(32, 7);

describe('OpsAuthService', () => {
  it('only creates a short-lived MFA challenge after an active account proves its password', async () => {
    const recorded: unknown[] = [];
    const challenges: unknown[] = [];
    const service = new OpsAuthService({
      repository: {
        findPasswordCredential: async () => ({
          id: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          username: 'ops.owner',
          displayName: 'Ops Owner',
          role: 'ops_owner',
          status: 'active',
          passwordHash: '$argon2id$encoded',
          mfaFactors: [{ id: 'factor-totp', type: 'totp', label: 'Authenticator' }]
        }),
        recordLoginEvent: async (entry) => recorded.push(entry),
        createMfaChallenge: async (challenge) => challenges.push(challenge),
        findTotpChallenge: async () => null,
        consumeMfaChallengeAndCreateSession: async () => false
      },
      sessionPepper: 'auth-session-pepper',
      mfaEncryptionKey: mfaKey,
      verifyPassword: async () => true,
      now: () => now,
      issueOpaqueToken: () => 'mfa-token'
    });

    await expect(
      service.beginLogin({
        identifier: 'ops.owner',
        password: 'a-long-unique-passphrase',
        ipHash: 'a'.repeat(64),
        userAgent: 'test-agent'
      })
    ).resolves.toEqual({
      status: 'mfa_required',
      mfaChallenge: 'mfa-token',
      factors: [{ id: 'factor-totp', type: 'totp', label: 'Authenticator' }]
    });
    expect(challenges).toEqual([
      expect.objectContaining({
        userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        expiresAt: '2026-08-22T03:19:00.000Z',
        ipHash: 'a'.repeat(64)
      })
    ]);
    expect(JSON.stringify(challenges)).not.toContain('mfa-token');
    expect(recorded).toEqual([]);
  });

  it('creates an HttpOnly session only after a valid TOTP factor consumes its MFA challenge', async () => {
    const createdSessions: unknown[] = [];
    const encryptedSecret = encryptTotpSecret('JBSWY3DPEHPK3PXP', mfaKey);
    const service = new OpsAuthService({
      repository: {
        findPasswordCredential: async () => null,
        recordLoginEvent: async () => undefined,
        createMfaChallenge: async () => undefined,
        findTotpChallenge: async () => ({
          id: 'challenge-id',
          userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          role: 'ops_owner',
          encryptedTotpSecret: encryptedSecret
        }),
        consumeMfaChallengeAndCreateSession: async (input) => {
          createdSessions.push(input);
          return true;
        }
      },
      sessionPepper: 'auth-session-pepper',
      mfaEncryptionKey: mfaKey,
      verifyPassword: async () => false,
      verifyTotp: () => true,
      now: () => now,
      issueOpaqueToken: () => 'session-token',
      issueSessionId: () => 'd4d3e4c2-9f2a-46a9-b338-b8cf12a7cb88'
    });

    const completed = await service.completeTotpLogin({
      mfaChallenge: 'mfa-token',
      factorId: 'factor-totp',
      token: '123456',
      ipHash: 'b'.repeat(64),
      userAgent: 'test-agent'
    });

    expect(completed).toEqual({
      status: 'authenticated',
      sessionToken: 'session-token',
      csrfToken: expect.any(String),
      role: 'ops_owner',
      idleExpiresAt: '2026-08-22T03:44:00.000Z',
      absoluteExpiresAt: '2026-08-22T15:14:00.000Z'
    });
    expect(createdSessions).toEqual([
      expect.objectContaining({
        challengeHash: createHash('sha256')
          .update('ops-mfa-login-v1:mfa-token:auth-session-pepper', 'utf8')
          .digest('hex'),
        sessionHash: createHash('sha256')
          .update('session-tokenauth-session-pepper', 'utf8')
          .digest('hex'),
        csrfSecretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        userAgent: 'test-agent'
      })
    ]);
  });
});
