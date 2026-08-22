import { sha256 } from './canonicalJson.js';
import { normalizeInstantForCanonicalJson } from './canonicalJson.js';
import type { StudentMergeBlocker } from './types.js';

/**
 * Field-level reconciliation for the canonical profile document.
 *
 * The one rule every case here serves: the apply executor can never invent a
 * field choice the reviewed manifest does not contain. A conflicting field
 * produces a blocker and no patch, full stop — unless an explicit approved
 * source decision names it, in which case the decision is recorded, not
 * inferred.
 */

const IDENTITY_FIELDS = ['name', 'dob', 'gender', 'contact', 'guardianName', 'guardianPhone', 'admissionSearchName', 'admissionSearchDob', 'admissionSearchContact'] as const;
const CORROBORATING_ARRAY_FIELDS = ['courseJoins', 'leaveWindows'] as const;

export interface StudentProfileFieldDecision {
  fieldPath: string;
  action:
    | 'keep_canonical'
    | 'copy_from_profile'
    | 'earliest_timestamp'
    | 'sorted_union'
    | 'approved_source'
    | 'retain_alternative_fingerprint';
  sourceProfileId: string | null;
  sourceFingerprints: Record<string, string>;
  expectedFingerprint: string;
  rollbackAction: 'no_op' | 'delete_added_value' | 'restore_allowlisted_value';
}

export type ProfileReconciliationInput = {
  canonicalProfileId: string;
  profiles: Array<{ id: string; data: Record<string, unknown> }>;
  approvedFieldSources?: Record<string, string>;
};

function isNonEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function fingerprintOf(value: unknown): string {
  return sha256(JSON.stringify(value ?? null));
}

