import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { GeoPoint, Timestamp } from '@/server/db/documentStore.js';
import { canonicalJson, sha256 } from './canonicalJson.js';

/**
 * Encrypted before-images for the rollback path.
 *
 * The artifact holds a copy of every document the run is about to change,
 * which makes it the single most sensitive file the migration produces: it
 * contains real student names, contacts, and financial state. It is therefore
 * never written in the clear, and the key never travels with it — the key comes
 * from `STUDENT_PROFILE_ROLLBACK_KEY_BASE64` at both ends.
 *
 * Binding matters as much as secrecy. The AAD ties the ciphertext to one
 * project, database, run, and plan preimage, so an artifact from a different
 * run or an earlier plan cannot be used to "restore" production into a state
 * nobody reviewed. Authentication failure is indistinguishable from tampering
 * by design, and both raise the same error.
 */

export const ROLLBACK_ARTIFACT_FILE_NAME = 'student-profile-rollback-before-images.enc';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** 96 bits is the GCM-recommended nonce size; longer nonces are rehashed internally. */
const IV_BYTES = 12;

export type RollbackBeforeImageEntry = {
  entryId: string;
  path: string;
  /** Absent means `replace`, for compatibility with formatVersion 1 artifacts. */
  restoreMode?: 'replace' | 'patch';
  before: Record<string, unknown>;
  /** Patch fields that did not exist before the forward operation. */
  absentFieldPaths?: string[];
};

export type RollbackArtifactAad = {
  projectId: string;
  databaseId: string;
  runId: string;
  planPreimageDigest: string;
};

export type EncryptedRollbackArtifact = {
  fileName: typeof ROLLBACK_ARTIFACT_FILE_NAME;
  formatVersion: 1;
  algorithm: 'AES-256-GCM';
  ivBase64: string;
  ciphertextBase64: string;
  authTagBase64: string;
  entryCount: number;
  /** Digest of the sealed bytes, so the plan can name the exact artifact. */
  digest: string;
};

type EncodedRollbackValue =
  | { kind: 'null' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'timestamp'; seconds: number; nanoseconds: number }
  | { kind: 'date'; value: string }
  | { kind: 'bytes'; value: string }
  | { kind: 'geopoint'; latitude: number; longitude: number }
  | { kind: 'array'; value: EncodedRollbackValue[] }
  | { kind: 'object'; value: Array<[string, EncodedRollbackValue]> };

function isTimestamp(value: unknown): value is Timestamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function' &&
    typeof (value as { seconds?: unknown }).seconds === 'number' &&
    typeof (value as { nanoseconds?: unknown }).nanoseconds === 'number'
  );
}

function encodeRollbackValue(value: unknown): EncodedRollbackValue {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') return { kind: 'number', value: String(value) };
  if (typeof value === 'string') return { kind: 'string', value };
  if (isTimestamp(value)) {
    return { kind: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) return { kind: 'date', value: value.toISOString() };
  if (Buffer.isBuffer(value)) return { kind: 'bytes', value: value.toString('base64') };
  if (value instanceof GeoPoint) {
    return { kind: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) {
    return { kind: 'array', value: value.map(encodeRollbackValue) };
  }
  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `STUDENT_PROFILE_ROLLBACK_VALUE_UNSUPPORTED:${value.constructor?.name ?? 'object'}`
      );
    }
    return {
      kind: 'object',
      value: Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, encodeRollbackValue((value as Record<string, unknown>)[key])]),
    };
  }
  throw new Error(`STUDENT_PROFILE_ROLLBACK_VALUE_UNSUPPORTED:${typeof value}`);
}

function decodeRollbackValue(value: EncodedRollbackValue): unknown {
  switch (value.kind) {
    case 'null':
      return null;
    case 'boolean':
    case 'string':
      return value.value;
    case 'number':
      return Number(value.value);
    case 'timestamp':
      return new Timestamp(value.seconds, value.nanoseconds);
    case 'date':
      return new Date(value.value);
    case 'bytes':
      return Buffer.from(value.value, 'base64');
    case 'geopoint':
      return new GeoPoint(value.latitude, value.longitude);
    case 'array':
      return value.value.map(decodeRollbackValue);
    case 'object':
      return Object.fromEntries(value.value.map(([key, entry]) => [key, decodeRollbackValue(entry)]));
  }
}

function readKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    // Length only. Never echo the value, not even truncated.
    throw new Error(
      `STUDENT_PROFILE_ROLLBACK_KEY_INVALID: expected ${KEY_BYTES} bytes, got ${key.length}`
    );
  }
  return key;
}

function aadBytes(aad: RollbackArtifactAad): Buffer {
  // Canonical serialization so key order in the caller's object cannot change
  // what the ciphertext is bound to.
  return Buffer.from(
    canonicalJson({
      projectId: aad.projectId,
      databaseId: aad.databaseId,
      runId: aad.runId,
      planPreimageDigest: aad.planPreimageDigest,
    }),
    'utf8'
  );
}

export function encryptRollbackBeforeImages(input: {
  entries: readonly RollbackBeforeImageEntry[];
  aad: RollbackArtifactAad;
  keyBase64: string;
}): EncryptedRollbackArtifact {
  if (input.entries.length === 0) {
    // An empty artifact would satisfy every structural check while restoring
    // nothing, which is worse than having no artifact at all.
    throw new Error('STUDENT_PROFILE_ROLLBACK_ARTIFACT_EMPTY');
  }

  const key = readKey(input.keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aadBytes(input.aad));

  const plaintext = Buffer.from(
    canonicalJson({
      formatVersion: 1,
      entries: encodeRollbackValue([...input.entries]),
    }),
    'utf8'
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const ivBase64 = iv.toString('base64');
  const ciphertextBase64 = ciphertext.toString('base64');
  const authTagBase64 = authTag.toString('base64');

  return {
    fileName: ROLLBACK_ARTIFACT_FILE_NAME,
    formatVersion: 1,
    algorithm: 'AES-256-GCM',
    ivBase64,
    ciphertextBase64,
    authTagBase64,
    entryCount: input.entries.length,
    digest: sha256(`${ivBase64}.${ciphertextBase64}.${authTagBase64}`),
  };
}

export function decryptRollbackBeforeImages(input: {
  artifact: EncryptedRollbackArtifact;
  aad: RollbackArtifactAad;
  keyBase64: string;
}): RollbackBeforeImageEntry[] {
  const key = readKey(input.keyBase64);
  try {
    if (input.artifact.formatVersion !== 1) {
      throw new Error('unsupported rollback artifact format');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(input.artifact.ivBase64, 'base64')
    );
    decipher.setAAD(aadBytes(input.aad));
    decipher.setAuthTag(Buffer.from(input.artifact.authTagBase64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(input.artifact.ciphertextBase64, 'base64')),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as {
      formatVersion?: unknown;
      entries?: EncodedRollbackValue;
    };
    if (parsed.formatVersion !== 1 || !parsed.entries) {
      throw new Error('malformed rollback artifact payload');
    }
    const entries = decodeRollbackValue(parsed.entries);
    if (!Array.isArray(entries) || entries.length !== input.artifact.entryCount) {
      throw new Error('rollback artifact entry count mismatch');
    }
    for (const entry of entries) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as RollbackBeforeImageEntry).entryId !== 'string' ||
        typeof (entry as RollbackBeforeImageEntry).path !== 'string' ||
        typeof (entry as RollbackBeforeImageEntry).before !== 'object' ||
        (entry as RollbackBeforeImageEntry).before === null ||
        ((entry as RollbackBeforeImageEntry).restoreMode !== undefined &&
          (entry as RollbackBeforeImageEntry).restoreMode !== 'replace' &&
          (entry as RollbackBeforeImageEntry).restoreMode !== 'patch') ||
        ((entry as RollbackBeforeImageEntry).restoreMode === 'patch' &&
          !Array.isArray((entry as RollbackBeforeImageEntry).absentFieldPaths ?? []))
      ) {
        throw new Error('malformed rollback artifact entry');
      }
    }
    return entries as RollbackBeforeImageEntry[];
  } catch {
    // Wrong key, wrong binding, and tampering are deliberately one error. The
    // caller must not be able to probe which of the three occurred, and the
    // underlying message is swallowed so no key or plaintext fragment escapes
    // through an exception string.
    throw new Error('STUDENT_PROFILE_ROLLBACK_ARTIFACT_UNAUTHENTIC');
  }
}
