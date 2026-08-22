import { FieldValue, type DocumentStore, type Transaction } from '@/server/db/documentStore.js';
import type { StudentIdentityMaintenanceState } from '../maintenance/studentIdentityMaintenance.js';

/**
 * Global uniqueness for student business codes.
 *
 * Uniqueness is enforced by a document whose ID *is* the normalized code, not
 * by querying for duplicates and then writing. The difference matters: a query
 * followed by a write is two operations with a gap, and two concurrent
 * enrolments can both find the code free and both take it. Production already
 * has fifty-nine codes owned twice, which is what that gap looks like at scale.
 *
 * Normalization is therefore security-relevant rather than cosmetic. Two
 * spellings that normalize differently become two documents and defeat the
 * whole mechanism, so the rules are strict and locale-invariant, and anything
 * that could change meaning as a DocumentStore document ID is rejected outright.
 *
 * The registry stores identity ownership only. No name, date of birth, contact,
 * or credential ever lands here: it is queried on paths that do not need them,
 * and data that is not stored cannot leak.
 */

export const STUDENT_CODE_REGISTRY_COLLECTION = 'student_code_registry';

export type StudentCodeRegistryStatus = 'active' | 'alias' | 'retired';

export type StudentCodeRegistryRecord = {
  normalizedCode: string;
  canonicalProfileId: string;
  isPrimary: boolean;
  status: StudentCodeRegistryStatus;
  createdAt: unknown;
  updatedAt: unknown;
  createdBy: string;
  updatedBy: string;
  mergeRunId?: string;
};

export type StudentCodeClaimInput = {
  normalizedCode: string;
  canonicalProfileId: string;
  actorId: string;
  isPrimary: boolean;
  status: Exclude<StudentCodeRegistryStatus, 'retired'>;
  mergeRunId?: string;
};

export class StudentCodeConflictError extends Error {
  readonly status = 409;
  /**
   * The API error mapper keys on `statusCode`, so `status` alone would have
   * surfaced this conflict to the client as an opaque 500.
   */
  readonly statusCode = 409;
  readonly code = 'STUDENT_CODE_ALREADY_CLAIMED';

  constructor(detail: string) {
    super(`STUDENT_CODE_ALREADY_CLAIMED: ${detail}`);
    this.name = 'StudentCodeConflictError';
  }
}

const MAX_CODE_LENGTH = 64;

/**
 * Code-point predicates rather than character-class regexes.
 *
 * The characters matched here are invisible: control codes, non-breaking
 * spaces, zero-width marks. Writing them literally in a regex makes the source
 * unreviewable and lets any editor or pipeline silently corrupt the rule.
 * Numeric comparisons say exactly what they mean and survive a copy-paste.
 */
function isControlCodePoint(codePoint: number): boolean {
  // C0 and C1 ranges.
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isUnicodeWhitespace(codePoint: number): boolean {
  if (codePoint === 0x20 || (codePoint >= 0x09 && codePoint <= 0x0d)) return true;
  if (codePoint === 0x00a0 || codePoint === 0x1680 || codePoint === 0xfeff) return true;
  if (codePoint >= 0x2000 && codePoint <= 0x200a) return true;
  return (
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

export function normalizeStudentCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`STUDENT_CODE_INVALID: expected a string, received ${typeof value}`);
  }
  // NFKC first, so full-width digits and their ASCII equivalents converge on
  // one document rather than silently becoming two owners of "the same" code.
  const normalized = [...value.normalize('NFKC')]
    .filter((character) => !isUnicodeWhitespace(character.codePointAt(0) ?? 0))
    .join('')
    // toUpperCase, never toLocaleUpperCase: a Turkish locale maps 'i' to a
    // dotted capital and would split one code across two registry documents.
    .toUpperCase();

  if (normalized.length === 0) {
    throw new Error('STUDENT_CODE_INVALID: empty after normalization');
  }
  if ([...normalized].some((character) => isControlCodePoint(character.codePointAt(0) ?? 0))) {
    throw new Error('STUDENT_CODE_INVALID: contains control characters');
  }
  if (normalized.includes('/')) {
    // A slash would turn the code into a subcollection path segment.
    throw new Error('STUDENT_CODE_INVALID: contains a path separator');
  }
  if ([...normalized].length > MAX_CODE_LENGTH) {
    throw new Error(`STUDENT_CODE_INVALID: longer than ${MAX_CODE_LENGTH} code points`);
  }
  return normalized;
}

