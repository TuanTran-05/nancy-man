import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';
import {
  isCanonicalStudentProfile,
  isStudentProfileAlias,
  readLegacySoftMergePointer,
} from '../../../../shared/studentIdentity.js';
import { normalizeStudentCode, STUDENT_CODE_REGISTRY_COLLECTION } from './studentCodeRegistry.js';

/**
 * The single boundary through which a student identifier becomes a canonical
 * profile id.
 *
 * Resolution order matters and is not arbitrary. Aliases are checked **before**
 * the profile document, because Workstream C writes the alias in an earlier
 * stage than the tombstone: for part of a merge run both documents exist, and
 * reading the profile first would return the one that is about to be retired.
 *
 * Every failure mode fails closed. A chain, a cycle, a dangling target, a
 * malformed record, or two profiles carrying one code all raise rather than
 * resolve, because the alternative — picking the plausible-looking candidate —
 * is how a payment ends up attached to the wrong child. There is no heuristic
 * anywhere in this file.
 */

export const STUDENT_PROFILE_ALIASES_COLLECTION = 'student_profile_aliases';

export type CanonicalStudentResolution = {
  requestedId: string;
  canonicalProfileId: string;
  resolution:
    | 'profile'
    | 'profile_alias'
    | 'code_registry'
    | 'legacy_code_fallback'
    | 'legacy_soft_merge_pointer';
  shouldRedirect: boolean;
};

export type ResolveCanonicalStudentIdOptions = {
  /**
   * Scans `students.studentId` when the registry has no record. Off by default:
   * it is a query, so it can return two owners, and it exists only until the
   * registry is fully populated.
   */
  allowLegacyCodeFallback?: boolean;
  /**
   * Follows the old merge script's `mergedIntoStudentId`. On by default because
   * fifty-eight production records depend on it and have no alias. Workstream D
   * turns it off, and the flag is what makes that removal provable.
   */
  allowLegacySoftMergePointer?: boolean;
};

type DocReader = (path: string) => Promise<{ exists: boolean; data: unknown }>;

/**
 * `STUDENT_IDENTITY_NOT_FOUND` is an ordinary 404: the caller named something
 * that does not exist. Every other failure here is a data-integrity fault —
 * a chain, a cycle, a dangling target, two owners of one code — that a normal
 * client cannot resolve by retrying, so it is a 409 for a human to review.
 */
function resolverError(message: string): Error {
  const statusCode = message.startsWith('STUDENT_IDENTITY_NOT_FOUND') ? 404 : 409;
  return Object.assign(new Error(message), { statusCode });
}

function makeDirectReader(db: DocumentStore): DocReader {
  return async (path: string) => {
    const snapshot = (await db.doc(path).get()) as unknown as {
      exists: boolean;
      data: () => unknown;
    };
    return { exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : undefined };
  };
}

function makeTransactionReader(tx: Transaction, db: DocumentStore): DocReader {
  return async (path: string) => {
    const snapshot = (await tx.get(db.doc(path) as never)) as unknown as {
      exists: boolean;
      data: () => unknown;
    };
    return { exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : undefined };
  };
}

async function readCanonicalTarget(
  read: DocReader,
  candidateId: string,
  failureCode: string
): Promise<void> {
  const target = await read(`students/${candidateId}`);
  if (!target.exists) {
    throw resolverError(`${failureCode}: ${candidateId} does not exist`);
  }
  if (!isCanonicalStudentProfile(target.data)) {
    throw resolverError(`${failureCode}: ${candidateId} is itself retired`);
  }
}

