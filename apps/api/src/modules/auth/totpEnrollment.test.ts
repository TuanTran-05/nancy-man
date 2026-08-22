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
      now: () => new Date('2026-08-22T03:14:00.000Z'),
      repository: {
        createPendingFactor: async (input) => {
          pending = input;
          return true;
        },
        activate: async (input) =>
          input.tokenHash === pending?.tokenHash && input.factorId === pending?.factorId
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
        encryptedSecret: pending.encryptedSecret,
        otp
      })
    ).resolves.toBe(true);
    await expect(
      service.verify({
        userId: 'user-id',
        token: 'wrong',
        factorId: start.factorId,
        encryptedSecret: pending.encryptedSecret,
        otp
      })
    ).resolves.toBe(false);
  });
});