function registryRef(db: DocumentStore, normalizedCode: string) {
  return db.doc(`${STUDENT_CODE_REGISTRY_COLLECTION}/${normalizedCode}`);
}

export async function readStudentCodeClaimInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: Pick<StudentCodeClaimInput, 'normalizedCode' | 'canonicalProfileId'>
): Promise<{ registry: StudentCodeRegistryRecord | null; legacyOwnerIds: string[] }> {
  const snapshot = await tx.get(registryRef(db, input.normalizedCode) as never);
  const exists = (snapshot as unknown as { exists: boolean }).exists;
  const registry = exists
    ? ((snapshot as unknown as { data: () => unknown }).data() as StudentCodeRegistryRecord)
    : null;

  // The legacy owner query runs even when the registry document exists, so a
  // disagreement between the two sources is detected rather than assumed away.
  const legacy = await tx.get(
    db.collection('students').where('studentId', '==', input.normalizedCode) as never
  );
  const legacyOwnerIds = ((legacy as unknown as { docs?: Array<{ id: string }> }).docs ?? []).map(
    (doc) => doc.id
  );

  return { registry, legacyOwnerIds };
}

export function claimStudentCodeInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: StudentCodeClaimInput,
  preloaded: { registry: StudentCodeRegistryRecord | null; legacyOwnerIds: string[] }
): void {
  const { registry, legacyOwnerIds } = preloaded;
  const foreignLegacyOwners = legacyOwnerIds.filter((id) => id !== input.canonicalProfileId);

  if (registry) {
    if (registry.status === 'retired') {
      // Retired codes stay reserved forever. Reissuing one would make old
      // receipts and audit entries resolve to a different human.
      throw new Error(
        `STUDENT_CODE_RETIRED: ${input.normalizedCode} is permanently reserved`
      );
    }
    if (registry.canonicalProfileId !== input.canonicalProfileId) {
      throw new StudentCodeConflictError(
        `${input.normalizedCode} is owned by ${registry.canonicalProfileId}`
      );
    }
    if (foreignLegacyOwners.length > 0) {
      throw new Error(
        `STUDENT_CODE_REGISTRY_INCONSISTENT: ${input.normalizedCode} registry says ` +
          `${registry.canonicalProfileId} but profiles ${foreignLegacyOwners.join(', ')} also carry it`
      );
    }
    // Same owner re-claiming: nothing to write. Rewriting would churn
    // updatedAt on every login-adjacent code check for no benefit.
    return;
  }

  if (foreignLegacyOwners.length > 0) {
    // The registry has not been populated for this code yet and a different
    // profile already carries it. Creating the record now would hand the code
    // to the wrong profile with a document that looks authoritative.
    throw new Error(
      `STUDENT_CODE_REGISTRY_INCONSISTENT: ${input.normalizedCode} is already carried by ` +
        `${foreignLegacyOwners.join(', ')}`
    );
  }

  const now = FieldValue.serverTimestamp();
  const created: StudentCodeRegistryRecord = {
    normalizedCode: input.normalizedCode,
    canonicalProfileId: input.canonicalProfileId,
    isPrimary: input.isPrimary,
    status: input.status,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actorId,
    updatedBy: input.actorId,
    ...(input.mergeRunId ? { mergeRunId: input.mergeRunId } : {}),
  };
  tx.set(registryRef(db, input.normalizedCode) as never, created as never);
}