async function resolve(
  read: DocReader,
  queryLegacyCodeOwners: (code: string) => Promise<string[]>,
  inputId: string,
  options: ResolveCanonicalStudentIdOptions
): Promise<CanonicalStudentResolution> {
  const allowSoftMerge = options.allowLegacySoftMergePointer !== false;

  // 1. Alias first. See the module comment: during a merge run the alias and
  //    its source profile coexist, and the alias is the newer truth.
  const alias = await read(`${STUDENT_PROFILE_ALIASES_COLLECTION}/${inputId}`);
  if (alias.exists) {
    if (!isStudentProfileAlias(alias.data)) {
      throw resolverError(`STUDENT_IDENTITY_ALIAS_MALFORMED: ${inputId}`);
    }
    const canonicalProfileId = (alias.data as { canonicalProfileId: string }).canonicalProfileId;

    // One hop only. A chain means some link was written wrong, and quietly
    // following it would hide the defect instead of surfacing it.
    const nextAlias = await read(`${STUDENT_PROFILE_ALIASES_COLLECTION}/${canonicalProfileId}`);
    if (nextAlias.exists) {
      throw resolverError(`STUDENT_IDENTITY_ALIAS_NOT_ONE_HOP: ${inputId} -> ${canonicalProfileId}`);
    }

    const target = await read(`students/${canonicalProfileId}`);
    if (!target.exists) {
      throw resolverError(`STUDENT_IDENTITY_ALIAS_TARGET_MISSING: ${canonicalProfileId}`);
    }
    if (!isCanonicalStudentProfile(target.data)) {
      throw resolverError(`STUDENT_IDENTITY_ALIAS_TARGET_NOT_CANONICAL: ${canonicalProfileId}`);
    }
    return {
      requestedId: inputId,
      canonicalProfileId,
      resolution: 'profile_alias',
      shouldRedirect: true,
    };
  }

  // 2. The profile itself, or the old script's pointer if it carries one.
  const profile = await read(`students/${inputId}`);
  if (profile.exists) {
    const pointer = readLegacySoftMergePointer({
      ...(profile.data as Record<string, unknown>),
      id: inputId,
    });
    const looksSoftMerged =
      typeof (profile.data as Record<string, unknown>)?.mergedIntoStudentId === 'string' &&
      String((profile.data as Record<string, unknown>).mergedIntoStudentId).trim() !== '';

    if (looksSoftMerged) {
      if (!allowSoftMerge) {
        throw resolverError(`STUDENT_IDENTITY_LEGACY_POINTER_DISABLED: ${inputId}`);
      }
      if (!pointer) {
        // Self-pointer. Resolving it would name the retired document as its
        // own canonical.
        throw resolverError(`STUDENT_IDENTITY_LEGACY_POINTER_INVALID: ${inputId} points at itself`);
      }
      await readCanonicalTarget(read, pointer, 'STUDENT_IDENTITY_LEGACY_POINTER_INVALID');
      return {
        requestedId: inputId,
        canonicalProfileId: pointer,
        resolution: 'legacy_soft_merge_pointer',
        shouldRedirect: true,
      };
    }

    if (isCanonicalStudentProfile(profile.data)) {
      return {
        requestedId: inputId,
        canonicalProfileId: inputId,
        resolution: 'profile',
        shouldRedirect: false,
      };
    }
    // A tombstone with no alias: the merge is half-finished, and serving the
    // tombstone would look like a working student record.
    throw resolverError(`STUDENT_IDENTITY_TOMBSTONE_WITHOUT_ALIAS: ${inputId}`);
  }

  // 3. Business code.
  let normalizedCode: string | null = null;
  try {
    normalizedCode = normalizeStudentCode(inputId);
  } catch {
    normalizedCode = null;
  }

  if (normalizedCode) {
    const registry = await read(`${STUDENT_CODE_REGISTRY_COLLECTION}/${normalizedCode}`);
    if (registry.exists) {
      const canonicalProfileId = (registry.data as { canonicalProfileId?: string })
        .canonicalProfileId;
      if (!canonicalProfileId) {
        throw resolverError(`STUDENT_IDENTITY_DATA_INCONSISTENT: registry ${normalizedCode} has no owner`);
      }
      // Retired codes still resolve. That is the point of reserving them: an
      // old receipt naming this code must keep pointing at the right human.
      await readCanonicalTarget(read, canonicalProfileId, 'STUDENT_IDENTITY_DATA_INCONSISTENT');
      return {
        requestedId: inputId,
        canonicalProfileId,
        resolution: 'code_registry',
        shouldRedirect: true,
      };
    }

    if (options.allowLegacyCodeFallback) {
      const owners = await queryLegacyCodeOwners(normalizedCode);
      if (owners.length > 1) {
        // Never pick a winner. Choosing the "active" one heuristically is how
        // the wrong student ends up owning a payment.
        throw resolverError(
          `STUDENT_IDENTITY_DATA_INCONSISTENT: ${normalizedCode} is carried by ${owners.join(', ')}`
        );
      }
      if (owners.length === 1) {
        await readCanonicalTarget(read, owners[0], 'STUDENT_IDENTITY_DATA_INCONSISTENT');
        return {
          requestedId: inputId,
          canonicalProfileId: owners[0],
          resolution: 'legacy_code_fallback',
          shouldRedirect: true,
        };
      }
    }
  }

  throw resolverError(`STUDENT_IDENTITY_NOT_FOUND: ${inputId}`);
}

function legacyOwnerQuery(db: DocumentStore) {
  return async (code: string): Promise<string[]> => {
    const snapshot = (await (db.collection('students') as never as {
      where: (a: string, b: string, c: string) => { limit: (n: number) => { get: () => Promise<unknown> } };
    })
      .where('studentId', '==', code)
      .limit(5)
      .get()) as { docs?: Array<{ id: string }> };
    return (snapshot.docs ?? []).map((doc) => doc.id);
  };
}

export async function resolveCanonicalStudentId(
  db: DocumentStore,
  inputId: string,
  options: ResolveCanonicalStudentIdOptions = {}
): Promise<CanonicalStudentResolution> {
  return resolve(makeDirectReader(db), legacyOwnerQuery(db), inputId, options);
}

export async function resolveCanonicalStudentIdInTransaction(
  tx: Transaction,
  db: DocumentStore,
  inputId: string,
  options: ResolveCanonicalStudentIdOptions = {}
): Promise<CanonicalStudentResolution> {
  // The legacy fallback is a query, and DocumentStore forbids a query after a
  // staged write inside a transaction. Callers that need it must resolve
  // before writing; the contract is identical otherwise.
  return resolve(makeTransactionReader(tx, db), legacyOwnerQuery(db), inputId, options);
}
