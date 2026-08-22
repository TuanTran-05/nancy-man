import { sha256 } from './canonicalJson.js';
import type { LinkedUserMetadata, StudentCredentialMetadata } from './authSources.js';
import type { StudentMergeBlocker } from './types.js';

/**
 * Credential and linked-user reconciliation.
 *
 * Two rules shape everything here.
 *
 * A credential is never chosen by guessing. Comparing timestamps or password
 * versions would pick a winner in every case, which is exactly the failure
 * mode to avoid: a newer record is not evidence of which password the family
 * actually uses, and choosing wrong locks a real person out of their account.
 * Differing material without explicit evidence therefore holds the group.
 *
 * A credential is never deleted during the merge. The non-selected record is
 * retained as inaccessible until retirement, so a wrong decision stays
 * recoverable for the thirty-day window rather than for zero seconds.
 *
 * This module only ever sees the metadata summaries from `authSources.ts`, so
 * no artifact it produces can contain secret material.
 */

export type StudentCredentialDecision =
  /**
   * Not in the original three-way sketch. Encoding "nobody in this group has a
   * password" as a hold would block a merge for a student who simply never had
   * one — a blocker with no action a human could take to clear it.
   */
  | { action: 'none' }
  | { action: 'use_profile'; sourceProfileId: string; evidenceCode: CredentialEvidenceCode }
  | { action: 'force_reset'; approvedBy: string; reason: string }
  | { action: 'hold'; reasonCode: 'CREDENTIAL_AMBIGUOUS' };

export type CredentialEvidenceCode =
  | 'sole_credential'
  | 'identical_material'
  | 'evidenced_current_login'
  | 'approved_source';

export type AuthMoveOperation = {
  operationId: string;
  stage: 'select_credentials' | 'rewrite_linked_users';
  kind: 'recreate_document' | 'retain_inaccessible';
  sourcePath: string;
  targetPath: string | null;
  canonicalProfileId: string;
  dependsOn: string[];
};

export type CredentialReconciliationInput = {
  canonicalProfileId: string;
  credentials: StudentCredentialMetadata[];
  linkedUsers: LinkedUserMetadata[];
  /**
   * A profile named by external evidence of a recent successful login. This is
   * the only automatic way out of an ambiguous pair, and it must name a profile
   * that actually holds a credential.
   */
  evidencedCurrentLoginProfileId?: string;
  approvedCredentialSource?: { profileId: string; approvedBy: string; reason: string };
  forcedReset?: { approvedBy: string; reason: string };
};

function operationIdFor(stage: string, sourcePath: string, targetPath: string | null): string {
  return sha256(`${stage}|${sourcePath}|${targetPath ?? ''}`).slice(0, 32);
}

function decideCredential(
  input: CredentialReconciliationInput,
  present: StudentCredentialMetadata[]
): { decision: StudentCredentialDecision; blocker: StudentMergeBlocker | null } {
  if (present.length === 0) return { decision: { action: 'none' }, blocker: null };

  if (present.length === 1) {
    return {
      decision: {
        action: 'use_profile',
        sourceProfileId: present[0].profileId,
        evidenceCode: 'sole_credential',
      },
      blocker: null,
    };
  }

  const fingerprints = new Set(present.map((entry) => entry.materialFingerprint));
  if (fingerprints.size === 1) {
    // Same password stored twice by the clone bug. Prefer the canonical
    // profile's own record when it has one so the merge moves nothing.
    const canonical = present.find((entry) => entry.profileId === input.canonicalProfileId);
    return {
      decision: {
        action: 'use_profile',
        sourceProfileId: (canonical ?? present[0]).profileId,
        evidenceCode: 'identical_material',
      },
      blocker: null,
    };
  }

  const evidenced = input.evidencedCurrentLoginProfileId;
  if (evidenced && present.some((entry) => entry.profileId === evidenced)) {
    return {
      decision: {
        action: 'use_profile',
        sourceProfileId: evidenced,
        evidenceCode: 'evidenced_current_login',
      },
      blocker: null,
    };
  }

  const approved = input.approvedCredentialSource;
  if (approved && present.some((entry) => entry.profileId === approved.profileId)) {
    return {
      decision: {
        action: 'use_profile',
        sourceProfileId: approved.profileId,
        evidenceCode: 'approved_source',
      },
      blocker: null,
    };
  }

  if (input.forcedReset) {
    return {
      decision: {
        action: 'force_reset',
        approvedBy: input.forcedReset.approvedBy,
        reason: input.forcedReset.reason,
      },
      blocker: null,
    };
  }

  return {
    decision: { action: 'hold', reasonCode: 'CREDENTIAL_AMBIGUOUS' },
    blocker: {
      code: 'CREDENTIAL_AMBIGUOUS',
      candidateId: input.canonicalProfileId,
      detail: `credentials differ across ${present.map((e) => e.profileId).join(', ')}`,
    },
  };
}

