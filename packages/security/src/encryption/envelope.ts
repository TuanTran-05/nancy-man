import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from 'node:crypto';

const envelopeVersion = 'v1';
const initializationVectorBytes = 12;

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('Encryption key must contain exactly 32 bytes');
}

function assertAssociatedData(associatedData: string): void {
  if (!associatedData || associatedData.length > 1_024) {
    throw new Error('Encryption associated data is invalid');
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Encrypted envelope is invalid');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || decoded.toString('base64url') !== value) {
    throw new Error('Encrypted envelope is invalid');
  }
  return decoded;
}

export function encryptEnvelope(input: {
  plaintext: string | Buffer;
  key: Buffer;
  associatedData: string;
  randomBytes?: (size: number) => Buffer;
}): string {
  assertKey(input.key);
  assertAssociatedData(input.associatedData);
  const plaintext = Buffer.isBuffer(input.plaintext)
    ? input.plaintext
    : Buffer.from(input.plaintext, 'utf8');
  if (plaintext.length === 0) throw new Error('Encryption plaintext is required');
  const initializationVector = (input.randomBytes ?? nodeRandomBytes)(initializationVectorBytes);
  if (initializationVector.length !== initializationVectorBytes) {
    throw new Error('Encryption random source is invalid');
  }
  const cipher = createCipheriv('aes-256-gcm', input.key, initializationVector);
  cipher.setAAD(Buffer.from(input.associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    envelopeVersion,
    initializationVector.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url')
  ].join('.');
}

export function decryptEnvelope(input: {
  envelope: string;
  key: Buffer;
  associatedData: string;
}): string {
  assertKey(input.key);
  assertAssociatedData(input.associatedData);
  const [version, initializationVector, ciphertext, authTag, extra] = input.envelope.split('.');
  if (
    version !== envelopeVersion ||
    !initializationVector ||
    !ciphertext ||
    !authTag ||
    extra !== undefined
  ) {
    throw new Error('Encrypted envelope is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    input.key,
    decodeBase64Url(initializationVector)
  );
  decipher.setAAD(Buffer.from(input.associatedData, 'utf8'));
  decipher.setAuthTag(decodeBase64Url(authTag));
  return Buffer.concat([decipher.update(decodeBase64Url(ciphertext)), decipher.final()]).toString(
    'utf8'
  );
}
