import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  if (!password || password.length < 12) throw new Error('Password must be at least 12 characters');
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$v=1$N=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}$salt=${salt.toString('base64url')}$hash=${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  try {
    const fields = encoded.split('$');
    if (fields.length !== 7 || fields[0] !== 'scrypt' || fields[1] !== 'v=1') return false;
    const n = Number(fields[2].slice(2));
    const r = Number(fields[3].slice(2));
    const p = Number(fields[4].slice(2));
    const salt = Buffer.from(fields[5].slice(5), 'base64url');
    const expected = Buffer.from(fields[6].slice(5), 'base64url');
    if (
      !Number.isInteger(n) ||
      !Number.isInteger(r) ||
      !Number.isInteger(p) ||
      salt.length !== 16 ||
      expected.length !== SCRYPT_KEY_LENGTH
    )
      return false;
    const actual = scryptSync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function encryptSecret(secret: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(encoded: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const fields = encoded.split('.');
  if (fields.length !== 4 || fields[0] !== 'v1') throw new Error('Unsupported encrypted secret');
  const iv = Buffer.from(fields[1], 'base64url');
  const tag = Buffer.from(fields[2], 'base64url');
  const ciphertext = Buffer.from(fields[3], 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
