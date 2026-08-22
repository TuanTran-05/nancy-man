import { planAdmissionSearchBackfill } from './admissionSearchBackfill.js';
import type { StudentMergeBlocker } from './types.js';

/**
 * Verification reads only what it judges by, so it declares its own narrow view
 * rather than importing the writer's full journal record. A verifier that
 * demanded every field the writer happens to store would couple this gate to
 * the writer's storage shape for no gain.
 */
export type VerificationJournalEntry = {
  operationId: string;
  status: string;
  errorCode?: string;
};

/**
 * Global post-apply verification.
 *
 * Every check here is a refusal, not a report. The run is only correct if all
 * of them are simultaneously true, so a single failure invalidates the whole
 * verification rather than degrading it — there is no partially-correct merge.
 *
 * Pure by design: the caller gathers the observations from DocumentStore and this
 * module decides. That keeps the invariant logic exhaustively testable, which
 * matters because these are the checks the maintenance window is released
 * against, and a wrong "valid: true" is the most expensive bug in the program.
 *
 * Two subtleties are deliberate. A surviving `mergedIntoStudentId` is treated
 * as unfinished work rather than as evidence of a completed merge — it is the
 * old script's marker and no runtime code reads it. And the admission-search
 * blocker counts canonical profiles only, using the same classifier as the
 * backfill: counting retired documents would hold it non-zero until retirement
 * deletes them, which happens long after the gate it would be blocking.
 */

export type UnknownStudentReference = {
  path: string;
  fieldPath: string;
  profileId: string;
};

export type VerificationProfile = {
  id: string;
  studentProfileState?: string;
  mergedIntoStudentId?: string;
  name?: string;
  dob?: string;
  contact?: string;
  admissionSearchName?: string;
  admissionSearchDob?: string;
  admissionSearchContact?: string;
};

export type StudentProfileNormalizationVerificationInput = {
  runId: string;
  plannedOperationCount: number;
  journal: VerificationJournalEntry[];
  observations: {
    profiles: VerificationProfile[];
    aliases: Array<{ legacyProfileId: string; canonicalProfileId: string }>;
    codeOwners: Array<{ code: string; profileId: string }>;
    mutableLegacyReferences: string[];
    unknownReferences: UnknownStudentReference[];
    openEnrollmentCountByProfile: Record<string, number>;
    aliasOwnedUserIds: string[];
    aliasOwnedCredentialIds: string[];
    aliasOwnedSummaryIds: string[];
    classCounts: Array<{ classId: string; rosterCount: number; enrollmentCount: number }>;
    money: { before: Record<string, number>; after: Record<string, number> };
    financeAnomalies: string[];
    /** Final per-path plan effects whose live after-state does not match. */
    documentEffectDrift?: Array<{
      path: string;
      expected: string | null;
      observed: string | null;
    }>;
  };
  /** Frozen Phase 0 baseline. Anomalies recorded here predate the run. */
  baseline: { financeAnomalies: string[] };
};

export interface StudentProfileNormalizationVerification {
  valid: boolean;
  runId: string;
  operationCounts: { planned: number; applied: number; verified: number; failed: number };
  duplicateCodes: string[];
  noncanonicalMutableReferences: string[];
  unknownReferences: UnknownStudentReference[];
  unnormalizedLegacySoftMergeProfileIds: string[];
  studentsWithUnusableAdmissionSearchFields: number;
  studentsWithUnderivableAdmissionSearchFields: number;
  financeAnomaliesOutsideBaseline: string[];
  multipleOpenProfileIds: string[];
  aliasAuthOwners: string[];
  aliasSummaryIds: string[];
  classCountMismatches: string[];
  documentEffectDrift: Array<{
    path: string;
    expected: string | null;
    observed: string | null;
  }>;
  moneyMatches: boolean;
  blockers: StudentMergeBlocker[];
}

function isRetired(profile: VerificationProfile): boolean {
  return (
    profile.studentProfileState === 'merged_tombstone' ||
    (profile.mergedIntoStudentId ?? '').trim() !== ''
  );
}

