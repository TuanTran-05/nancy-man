import { createHmac } from 'node:crypto';

export type FingerprintKey = Readonly<{
  version: string;
  secret: Buffer;
}>;

function keyBytes(secret: string | Uint8Array): Buffer {
  const bytes = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret);
  if (bytes.length === 0) throw new Error('FINGERPRINT_KEY_EMPTY');
  return bytes;
}

export function createFingerprintKey(secret: string | Uint8Array, version = 'v1'): FingerprintKey {
  if (!/^v[0-9]+$/u.test(version)) throw new Error('FINGERPRINT_KEY_VERSION_INVALID');
  return { version, secret: keyBytes(secret) };
}

export function hmacFingerprint(key: FingerprintKey, domain: string, bytes: Uint8Array): string {
  const digest = createHmac('sha256', key.secret)
    .update(Buffer.from(domain, 'utf8'))
    .update(Buffer.from(bytes))
    .digest('hex');
  return `hmac-sha256:${key.version}:${digest}`;
}

export function fingerprintSource(
  key: FingerprintKey,
  sourceId: string,
  sourceBytes: Uint8Array
): string {
  return hmacFingerprint(key, sourceId, sourceBytes);
}

export function fingerprintValue(
  key: FingerprintKey,
  catalogId: string,
  valueBytes: Uint8Array
): string {
  return hmacFingerprint(key, catalogId, valueBytes);
}

export const sourceFingerprint = fingerprintSource;
export const valueFingerprint = fingerprintValue;
