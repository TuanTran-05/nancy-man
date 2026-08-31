import { TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';
import { decryptTotpSecret } from '../../../../../packages/security/src/mfa/totp.js';
import { TotpEnrollmentService } from './totpEnrollment.js';
describe('TotpEnrollmentService', () => {
  it('activates a pending account only after a valid OTP', async () => {
    const key = Buffer.alloc(32, 7);
    let pending: { encryptedSecret: string; tokenHash: string; factorId: string } | undefined;
    const service = new TotpEnrollmentService({
      encryptionKey: key,
      passwordFingerprintPepper: 'fingerprint-pepper',
      now: () => new Date('2026-08-22T03:14:00.000Z'),
      hashPassword: async (password) => `$argon2id$${password}`,
      passwordFingerprint: (password, pepper) => `${password}:${pepper}`,
      repository: {
        createPendingFactor: async (input) => {
          pending = input;
          return true;
        },
        findPendingFactor: async (input) =>
          input.tokenHash === pending?.tokenHash && input.factorId === pending?.factorId
            ? pending.encryptedSecret
            : null,
        activate: async (input) =>
          input.tokenHash === pending?.tokenHash &&
          input.factorId === pending?.factorId &&
          input.passwordHash.includes('$argon2id$') &&
          input.passwordFingerprint === 'a-strong-new-password:fingerprint-pepper'
      }
    });
    const start = await service.start({ userId: 'user-id', token: 'enrollment-token' });
    if (!start || !pending) throw new Error('pending factor expected');
    const otp = new TOTP({ secret: decryptTotpSecret(pending.encryptedSecret, key) }).generate({
      timestamp: Date.parse('2026-08-22T03:14:00.000Z')
    });
    await expect(
      service.verify({
        userId: 'user-id',
        token: 'enrollment-token',
        factorId: start.factorId,
        otp,
        password: 'a-strong-new-password'
      })
    ).resolves.toBe(true);
    await expect(
      service.verify({
        userId: 'user-id',
        token: 'wrong',
        factorId: start.factorId,
        otp,
        password: 'a-strong-new-password'
      })
    ).resolves.toBe(false);
  });

  it('rejects a password that violates policy before writing any credential', async () => {
    let activated = false;
    const service = new TotpEnrollmentService({
      encryptionKey: Buffer.alloc(32, 7),
      passwordFingerprintPepper: 'fingerprint-pepper',
      repository: {
        createPendingFactor: async () => true,
        findPendingFactor: async () => ({ encryptedSecret: 'not-used' }),
        activate: async () => {
          activated = true;
          return true;
        }
      },
      validatePasswordPolicy: () => {
        throw new Error('PASSWORD_POLICY');
      }
    });

    await expect(
      service.verify({
        userId: 'user-id',
        token: 'token',
        factorId: 'factor-id',
        otp: '123456',
        password: 'weak'
      })
    ).resolves.toBe(false);
    expect(activated).toBe(false);
  });
});
