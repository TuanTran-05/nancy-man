import {
  createCipheriv,
  createDecipheriv,
  randomBytes as generateRandomBytes,
  timingSafeEqual
} from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_FORMAT = 'edutrack-config-agent-envelope';
const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const VERSION_PATTERN = /^v[0-9]+$/u;
const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;

export type EnvelopePurpose = 'staging' | 'snapshot';
export type EnvelopeType = 'draft' | 'staged' | 'snapshot';

export type EnvelopeHeader = Readonly<{
  envelopeType: EnvelopeType;
  purpose: EnvelopePurpose;
  changeId: string;
  appId: string;
  catalogVersion: string;
  manifestVersion: string;
  keyId: string;
  keyVersion: string;
  expiresAt: string;
}>;

export type EnvelopeKey = Readonly<{
  purpose: EnvelopePurpose;
  keyId: string;
  keyVersion: string;
  bytes: Buffer;
}>;

export type EnvelopeKeyInput = Readonly<{
  purpose: EnvelopePurpose;
  keyId: string;
  keyVersion: string;
  bytes: Uint8Array;
}>;

export type EnvelopeCredential = Readonly<{
  path: string;
  purpose: EnvelopePurpose;
  keyId: string;
  keyVersion: string;
  ownerUid?: number;
  groupGid?: number;
}>;

export type EnvelopeErrorCode =
  | 'ENVELOPE_KEY_INVALID'
  | 'ENVELOPE_KEY_REUSED'
  | 'ENVELOPE_HEADER_INVALID'
  | 'ENVELOPE_MALFORMED'
  | 'ENVELOPE_AUTH_FAILED'
  | 'ENVELOPE_KEY_REJECTED'
  | 'ENVELOPE_CONTEXT_MISMATCH'
  | 'ENVELOPE_EXPIRED'
  | 'ENVELOPE_CREDENTIAL_INVALID'
  | 'ENVELOPE_CREDENTIAL_READ_FAILED';

export class EnvelopeError extends Error {
  readonly code: EnvelopeErrorCode;

  constructor(code: EnvelopeErrorCode) {
    super(code);
    this.name = 'EnvelopeError';
    this.code = code;
  }
}

function fail(code: EnvelopeErrorCode): never {
  throw new EnvelopeError(code);
}

function assertId(value: string): void {
  if (!ID_PATTERN.test(value)) fail('ENVELOPE_HEADER_INVALID');
}

function assertVersion(value: string): void {
  if (!VERSION_PATTERN.test(value)) fail('ENVELOPE_HEADER_INVALID');
}

function purposeForType(type: EnvelopeType): EnvelopePurpose {
  return type === 'snapshot' ? 'snapshot' : 'staging';
}

function assertHeader(header: EnvelopeHeader): void {
  const expectedFields = [
    'appId',
    'catalogVersion',
    'changeId',
    'envelopeType',
    'expiresAt',
    'keyId',
    'keyVersion',
    'manifestVersion',
    'purpose'
  ];
  if (Object.keys(header).sort().join(',') !== expectedFields.sort().join(',')) {
    fail('ENVELOPE_HEADER_INVALID');
  }
  if (
    (header.envelopeType !== 'draft' &&
      header.envelopeType !== 'staged' &&
      header.envelopeType !== 'snapshot') ||
    (header.purpose !== 'staging' && header.purpose !== 'snapshot') ||
    purposeForType(header.envelopeType) !== header.purpose
  ) {
    fail('ENVELOPE_HEADER_INVALID');
  }
  assertId(header.changeId);
  assertId(header.appId);
  assertId(header.catalogVersion);
  assertId(header.manifestVersion);
  assertId(header.keyId);
  assertVersion(header.keyVersion);
  const expiry = Date.parse(header.expiresAt);
  if (!Number.isFinite(expiry)) fail('ENVELOPE_HEADER_INVALID');
}

function canonicalHeader(header: EnvelopeHeader): Buffer {
  return Buffer.from(
    JSON.stringify({
      envelopeType: header.envelopeType,
      purpose: header.purpose,
      changeId: header.changeId,
      appId: header.appId,
      catalogVersion: header.catalogVersion,
      manifestVersion: header.manifestVersion,
      keyId: header.keyId,
      keyVersion: header.keyVersion,
      expiresAt: header.expiresAt
    }),
    'utf8'
  );
}