/**
 * Whether the money observed before the merge still adds up after it.
 *
 * A pair with no totals on either side is not a match. It satisfies "every key
 * agrees" by having no key, which is what an observation that never ran looks
 * like — and `moneyMatches` is read downstream as proof the money survived, so
 * the two cases must not answer the same.
 */
function moneyEqual(before: Record<string, number>, after: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  if (keys.size === 0) return false;
  for (const key of keys) {
    if ((before[key] ?? 0) !== (after[key] ?? 0)) return false;
  }
  return true;
}

export function verifyStudentProfileNormalization(
  input: StudentProfileNormalizationVerificationInput
): StudentProfileNormalizationVerification {
  const { observations } = input;
  const blockers: StudentMergeBlocker[] = [];
  const add = (code: StudentMergeBlocker['code'], candidateId: string, detail: string) =>
    blockers.push({ code, candidateId, detail });

  // --- Journal ---
  const applied = input.journal.filter((entry) => entry.status === 'applied');
  const failed = input.journal.filter((entry) => entry.status === 'failed');
  const pending = input.journal.filter((entry) => entry.status === 'pending');
  if (applied.length !== input.plannedOperationCount) {
    add(
      'UNKNOWN_REFERENCE',
      input.runId,
      `applied ${applied.length} of ${input.plannedOperationCount} planned operations`
    );
  }
  for (const entry of failed) {
    add('UNKNOWN_REFERENCE', entry.operationId, `journal failed: ${entry.errorCode ?? 'unknown'}`);
  }
  for (const entry of pending) {
    add('UNKNOWN_REFERENCE', entry.operationId, 'journal still pending; the run did not finish');
  }

  // --- Legacy soft merges ---
  const aliasByLegacyId = new Map(
    observations.aliases.map((alias) => [alias.legacyProfileId, alias.canonicalProfileId])
  );
  const profileById = new Map(observations.profiles.map((profile) => [profile.id, profile]));
  const unnormalizedLegacySoftMergeProfileIds = observations.profiles
    .filter((profile) => {
      if ((profile.mergedIntoStudentId ?? '').trim() === '') return false;
      const hasAlias = aliasByLegacyId.has(profile.id);
      const isTombstone = profile.studentProfileState === 'merged_tombstone';
      return !hasAlias || !isTombstone;
    })
    .map((profile) => profile.id)
    .sort();
  for (const id of unnormalizedLegacySoftMergeProfileIds) {
    add('LEGACY_SOFT_MERGE_POINTER_INVALID', id, 'carries mergedIntoStudentId without alias and tombstone');
  }

  // --- Aliases resolve one hop to a live canonical profile ---
  for (const alias of observations.aliases) {
    const target = profileById.get(alias.canonicalProfileId);
    if (alias.legacyProfileId === alias.canonicalProfileId) {
      add('UNKNOWN_REFERENCE', alias.legacyProfileId, 'alias points at itself');
      continue;
    }
    if (!target) {
      add('UNKNOWN_REFERENCE', alias.legacyProfileId, 'alias target profile does not exist');
      continue;
    }
    if (isRetired(target)) {
      // Multi-hop by another name: resolving would land on a retired document.
      add('UNKNOWN_REFERENCE', alias.legacyProfileId, 'alias target is itself retired');
    }
  }

  // --- Codes ---
  const codeOwnerCounts = new Map<string, Set<string>>();
  for (const owner of observations.codeOwners) {
    const bucket = codeOwnerCounts.get(owner.code) ?? new Set<string>();
    bucket.add(owner.profileId);
    codeOwnerCounts.set(owner.code, bucket);
  }
  const duplicateCodes = [...codeOwnerCounts.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([code]) => code)
    .sort();
  for (const code of duplicateCodes) {
    add('REGISTRY_CODE_ALREADY_CLAIMED', code, 'claimed by more than one profile');
  }

  // --- References ---
  for (const path of observations.mutableLegacyReferences) {
    add('UNKNOWN_REFERENCE', path, 'mutable reference still names a retired profile');
  }
  for (const reference of observations.unknownReferences) {
    add('UNKNOWN_REFERENCE', reference.path, `unregistered ${reference.fieldPath}`);
  }
  const documentEffectDrift = [...(observations.documentEffectDrift ?? [])].sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  for (const drift of documentEffectDrift) {
    add(
      'UNKNOWN_REFERENCE',
      drift.path,
      `document after-state drifted: expected ${drift.expected ?? 'absent'}, observed ${drift.observed ?? 'absent'}`
    );
  }

  // --- Enrollment ---
  const multipleOpenProfileIds = Object.entries(observations.openEnrollmentCountByProfile)
    .filter(([, count]) => count > 1)
    .map(([profileId]) => profileId)
    .sort();
  for (const id of multipleOpenProfileIds) {
    add('UNKNOWN_REFERENCE', id, 'more than one open enrollment');
  }

  // --- Auth and derived ownership ---
  const aliasAuthOwners = [
    ...observations.aliasOwnedUserIds,
    ...observations.aliasOwnedCredentialIds,
  ].sort();
  for (const id of aliasAuthOwners) {
    add('UNKNOWN_REFERENCE', id, 'auth record still owned by a retired profile');
  }
  const aliasSummaryIds = [...observations.aliasOwnedSummaryIds].sort();
  for (const id of aliasSummaryIds) {
    add('UNKNOWN_REFERENCE', id, 'accounting summary still owned by a retired profile');
  }

  // --- Class counts ---
  const classCountMismatches = observations.classCounts
    .filter((entry) => entry.rosterCount !== entry.enrollmentCount)
    .map((entry) => entry.classId)
    .sort();
  for (const classId of classCountMismatches) {
    add('UNKNOWN_REFERENCE', classId, 'roster count disagrees with canonical enrollment count');
  }

  // --- Admission-search coverage, canonical profiles only ---
  const canonicalProfiles = observations.profiles.filter((profile) => !isRetired(profile));
  const coverage = planAdmissionSearchBackfill(
    canonicalProfiles.map((profile) => ({
      id: profile.id,
      data: {
        name: profile.name,
        dob: profile.dob,
        contact: profile.contact,
        admissionSearchName: profile.admissionSearchName,
        admissionSearchDob: profile.admissionSearchDob,
        admissionSearchContact: profile.admissionSearchContact,
      },
    }))
  );
  const unusable = coverage.counts.missing_fields + coverage.counts.drifted;
  if (unusable > 0) {
    add(
      'UNKNOWN_REFERENCE',
      input.runId,
      `${unusable} canonical profiles have absent or stale admission-search fields`
    );
  }

  // --- Money and finance anomalies ---
  const moneyObserved =
    Object.keys(observations.money.before).length > 0 ||
    Object.keys(observations.money.after).length > 0;
  const moneyMatches = moneyEqual(observations.money.before, observations.money.after);
  if (!moneyMatches) {
    add(
      'UNKNOWN_REFERENCE',
      input.runId,
      moneyObserved
        ? 'group or global money total changed'
        : 'no money total was observed on either side of the merge'
    );
  }

  const baseline = new Set(input.baseline.financeAnomalies);
  const financeAnomaliesOutsideBaseline = observations.financeAnomalies
    .filter((anomaly) => !baseline.has(anomaly))
    .sort();
  for (const anomaly of financeAnomaliesOutsideBaseline) {
    add('UNKNOWN_REFERENCE', anomaly, 'finance anomaly not present in the frozen baseline');
  }

  return {
    valid: blockers.length === 0,
    runId: input.runId,
    operationCounts: {
      planned: input.plannedOperationCount,
      applied: applied.length,
      verified: blockers.length === 0 ? applied.length : 0,
      failed: failed.length,
    },
    duplicateCodes,
    noncanonicalMutableReferences: [...observations.mutableLegacyReferences].sort(),
    unknownReferences: observations.unknownReferences,
    unnormalizedLegacySoftMergeProfileIds,
    studentsWithUnusableAdmissionSearchFields: unusable,
    studentsWithUnderivableAdmissionSearchFields: coverage.counts.incomplete_source,
    financeAnomaliesOutsideBaseline,
    multipleOpenProfileIds,
    aliasAuthOwners,
    aliasSummaryIds,
    classCountMismatches,
    documentEffectDrift,
    moneyMatches,
    blockers,
  };
}
