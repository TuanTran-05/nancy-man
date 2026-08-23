import { createHmac, randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid Base32 TOTP seed');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSeed(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(seed: string, counter: number): string {
  const key = base32Decode(seed);
  const movingFactor = Buffer.alloc(8);
  movingFactor.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(movingFactor).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(seed: string, token: string, at: Date = new Date()): boolean {
  if (!/^\d{6}$/u.test(token)) return false;
  const counter = Math.floor(at.getTime() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if (totpCode(seed, counter + delta) === token) return true;
  }
  return false;
}

export function enrollmentUri(username: string, seed: string): string {
  return `otpauth://totp/ThienUy%20Ops:${encodeURIComponent(username)}?secret=${seed}&issuer=ThienUy%20Ops&digits=6&period=30`;
}
