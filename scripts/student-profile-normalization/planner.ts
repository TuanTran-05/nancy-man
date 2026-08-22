import { sha256 } from './canonicalJson.js';
import type { StudentMergeBlocker } from './types.js';

/**
 * Candidate detection and canonical selection.
 *
 * Three candidate classes exist because each has a different automation
 * policy, and conflating them was the exact mistake the legacy merge script
 * made:
 *
 * - `exact_code`: two physical documents share a normalized business code.
 *   Deterministic planning is possible, but never automatic while any
 *   blocker exists.
 * - `legacy_soft_merge`: a document already carries a legacy
 *   `mergedIntoStudentId` pointer with no alias yet — the identity decision
 *   was already made by whoever ran the old script; only the representation
 *   and reference closure are wrong. Detected and reported separately from
 *   exact_code so a reviewer can tell "already decided, needs cleanup" from
 *   "needs a decision."
 * - `different_code_identity`: normalized name, date of birth, and contact
 *   all match across different business codes. Siblings, twins, and shared
 *   contacts can produce this signal, so it always requires explicit human
 *   confirmation and is never auto-merged.
 *
 * A group with a valid alias and tombstone already in place is not a fresh
 * candidate at all — it is `existing_alias`, audited for correctness rather
 * than planned for merge.
 */

export type StudentIdentityCandidateKind =
  | 'exact_code'
  | 'different_code_identity'
  | 'existing_alias'
  | 'legacy_soft_merge';

export interface CanonicalSelectionScore {
  profileId: string;
  liveProfile: boolean;
  hasOpenEnrollment: boolean;
  hasCurrentLinkedAuth: boolean;
  hasActiveFinance: boolean;
  classProjectionConsistent: boolean;
  profileCompleteness: number;
  verifiedTimestamp: string | null;
  reasons: string[];
}

export interface StudentIdentityCandidate {
  candidateId: string;
  kind: StudentIdentityCandidateKind;
  profileIds: string[];
  normalizedCodes: string[];
  evidenceFingerprint: string;
  canonicalScores: CanonicalSelectionScore[];
  proposedCanonicalProfileId: string | null;
  decision: 'manual_review' | 'merge_same_human' | 'confirmed_distinct_person' | 'hold' | 'audit_alias';
  blockers: StudentMergeBlocker[];
}

export type PlannerProfileSource = {
  id: string;
  normalizedCode: string;
  admissionSearchName: string;
  admissionSearchDob: string;
  admissionSearchContact: string;
  mergedIntoStudentId: string;
  isTombstone: boolean;
  hasAlias: boolean;
  hasOpenEnrollment: boolean;
  hasCurrentLinkedAuth: boolean;
  hasActiveFinance: boolean;
  classProjectionConsistent: boolean;
  profileCompleteness: number;
  verifiedTimestamp: string | null;
  archived: boolean;
};

function isRetired(profile: PlannerProfileSource): boolean {
  return profile.isTombstone || profile.mergedIntoStudentId.length > 0;
}

function candidateId(kind: StudentIdentityCandidateKind, profileIds: readonly string[]): string {
  return `${kind}:${sha256([...profileIds].sort().join('|')).slice(0, 16)}`;
}

function evidenceFingerprintOf(profileIds: readonly string[]): string {
  return sha256([...profileIds].sort().join('|'));
}

function scoreProfiles(profiles: readonly PlannerProfileSource[]): CanonicalSelectionScore[] {
  return selectCanonicalStudentProfile({ profiles });
}