export function reconcileStudentCredentialsAndUsers(input: CredentialReconciliationInput): {
  decision: StudentCredentialDecision;
  operations: AuthMoveOperation[];
  blockers: StudentMergeBlocker[];
} {
  const canonicalId = input.canonicalProfileId;
  const blockers: StudentMergeBlocker[] = [];
  const operations: AuthMoveOperation[] = [];

  const present = [...input.credentials]
    .filter((entry) => entry.exists)
    .sort((a, b) => a.profileId.localeCompare(b.profileId));

  const { decision, blocker } = decideCredential(input, present);
  if (blocker) blockers.push(blocker);

  const selectedProfileId = decision.action === 'use_profile' ? decision.sourceProfileId : null;

  // The selected credential must end up under the canonical id, so a record
  // living at a legacy id is copied across. The copy is `recreate_document`
  // rather than a move: the source stays, retained below.
  if (selectedProfileId !== null && selectedProfileId !== canonicalId) {
    const sourcePath = `student_auth_credentials/${selectedProfileId}`;
    const targetPath = `student_auth_credentials/${canonicalId}`;
    operations.push({
      operationId: operationIdFor('select_credentials', sourcePath, targetPath),
      stage: 'select_credentials',
      kind: 'recreate_document',
      sourcePath,
      targetPath,
      canonicalProfileId: canonicalId,
      dependsOn: [],
    });
  }

  // Every credential document that is not the canonical one is retained rather
  // than removed — including the selected source it was just copied from, and
  // including when the group is held. The retention plan is what makes a wrong
  // decision reversible for the thirty-day window instead of immediately final.
  for (const entry of present) {
    if (entry.profileId === canonicalId) continue;
    const sourcePath = `student_auth_credentials/${entry.profileId}`;
    operations.push({
      operationId: operationIdFor('select_credentials', sourcePath, null),
      stage: 'select_credentials',
      kind: 'retain_inaccessible',
      sourcePath,
      targetPath: null,
      canonicalProfileId: canonicalId,
      dependsOn: [],
    });
  }

  // --- Linked users ---
  const users = [...input.linkedUsers].sort((a, b) => a.userId.localeCompare(b.userId));
  const liveByRole = new Map<string, LinkedUserMetadata[]>();

  for (const user of users) {
    if (user.role === 'unknown') {
      // Never skipped. An unrecognized account still grants access to someone,
      // and a merge that ignores it either strands or orphans that access.
      blockers.push({
        code: 'UNKNOWN_LINKED_ROLE',
        candidateId: canonicalId,
        detail: `cannot classify ${user.userId}`,
      });
      continue;
    }
    if (user.isRevoked) continue;
    const bucket = liveByRole.get(user.role);
    if (bucket) bucket.push(user);
    else liveByRole.set(user.role, [user]);
  }

  for (const role of [...liveByRole.keys()].sort()) {
    const bucket = liveByRole.get(role)!;
    if (bucket.length > 1) {
      blockers.push({
        code: 'DUPLICATE_ROLE_ACCOUNT',
        candidateId: canonicalId,
        detail: `two live ${role} accounts: ${bucket.map((u) => u.userId).join(', ')}`,
      });
      continue;
    }

    const user = bucket[0];
    const targetId = `${role}:${canonicalId}`;
    if (user.userId === targetId) continue;

    // Keyed by document id, so moving means recreate-and-delete. Planned from
    // the id rather than the `studentId` field: a field query misses accounts
    // an earlier partial fix already repointed.
    const sourcePath = `users/${user.userId}`;
    const targetPath = `users/${targetId}`;
    operations.push({
      operationId: operationIdFor('rewrite_linked_users', sourcePath, targetPath),
      stage: 'rewrite_linked_users',
      kind: 'recreate_document',
      sourcePath,
      targetPath,
      canonicalProfileId: canonicalId,
      dependsOn: [],
    });
  }

  operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
  return { decision, operations, blockers };
}
