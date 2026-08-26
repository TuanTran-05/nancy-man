import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';

const envelopeVersion = 'v1';

function assertKey(encryptionKey: Buffer): void {
  if (encryptionKey.length !== 32) {
    throw new Error('TOTP encryption key must contain exactly 32 bytes');
  }
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function encryptTotpSecret(secret: string, encryptionKey: Buffer): string {
  assertKey(encryptionKey);
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    envelopeVersion,
    initializationVector.toString('base64url'),
    ciphertext.toString('base64url'),
    authTag.toString('base64url')
  ].join('.');
}

export function decryptTotpSecret(encryptedSecret: string, encryptionKey: Buffer): string {
  assertKey(encryptionKey);
  const [version, initializationVector, ciphertext, authTag, extra] = encryptedSecret.split('.');
  if (
    version !== envelopeVersion ||
    !initializationVector ||
    !ciphertext ||
    !authTag ||
    extra !== undefined
  ) {
    throw new Error('TOTP encrypted secret envelope is invalid');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(initializationVector, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function verifyTotp(input: {
  encryptedSecret: string;
  encryptionKey: Buffer;
  token: string;
  timestamp?: number;
}): boolean {
  const secret = decryptTotpSecret(input.encryptedSecret, input.encryptionKey);
  const totp = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 });

  return totp.validate({ token: input.token, timestamp: input.timestamp, window: 1 }) !== null;
}
