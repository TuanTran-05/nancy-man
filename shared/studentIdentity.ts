/**
 * The one place canonical student identity is defined.
 *
 * Every workstream imports these predicates rather than declaring its own. The
 * reason is concrete: production holds two different kinds of retired profile,
 * written years apart by different code, and a predicate that knows about only
 * one of them silently treats the other as a live student — which means login,
 * wallet, and roster all point at a document nobody should reach.
 *
 * The two kinds:
 *
 * - **Tombstones**, written by the normalization engine. Fully described,
 *   validated, and self-identifying via `studentProfileState`.
 * - **Legacy soft merges**, written by `scripts/merge-duplicate-student-records.ts`.
 *   Fifty-eight of them exist. They carry `mergedIntoStudentId` plus
 *   `studentLifecycle: 'archived'` and **no** `studentProfileState`, and no
 *   runtime code has ever read that field.
 *
 * So `isCanonicalStudentProfile` checks for both, and fails closed on a
 * malformed tombstone: a half-written retirement record is not a live student
 * merely because it failed validation.
 */

export type StudentProfileAliasRecord = {
  legacyProfileId: string;
  canonicalProfileId: string;
  mergeRunId: string;
  reasonCode: 'profile_normalization' | 'audited_forward_repair';
  sourceFingerprint: string;
  createdAt: unknown;
  createdBy: string;
};

export type StudentProfileTombstoneMetadata = {
  studentProfileState: 'merged_tombstone';
  canonicalProfileId: string;
  mergeRunId: string;
  mergedAt: unknown;
  identityWriteDisabled: true;
  authDisabled: true;
  walletOwnership: 'canonicalized';
  tombstoneSourceFingerprint: string;
};

export type LegacySoftMergeMarker = {
  mergedIntoStudentId: string;
  studentLifecycle?: string;
};

const ALIAS_REASON_CODES = new Set(['profile_normalization', 'audited_forward_repair']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isStudentProfileAlias(value: unknown): value is StudentProfileAliasRecord {
  if (!isRecord(value)) return false;
  for (const field of [
    'legacyProfileId',
    'canonicalProfileId',
    'mergeRunId',
    'sourceFingerprint',
    'createdBy',
  ]) {
    if (!nonEmptyString(value[field])) return false;
  }
  if (!ALIAS_REASON_CODES.has(String(value.reasonCode))) return false;
  // A self-alias would resolve forever without reaching a live profile.
  return value.legacyProfileId !== value.canonicalProfileId;
}

export function isStudentProfileTombstone(
  value: unknown
): value is StudentProfileTombstoneMetadata {
  if (!isRecord(value)) return false;
  if (value.studentProfileState !== 'merged_tombstone') return false;
  for (const field of ['canonicalProfileId', 'mergeRunId', 'tombstoneSourceFingerprint']) {
    if (!nonEmptyString(value[field])) return false;
  }
  // These three are the record that access was revoked and the money moved.
  // Without them the document claims to be retired while still owning both.
  if (value.identityWriteDisabled !== true) return false;
  if (value.authDisabled !== true) return false;
  return value.walletOwnership === 'canonicalized';
}

/**
 * Reads the old merge script's pointer.
 *
 * A self-pointer resolves to nothing useful — it would name the retired
 * document as its own canonical — so it is reported as absent and left for the
 * planner to raise as a blocker.
 */
export function readLegacySoftMergePointer(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const pointer = typeof value.mergedIntoStudentId === 'string' ? value.mergedIntoStudentId.trim() : '';
  if (pointer === '') return null;
  if (typeof value.id === 'string' && value.id === pointer) return null;
  return pointer;
}

export function isLegacySoftMergedStudentProfile(value: unknown): value is LegacySoftMergeMarker {
  if (!isRecord(value)) return false;
  // Keyed on the pointer alone. A missing `studentLifecycle: 'archived'` is
  // sloppiness in the old data, not evidence that the record is still live.
  return typeof value.mergedIntoStudentId === 'string' && value.mergedIntoStudentId.trim() !== '';
}

export function isCanonicalStudentProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (isLegacySoftMergedStudentProfile(value)) return false;
  // Fail closed on anything claiming to be a tombstone, valid or not: a
  // half-written retirement record is not a live student.
  if (value.studentProfileState === 'merged_tombstone') return false;
  return true;
}