export function reconcileStudentProfileFields(input: ProfileReconciliationInput): {
  decisions: StudentProfileFieldDecision[];
  canonicalPatch: Record<string, unknown>;
  blockers: StudentMergeBlocker[];
} {
  const decisions: StudentProfileFieldDecision[] = [];
  const patch: Record<string, unknown> = {};
  const blockers: StudentMergeBlocker[] = [];
  const approved = input.approvedFieldSources ?? {};

  const ordered = [...input.profiles].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = ordered.find((p) => p.id === input.canonicalProfileId) ?? ordered[0];
  const others = ordered.filter((p) => p.id !== canonical.id);

  // 1. earliest credible createdAt — never fabricated from migration time.
  const createdAtCandidates = ordered
    .map((p) => p.data.createdAt)
    .filter((value) => value !== undefined && value !== null)
    .map((value) => normalizeInstantForCanonicalJson(value) as string);
  if (createdAtCandidates.length > 0) {
    const earliest = [...createdAtCandidates].sort()[0];
    if (earliest !== canonical.data.createdAt) {
      decisions.push({
        fieldPath: 'createdAt',
        action: 'earliest_timestamp',
        sourceProfileId: null,
        sourceFingerprints: {},
        expectedFingerprint: fingerprintOf(earliest),
        rollbackAction: 'restore_allowlisted_value',
      });
      patch.createdAt = earliest;
    }
  }

  // 2. identity fields: keep canonical if non-empty, copy if canonical is
  // empty and exactly one other profile has a value, block on conflict
  // unless an approved source decision resolves it.
  for (const field of IDENTITY_FIELDS) {
    const canonicalValue = canonical.data[field];
    const candidateValues = new Map<string, unknown>();
    for (const p of ordered) {
      if (isNonEmpty(p.data[field])) candidateValues.set(p.id, p.data[field]);
    }
    if (candidateValues.size === 0) continue;

    const distinctValues = new Set([...candidateValues.values()].map((v) => JSON.stringify(v)));

    if (isNonEmpty(canonicalValue) && distinctValues.size === 1 && candidateValues.has(canonical.id)) {
      decisions.push({
        fieldPath: field,
        action: 'keep_canonical',
        sourceProfileId: canonical.id,
        sourceFingerprints: {},
        expectedFingerprint: fingerprintOf(canonicalValue),
        rollbackAction: 'no_op',
      });
      continue;
    }

    if (distinctValues.size === 1) {
      const [sourceId, value] = [...candidateValues.entries()][0];
      decisions.push({
        fieldPath: field,
        action: isNonEmpty(canonicalValue) ? 'keep_canonical' : 'copy_from_profile',
        sourceProfileId: sourceId,
        sourceFingerprints: {},
        expectedFingerprint: fingerprintOf(value),
        rollbackAction: isNonEmpty(canonicalValue) ? 'no_op' : 'delete_added_value',
      });
      if (!isNonEmpty(canonicalValue)) patch[field] = value;
      continue;
    }

    // Conflict.
    const approvedSourceId = approved[field];
    if (approvedSourceId && candidateValues.has(approvedSourceId)) {
      const value = candidateValues.get(approvedSourceId);
      decisions.push({
        fieldPath: field,
        action: 'approved_source',
        sourceProfileId: approvedSourceId,
        sourceFingerprints: Object.fromEntries(
          [...candidateValues.entries()].map(([id, v]) => [id, fingerprintOf(v)])
        ),
        expectedFingerprint: fingerprintOf(value),
        rollbackAction: 'restore_allowlisted_value',
      });
      patch[field] = value;
      continue;
    }

    blockers.push({
      code: 'IDENTITY_FIELD_CONFLICT',
      candidateId: input.canonicalProfileId,
      detail: `Conflicting values for ${field} across ${[...candidateValues.keys()].sort().join(', ')}`,
    });
  }

  // 3. sibling group: block only when more than one distinct non-empty group
  // id is present.
  const siblingGroups = new Set(
    ordered.map((p) => p.data.siblingGroupId).filter((v): v is string => isNonEmpty(v))
  );
  if (siblingGroups.size > 1) {
    blockers.push({
      code: 'SIBLING_GROUP_CONFLICT',
      candidateId: input.canonicalProfileId,
      detail: `Conflicting sibling groups: ${[...siblingGroups].sort().join(', ')}`,
    });
  } else if (siblingGroups.size === 1 && !isNonEmpty(canonical.data.siblingGroupId)) {
    const [group] = siblingGroups;
    decisions.push({
      fieldPath: 'siblingGroupId',
      action: 'copy_from_profile',
      sourceProfileId: ordered.find((p) => p.data.siblingGroupId === group)?.id ?? null,
      sourceFingerprints: {},
      expectedFingerprint: fingerprintOf(group),
      rollbackAction: 'delete_added_value',
    });
    patch.siblingGroupId = group;
  }

  // 4. face image: canonical's own value is retained untouched; every
  // alternate is fingerprinted for review, never deleted, never patched in.
  const canonicalFaceImage = canonical.data.faceImageStoragePath;
  const alternates = others
    .map((p) => ({ id: p.id, value: p.data.faceImageStoragePath }))
    .filter((entry) => isNonEmpty(entry.value) && entry.value !== canonicalFaceImage);
  if (alternates.length > 0) {
    decisions.push({
      fieldPath: 'faceImageStoragePath',
      action: 'retain_alternative_fingerprint',
      sourceProfileId: canonical.id,
      sourceFingerprints: Object.fromEntries(alternates.map((a) => [a.id, fingerprintOf(a.value)])),
      expectedFingerprint: fingerprintOf(canonicalFaceImage ?? null),
      rollbackAction: 'no_op',
    });
  }

  // 5. legacyProfileIds: sorted union of every profile id plus any existing
  // legacyProfileIds entries, minus the canonical id itself.
  const legacyIds = new Set<string>();
  for (const p of ordered) {
    if (p.id !== canonical.id) legacyIds.add(p.id);
    const existing = p.data.legacyProfileIds;
    if (Array.isArray(existing)) {
      for (const id of existing) if (typeof id === 'string') legacyIds.add(id);
    }
  }
  if (legacyIds.size > 0) {
    const sorted = [...legacyIds].sort();
    decisions.push({
      fieldPath: 'legacyProfileIds',
      action: 'sorted_union',
      sourceProfileId: null,
      sourceFingerprints: {},
      expectedFingerprint: fingerprintOf(sorted),
      rollbackAction: 'restore_allowlisted_value',
    });
    patch.legacyProfileIds = sorted;
  }

  // 6. corroborating arrays: concatenated, not deduplicated by content —
  // they are historical evidence, never authoritative over canonical
  // enrollments.
  for (const field of CORROBORATING_ARRAY_FIELDS) {
    const combined = ordered.flatMap((p) => (Array.isArray(p.data[field]) ? (p.data[field] as unknown[]) : []));
    if (combined.length === 0) continue;
    decisions.push({
      fieldPath: field,
      action: 'sorted_union',
      sourceProfileId: null,
      sourceFingerprints: {},
      expectedFingerprint: fingerprintOf(combined),
      rollbackAction: 'restore_allowlisted_value',
    });
    patch[field] = combined;
  }

  return {
    decisions: decisions.sort((a, b) => a.fieldPath.localeCompare(b.fieldPath)),
    canonicalPatch: patch,
    blockers: blockers.sort((a, b) => a.detail.localeCompare(b.detail)),
  };
}
