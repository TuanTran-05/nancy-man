import { TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';

import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from './totp.js';

const key = Buffer.alloc(32, 7);
const timestamp = Date.parse('2026-08-22T03:14:00.000Z');

describe('TOTP MFA', () => {
  it('encrypts the secret before storage and accepts only the current plus or minus one time step', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret, key);
    const token = new TOTP({ secret }).generate({ timestamp });

    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted, key)).toBe(secret);
    expect(verifyTotp({ encryptedSecret: encrypted, encryptionKey: key, token, timestamp })).toBe(
      true
    );

    const priorToken = new TOTP({ secret }).generate({ timestamp: timestamp - 30_000 });
    expect(
      verifyTotp({ encryptedSecret: encrypted, encryptionKey: key, token: priorToken, timestamp })
    ).toBe(true);

    const staleToken = new TOTP({ secret }).generate({ timestamp: timestamp - 60_000 });
    expect(
      verifyTotp({ encryptedSecret: encrypted, encryptionKey: key, token: staleToken, timestamp })
    ).toBe(false);
  });
});
