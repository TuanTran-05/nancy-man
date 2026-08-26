import { describe, expect, it } from 'vitest';

import { encryptTotpSecret } from '../../../../../packages/security/src/mfa/totp.js';

import { SqlElevationService } from './sqlElevation.js';

const key = Buffer.alloc(32, 9);

describe('SqlElevationService', () => {
  it('requires a fresh valid TOTP proof before granting a time-bounded SQL elevation', async () => {
    const grants: unknown[] = [];
    const service = new SqlElevationService({
      repository: {
        findActiveTotpFactor: async () => ({
          encryptedSecret: encryptTotpSecret('JBSWY3DPEHPK3PXP', key)
        }),
        grant: async (input) => {
          grants.push(input);
          return true;
        }
      },
      encryptionKey: key,
      now: () => new Date('2026-08-22T10:00:00.000Z'),
      issueId: () => 'elevation-id',
      verifyTotp: () => true
    });

    await expect(
      service.grant({
        userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
        factorId: 'f16f9426-010c-4e06-a459-9fd18c4a442f',
        token: '123456',
        reason: 'Investigate production database error'
      })
    ).resolves.toEqual({
      status: 'granted',
      idleExpiresAt: '2026-08-22T10:15:00.000Z',
      absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
    });
    expect(grants).toEqual([
      expect.objectContaining({
        id: 'elevation-id',
        reason: 'Investigate production database error',
        idleExpiresAt: '2026-08-22T10:15:00.000Z',
        absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
      })
    ]);
  });

  it('does not grant elevation when the TOTP factor is absent or invalid', async () => {
    const service = new SqlElevationService({
      repository: {
        findActiveTotpFactor: async () => null,
        grant: async () => {
          throw new Error('must not grant');
        }
      },
      encryptionKey: key,
      verifyTotp: () => false
    });

    await expect(
      service.grant({
        userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
        factorId: 'f16f9426-010c-4e06-a459-9fd18c4a442f',
        token: '123456',
        reason: 'Investigate production database error'
      })
    ).resolves.toEqual({ status: 'denied' });
  });

  it('denies elevation when the session is no longer active at persistence time', async () => {
    const service = new SqlElevationService({
      repository: {
        findActiveTotpFactor: async () => ({
          encryptedSecret: encryptTotpSecret('JBSWY3DPEHPK3PXP', key)
        }),
        grant: async () => false
      },
      encryptionKey: key,
      verifyTotp: () => true
    });

    await expect(
      service.grant({
        userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
        factorId: 'f16f9426-010c-4e06-a459-9fd18c4a442f',
        token: '123456',
        reason: 'Investigate production database error'
      })
    ).resolves.toEqual({ status: 'denied' });
  });
});