export function createEnvelopeKey(input: EnvelopeKeyInput): EnvelopeKey {
  if (
    (input.purpose !== 'staging' && input.purpose !== 'snapshot') ||
    !ID_PATTERN.test(input.keyId) ||
    !VERSION_PATTERN.test(input.keyVersion) ||
    input.bytes.byteLength !== KEY_BYTES
  ) {
    fail('ENVELOPE_KEY_INVALID');
  }
  return Object.freeze({
    purpose: input.purpose,
    keyId: input.keyId,
    keyVersion: input.keyVersion,
    bytes: Buffer.from(input.bytes)
  });
}

function credentialPath(path: string): void {
  if (!isAbsolute(path) || path === '/' || path.includes('\u0000') || normalize(path) !== path) {
    fail('ENVELOPE_CREDENTIAL_INVALID');
  }
}

export async function loadEnvelopeKey(credential: EnvelopeCredential): Promise<EnvelopeKey> {
  credentialPath(credential.path);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let keyBytes: Buffer | undefined;
  try {
    handle = await open(credential.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    const mode = Number(before.mode) & 0o7777;
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size !== KEY_BYTES ||
      (mode !== 0o400 && mode !== 0o440) ||
      (credential.ownerUid !== undefined && before.uid !== credential.ownerUid) ||
      (credential.groupGid !== undefined && before.gid !== credential.groupGid)
    ) {
      fail('ENVELOPE_CREDENTIAL_INVALID');
    }
    keyBytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.nlink !== 1
    ) {
      fail('ENVELOPE_CREDENTIAL_INVALID');
    }
    return createEnvelopeKey({
      purpose: credential.purpose,
      keyId: credential.keyId,
      keyVersion: credential.keyVersion,
      bytes: keyBytes
    });
  } catch (error) {
    if (error instanceof EnvelopeError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      return fail('ENVELOPE_CREDENTIAL_INVALID');
    }
    return fail('ENVELOPE_CREDENTIAL_READ_FAILED');
  } finally {
    keyBytes?.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

export async function loadEnvelopeKeys(
  credentials: readonly EnvelopeCredential[]
): Promise<EnvelopeKey[]> {
  if (credentials.length === 0) fail('ENVELOPE_CREDENTIAL_INVALID');
  const keys = [] as EnvelopeKey[];
  for (const credential of credentials) keys.push(await loadEnvelopeKey(credential));
  assertDistinctEnvelopeKeys(keys);
  return keys;
}

export function assertDistinctEnvelopeKeys(keys: readonly EnvelopeKey[]): void {
  for (let first = 0; first < keys.length; first += 1) {
    for (let second = first + 1; second < keys.length; second += 1) {
      const left = keys[first];
      const right = keys[second];
      if (!left || !right) continue;
      if (timingSafeEqual(left.bytes, right.bytes)) fail('ENVELOPE_KEY_REUSED');
    }
  }
}

function assertKeyHeaderMatch(key: EnvelopeKey, header: EnvelopeHeader): void {
  if (
    key.purpose !== header.purpose ||
    key.keyId !== header.keyId ||
    key.keyVersion !== header.keyVersion
  ) {
    fail('ENVELOPE_KEY_REJECTED');
  }
}

function normalizedHeader(key: EnvelopeKey, header: EnvelopeHeader): EnvelopeHeader {
  assertHeader(header);
  assertKeyHeaderMatch(key, header);
  return Object.freeze({ ...header });
}

export type EncryptEnvelopeOptions = Readonly<{
  key: EnvelopeKey;
  header: EnvelopeHeader;
  plaintext: Uint8Array;
  randomBytes?: (size: number) => Uint8Array;
}>;

export function encryptEnvelope(options: EncryptEnvelopeOptions): Buffer {
  const header = normalizedHeader(options.key, options.header);
  const randomBytes = options.randomBytes ?? generateRandomBytes;
  const nonce = Buffer.from(randomBytes(NONCE_BYTES));
  if (nonce.length !== NONCE_BYTES) fail('ENVELOPE_KEY_INVALID');

  const cipher = createCipheriv(ALGORITHM, options.key.bytes, nonce);
  cipher.setAAD(canonicalHeader(header));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(options.plaintext)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const artifact = Buffer.from(
    JSON.stringify({
      format: ENVELOPE_FORMAT,
      version: ENVELOPE_VERSION,
      header,
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: authTag.toString('base64')
    }),
    'utf8'
  );
  if (artifact.length > MAX_ENVELOPE_BYTES) fail('ENVELOPE_MALFORMED');
  return artifact;
}

type SerializedEnvelope = Readonly<{
  format: string;
  version: number;
  header: EnvelopeHeader;
  nonce: string;
  ciphertext: string;
  authTag: string;
}>;

function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    fail('ENVELOPE_MALFORMED');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) fail('ENVELOPE_MALFORMED');
  return decoded;
}