export function detectStudentIdentityCandidates(
  profiles: readonly PlannerProfileSource[]
): StudentIdentityCandidate[] {
  const sorted = [...profiles].sort((left, right) => left.id.localeCompare(right.id));
  const consumedAsLegacySoftMerge = new Set<string>();
  const candidates: StudentIdentityCandidate[] = [];

  // Legacy soft-merge and existing-alias detection first, so exact-code
  // grouping below does not also emit the same pair as a fresh duplicate.
  for (const legacy of sorted) {
    if (!legacy.mergedIntoStudentId) continue;
    const canonical = sorted.find((entry) => entry.id === legacy.mergedIntoStudentId);
    if (!canonical) continue;

    const profileIds = [legacy.id, canonical.id].sort();
    consumedAsLegacySoftMerge.add(legacy.id);
    consumedAsLegacySoftMerge.add(canonical.id);

    const kind: StudentIdentityCandidateKind = legacy.hasAlias && legacy.isTombstone ? 'existing_alias' : 'legacy_soft_merge';

    candidates.push({
      candidateId: candidateId(kind, profileIds),
      kind,
      profileIds,
      normalizedCodes: [...new Set([legacy.normalizedCode, canonical.normalizedCode].filter(Boolean))].sort(),
      evidenceFingerprint: evidenceFingerprintOf(profileIds),
      canonicalScores: scoreProfiles([legacy, canonical]),
      proposedCanonicalProfileId: canonical.id,
      decision: kind === 'existing_alias' ? 'audit_alias' : 'merge_same_human',
      blockers: [],
    });
  }

  // Exact normalized code, excluding anything already consumed above.
  const byCode = new Map<string, PlannerProfileSource[]>();
  for (const p of sorted) {
    if (!p.normalizedCode || consumedAsLegacySoftMerge.has(p.id)) continue;
    const list = byCode.get(p.normalizedCode) || [];
    list.push(p);
    byCode.set(p.normalizedCode, list);
  }
  for (const [code, group] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (group.length < 2) continue;
    const profileIds = group.map((p) => p.id).sort();
    const scores = scoreProfiles(group);
    candidates.push({
      candidateId: candidateId('exact_code', profileIds),
      kind: 'exact_code',
      profileIds,
      normalizedCodes: [code],
      evidenceFingerprint: evidenceFingerprintOf(profileIds),
      canonicalScores: scores,
      proposedCanonicalProfileId: scores[0]?.profileId ?? null,
      decision: 'manual_review',
      blockers: [],
    });
  }

  // Different-code identity: exact normalized name + dob + contact match
  // across different codes. Name-only, dob-only, or contact-only overlap is
  // an anomaly signal, not a candidate — siblings and shared household
  // contacts make partial overlap common and meaningless on its own.
  const byIdentity = new Map<string, PlannerProfileSource[]>();
  for (const p of sorted) {
    if (!p.admissionSearchName || !p.admissionSearchDob || !p.admissionSearchContact) continue;
    if (consumedAsLegacySoftMerge.has(p.id)) continue;
    const key = `${p.admissionSearchName}|${p.admissionSearchDob}|${p.admissionSearchContact}`;
    const list = byIdentity.get(key) || [];
    list.push(p);
    byIdentity.set(key, list);
  }
  for (const [key, group] of [...byIdentity.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const distinctCodes = new Set(group.map((p) => p.normalizedCode).filter(Boolean));
    if (distinctCodes.size < 2) continue; // same-code overlap is exact_code's job
    const profileIds = group.map((p) => p.id).sort();
    candidates.push({
      candidateId: candidateId('different_code_identity', profileIds),
      kind: 'different_code_identity',
      profileIds,
      normalizedCodes: [...distinctCodes].sort(),
      evidenceFingerprint: evidenceFingerprintOf(profileIds),
      canonicalScores: scoreProfiles(group),
      proposedCanonicalProfileId: null,
      decision: 'manual_review',
      blockers: [],
    });
  }

  return candidates;
}

const SCORE_COMPONENTS: ReadonlyArray<{
  key: keyof Pick<
    PlannerProfileSource,
    'hasOpenEnrollment' | 'hasCurrentLinkedAuth' | 'hasActiveFinance' | 'classProjectionConsistent'
  >;
  reason: string;
}> = [
  { key: 'hasOpenEnrollment', reason: 'has an open enrollment' },
  { key: 'hasCurrentLinkedAuth', reason: 'has current linked authentication' },
  { key: 'hasActiveFinance', reason: 'has an active financial relationship' },
  { key: 'classProjectionConsistent', reason: 'class projection is consistent' },
];

export function selectCanonicalStudentProfile(input: {
  profiles: readonly PlannerProfileSource[];
}): CanonicalSelectionScore[] {
  const scored = input.profiles.map((profile) => {
    const liveProfile = !isRetired(profile);
    const reasons: string[] = [];
    if (liveProfile) reasons.push('non-merged, non-revoked profile');
    for (const component of SCORE_COMPONENTS) {
      if (profile[component.key]) reasons.push(component.reason);
    }
    if (profile.profileCompleteness > 0) reasons.push(`profile completeness ${profile.profileCompleteness}`);
    if (profile.verifiedTimestamp) reasons.push(`verified at ${profile.verifiedTimestamp}`);

    const score: CanonicalSelectionScore = {
      profileId: profile.id,
      liveProfile,
      hasOpenEnrollment: profile.hasOpenEnrollment,
      hasCurrentLinkedAuth: profile.hasCurrentLinkedAuth,
      hasActiveFinance: profile.hasActiveFinance,
      classProjectionConsistent: profile.classProjectionConsistent,
      profileCompleteness: profile.profileCompleteness,
      verifiedTimestamp: profile.verifiedTimestamp,
      reasons,
    };
    return score;
  });

  return scored.sort((left, right) => {
    // Lexicographic priority; no arbitrary weights, per the design.
    if (left.liveProfile !== right.liveProfile) return left.liveProfile ? -1 : 1;
    if (left.hasOpenEnrollment !== right.hasOpenEnrollment) return left.hasOpenEnrollment ? -1 : 1;
    if (left.hasCurrentLinkedAuth !== right.hasCurrentLinkedAuth) return left.hasCurrentLinkedAuth ? -1 : 1;
    if (left.hasActiveFinance !== right.hasActiveFinance) return left.hasActiveFinance ? -1 : 1;
    if (left.classProjectionConsistent !== right.classProjectionConsistent) {
      return left.classProjectionConsistent ? -1 : 1;
    }
    if (left.profileCompleteness !== right.profileCompleteness) {
      return right.profileCompleteness - left.profileCompleteness;
    }
    if (left.verifiedTimestamp !== right.verifiedTimestamp) {
      if (!left.verifiedTimestamp) return 1;
      if (!right.verifiedTimestamp) return -1;
      return right.verifiedTimestamp.localeCompare(left.verifiedTimestamp);
    }
    return left.profileId.localeCompare(right.profileId);
  });
}

/**
 * Re-exported at the location the workstream plan names it.
 *
 * The assembly lives in `planAssembler.ts` because it consumes this module's
 * output alongside all three reconcilers and the registry, and importing it
 * here would make the dependency circular.
 */
export { planStudentProfileNormalization, type NormalizationPlanSources } from './planAssembler.js';