/**
 * The only path that may change a code's owner.
 *
 * Kept separate from `claimStudentCodeInTransaction` on purpose: ordinary
 * write paths must be structurally incapable of moving a code between humans,
 * so the capability lives behind a differently named function that demands
 * maintenance mode, a matching actor and run, and unchanged fingerprints for
 * both the registry record and the losing profile.
 */
export function reassignStudentCodeForMergeInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: {
    normalizedCode: string;
    expectedSourceProfileId: string;
    canonicalProfileId: string;
    expectedRegistryFingerprint: string;
    expectedLegacyProfileFingerprint: string;
    migrationRunId: string;
    actorId: string;
  },
  preloaded: {
    registry: StudentCodeRegistryRecord;
    maintenance: StudentIdentityMaintenanceState;
    registryFingerprint: string;
    legacyProfileFingerprint: string;
  }
): void {
  if (preloaded.maintenance.mode !== 'read_only') {
    throw new Error(
      'STUDENT_CODE_REASSIGN_MAINTENANCE_REQUIRED: ownership may only move inside the window'
    );
  }
  if (
    preloaded.maintenance.migrationActorId !== input.actorId ||
    preloaded.maintenance.activeRunId !== input.migrationRunId
  ) {
    throw new Error(
      'STUDENT_CODE_REASSIGN_ACTOR_MISMATCH: actor and run must match the active migration'
    );
  }
  if (preloaded.registry.canonicalProfileId !== input.expectedSourceProfileId) {
    throw new Error(
      `STUDENT_CODE_REASSIGN_OWNER_MISMATCH: expected ${input.expectedSourceProfileId}, ` +
        `found ${preloaded.registry.canonicalProfileId}`
    );
  }
  if (
    preloaded.registryFingerprint !== input.expectedRegistryFingerprint ||
    preloaded.legacyProfileFingerprint !== input.expectedLegacyProfileFingerprint
  ) {
    throw new Error(
      'STUDENT_CODE_REASSIGN_DRIFT: the registry or the losing profile changed since review'
    );
  }

  tx.update(registryRef(db, input.normalizedCode) as never, {
    canonicalProfileId: input.canonicalProfileId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: input.actorId,
    mergeRunId: input.migrationRunId,
  } as never);
}

/**
 * Steps a code down from primary when a profile takes a new primary code.
 *
 * Separate from `claimStudentCodeInTransaction` because that function treats a
 * same-owner re-claim as a no-op — correct for the hot path, but it means it
 * can never change a record's status. Ownership is unchanged here: only which
 * of a profile's codes is the current one, and whether the old one may still be
 * presented as valid.
 */
export function demoteStudentCodePrimaryInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: {
    normalizedCode: string;
    canonicalProfileId: string;
    actorId: string;
    status: 'alias' | 'retired';
  },
  preloaded: { registry: StudentCodeRegistryRecord }
): void {
  if (preloaded.registry.canonicalProfileId !== input.canonicalProfileId) {
    throw new StudentCodeConflictError(
      `${input.normalizedCode} is owned by ${preloaded.registry.canonicalProfileId}`
    );
  }
  if (preloaded.registry.status === 'retired' && input.status !== 'retired') {
    // Retirement is one-way. Receipts and audit entries already reference this
    // code as belonging to a closed chapter of this profile.
    throw new Error(`STUDENT_CODE_RETIRED: ${input.normalizedCode} is permanently reserved`);
  }

  tx.update(registryRef(db, input.normalizedCode) as never, {
    isPrimary: false,
    status: input.status,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: input.actorId,
  } as never);
}

export function retireStudentCodeInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: { normalizedCode: string; canonicalProfileId: string; actorId: string }
): void {
  // Retirement keeps the owner. The record is what makes historical references
  // to this code still resolve to the right human.
  tx.update(registryRef(db, input.normalizedCode) as never, {
    status: 'retired',
    canonicalProfileId: input.canonicalProfileId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: input.actorId,
  } as never);
}
