import { createHash } from 'node:crypto';
import { Timestamp } from '@/server/db/documentStore.js';

/**
 * Deterministic serialization and integrity primitives for the merge engine.
 *
 * Production stores the same instant three ways: a DocumentStore `Timestamp`
 * (written by `FieldValue.serverTimestamp()`), an ISO string, and — for a known
 * set of user documents — an epoch millisecond number where the type promises a
 * string. Fingerprinting raw values would make an unchanged document look
 * drifted between the preliminary and final audits purely because of storage
 * representation, aborting the run inside the maintenance window for no real
 * reason. Every comparison here normalizes first.
 */

const SECRET_FIELD_NAME_PATTERN =
  /password|hash|salt|token|secret|privatekey|credential(?!.*(?:exists|version|updatedat))/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function looksLikeTimestampInstance(value: unknown): value is Timestamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function' &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  );
}

/**
 * Normalizes a `Timestamp`, an ISO string, or an epoch-millisecond number to
 * one ISO-8601 UTC string. `null`/`undefined` pass through, because those mean
 * "field absent," not "malformed instant." Anything else throws, because a
 * value that cannot be interpreted as an instant must block the run rather
 * than silently compare unequal to a value that can.
 */
export function normalizeInstantForCanonicalJson(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;

  if (looksLikeTimestampInstance(value)) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  throw new Error('CANONICAL_JSON_UNNORMALIZABLE_INSTANT');
}

const INSTANT_FIELD_NAME_PATTERN = /(^|[A-Z_])(at|time|date)$/i;

function looksLikeInstantFieldName(fieldName: string): boolean {
  return INSTANT_FIELD_NAME_PATTERN.test(fieldName) || /^(createdAt|updatedAt)$/i.test(fieldName);
}

function normalizeProjection(value: unknown, fieldName: string): unknown {
  // A Timestamp instance passes isPlainObject (it is a non-null, non-array
  // object), so it must be converted before the generic object branch
  // recurses into its internal _seconds/_nanoseconds fields.
  if (looksLikeTimestampInstance(value)) {
    return normalizeInstantForCanonicalJson(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeProjection(entry, `${fieldName}.${index}`));
  }
  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      normalized[key] = normalizeProjection(value[key], key);
    }
    return normalized;
  }
  if (looksLikeInstantFieldName(fieldName) && value != null) {
    return normalizeInstantForCanonicalJson(value);
  }
  return value;
}

export function fingerprintDocumentProjection(projection: Record<string, unknown>): string {
  return sha256(canonicalJson(normalizeProjection(projection, '')));
}

export function assertSafeIntegerMoney(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`STUDENT_MERGE_MONEY_NOT_SAFE_INTEGER:${label}`);
  }
}

const ALLOWED_NON_SECRET_FIELD_NAMES = new Set(['exists', 'updatedAt', 'version', 'credential']);

function isAllowedNonSecretField(key: string, value: unknown): boolean {
  if (ALLOWED_NON_SECRET_FIELD_NAMES.has(key)) return true;
  // This is a deterministic search index made only from normalized prefixes
  // of the student's name and code. It is not a bearer/authentication token.
  // Whole-document rollback images for accounting projections must preserve it
  // or a rollback would not restore the deleted projection exactly.
  if (key === 'searchTokens') {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }
  // This is a policy flag consumed by the login UI, not password material.
  // Type-check it here so a malformed credential string under the same name
  // still fails closed.
  if (key === 'forcePasswordChange') return typeof value === 'boolean';
  return false;
}

export function assertArtifactContainsNoCredentialSecrets(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertArtifactContainsNoCredentialSecrets(entry, `${path}.${index}`)
    );
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (SECRET_FIELD_NAME_PATTERN.test(key) && !isAllowedNonSecretField(key, value[key])) {
        throw new Error(`STUDENT_MERGE_ARTIFACT_CONTAINS_SECRET:${key}`);
      }
      assertArtifactContainsNoCredentialSecrets(value[key], path ? `${path}.${key}` : key);
    }
  }
}