function parseArtifact(artifact: Uint8Array): SerializedEnvelope {
  if (artifact.byteLength === 0 || artifact.byteLength > MAX_ENVELOPE_BYTES) {
    fail('ENVELOPE_MALFORMED');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(artifact).toString('utf8')) as unknown;
  } catch {
    fail('ENVELOPE_MALFORMED');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('format' in parsed) ||
    !('version' in parsed) ||
    !('header' in parsed) ||
    !('nonce' in parsed) ||
    !('ciphertext' in parsed) ||
    !('authTag' in parsed) ||
    parsed.format !== ENVELOPE_FORMAT ||
    parsed.version !== ENVELOPE_VERSION
  ) {
    fail('ENVELOPE_MALFORMED');
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.header !== 'object' ||
    candidate.header === null ||
    typeof candidate.nonce !== 'string' ||
    typeof candidate.ciphertext !== 'string' ||
    typeof candidate.authTag !== 'string'
  ) {
    fail('ENVELOPE_MALFORMED');
  }
  const header = candidate.header as EnvelopeHeader;
  assertHeader(header);
  const nonce = decodeBase64(candidate.nonce);
  decodeBase64(candidate.ciphertext);
  const authTag = decodeBase64(candidate.authTag);
  if (nonce.length !== NONCE_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    fail('ENVELOPE_MALFORMED');
  }
  return {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    header,
    nonce: candidate.nonce as string,
    ciphertext: candidate.ciphertext as string,
    authTag: candidate.authTag as string
  };
}

export type DecryptEnvelopeOptions = Readonly<{
  artifact: Uint8Array;
  keys: readonly EnvelopeKey[];
  now?: Date;
  allowExpired?: boolean;
  expected?: Partial<
    Pick<
      EnvelopeHeader,
      'envelopeType' | 'purpose' | 'changeId' | 'appId' | 'catalogVersion' | 'manifestVersion'
    >
  >;
}>;

export function decryptEnvelope(options: DecryptEnvelopeOptions): Buffer {
  const parsed = parseArtifact(options.artifact);
  const matchingKey = options.keys.find(
    (key) =>
      key.purpose === parsed.header.purpose &&
      key.keyId === parsed.header.keyId &&
      key.keyVersion === parsed.header.keyVersion
  );
  if (!matchingKey) fail('ENVELOPE_KEY_REJECTED');
  const now = options.now?.getTime() ?? Date.now();
  if (!Number.isFinite(now)) fail('ENVELOPE_EXPIRED');
  if (!options.allowExpired && Date.parse(parsed.header.expiresAt) <= now) fail('ENVELOPE_EXPIRED');
  for (const [name, expected] of Object.entries(options.expected ?? {})) {
    if (expected !== undefined && parsed.header[name as keyof typeof parsed.header] !== expected) {
      fail('ENVELOPE_CONTEXT_MISMATCH');
    }
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      matchingKey.bytes,
      Buffer.from(parsed.nonce, 'base64')
    );
    decipher.setAAD(canonicalHeader(parsed.header));
    decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
      decipher.final()
    ]);
  } catch {
    fail('ENVELOPE_AUTH_FAILED');
  }
}
