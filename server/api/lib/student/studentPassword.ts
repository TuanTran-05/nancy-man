import { createHash, createHmac, pbkdf2Sync, randomUUID, timingSafeEqual } from 'crypto';
export { validatePasswordStrength } from '../../../../shared/passwordPolicy.js';

export const PBKDF2_ITERATIONS = 100_000;

export function normalizeLoginDobInput(input: string): string | null {
  if (!input) return null;
  const parts = input.trim().split('/');
  if (parts.length !== 3) return null;

  let [d, m, y] = parts;
  d = d.trim().padStart(2, '0');
  m = m.trim().padStart(2, '0');
  y = y.trim();

  if (y.length !== 4) return null;
  return `${y}-${m}-${d}`;
}

export function studentDobMatches(dobField: string, input: string): boolean {
  if (!dobField || !input) return false;
  const normalized = normalizeLoginDobInput(input);
  return !!normalized && dobField.trim() === normalized;
}

export function hashStudentPassword(password: string): { salt: string; hash: string } {
  const salt = randomUUID();
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return { salt, hash: derived.toString('hex') };
}

export function verifyStudentPassword(
  password: string,
  salt: string,
  hash: string,
  version?: number
): boolean {
  if (version === 2) {
    const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const derivedHex = derived.toString('hex');
    if (derivedHex.length !== hash.length) return false;
    return timingSafeEqual(Buffer.from(derivedHex, 'utf8'), Buffer.from(hash, 'utf8'));
  }

  const legacy = createHash('sha256')
    .update(password + salt)
    .digest('hex');
  if (legacy.length !== hash.length) return false;
  return timingSafeEqual(Buffer.from(legacy, 'utf8'), Buffer.from(hash, 'utf8'));
}

const HMAC_PREFIX = 'hmac:';

function getOtpPepper(): string | undefined {
  return process.env.OTP_PEPPER?.trim() || undefined;
}

export function hashSecret(value: string): string {
  const pepper = getOtpPepper();
  if (!pepper) {
    throw new Error(
      'OTP_PEPPER env var is required for hashing secrets. Set it in your environment.'
    );
  }
  const hmac = createHmac('sha256', pepper).update(value).digest('hex');
  return HMAC_PREFIX + hmac;
}

export function verifySecret(storedHash: string, value: string): boolean {
  const pepper = getOtpPepper();

  // Try HMAC verification first if hash was created with pepper
  if (storedHash.startsWith(HMAC_PREFIX) && pepper) {
    const expected = createHmac('sha256', pepper).update(value).digest('hex');
    const stored = storedHash.slice(HMAC_PREFIX.length);
    if (expected.length !== stored.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(stored, 'utf8'));
  }

  // Plain SHA-256 fallback (legacy hashes or no pepper configured)
  const inputHash = createHash('sha256').update(value).digest('hex');
  if (inputHash.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(inputHash, 'utf8'), Buffer.from(storedHash, 'utf8'));
}
