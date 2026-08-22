import { canonicalJson, sha256 } from './canonicalJson.js';
import {
  decryptRollbackBeforeImages,
  type EncryptedRollbackArtifact,
  type RollbackArtifactAad,
  type RollbackBeforeImageEntry,
} from './rollbackArtifact.js';
import { MAINTENANCE_DOC_PATH, type NormalizationStore } from './writerCore.js';
import type { StudentMergeDocumentEffect } from './types.js';
import { restoreFieldPathPatch } from './fieldPathPatch.js';

/**
 * The rollback boundary.
 *
 * Rollback is a narrow, time-boxed escape hatch, not a general undo.
 *
 * It is valid only while maintenance still blocks writes. The moment the window
 * is lifted, the world has seen the merged state and new writes land on top of
 * it, so restoring before-images would silently discard them. Past that line the
 * honest answer is forward repair, and this module says so rather than offering
 * a restore that appears to have worked.
 *
 * It is also all-or-nothing. A single drifted document refuses the entire
 * rollback, because a partial reversal produces a state that neither the
 * original plan nor the rollback plan describes — worse than the merged state it
 * was undoing. Every check therefore runs before any write.
 *
 * Credential secrets are never restored from the artifact. The merge retained
 * the non-canonical credential documents precisely so rollback can point at them
 * again instead of decrypting and rewriting secret material.
 */

export type StudentProfileRollbackApprovalRole = 'rollback_technical' | 'rollback_finance';

export type { StudentMergeDocumentEffect } from './types.js';

export interface StudentProfileNormalizationRollbackPlan {
  approved: false;
  runId: string;
  planDigest: string;
  approvalDigest: string;
  rollbackArtifactDigest: string;
  rollbackDigest: string;
  documentEffects: StudentMergeDocumentEffect[];
}

export interface ReviewedStudentProfileNormalizationRollback
  extends Omit<StudentProfileNormalizationRollbackPlan, 'approved'> {
  approved: true;
  rollbackApprovalDigest: string;
  approvals: Array<{
    role: StudentProfileRollbackApprovalRole;
    reviewerId: string;
    reviewedAt: string;
    rollbackDigest: string;
  }>;
}

export function planStudentProfileNormalizationRollback(input: {
  runId: string;
  planDigest: string;
  approvalDigest: string;
  rollbackArtifactDigest: string;
  documentEffects: readonly StudentMergeDocumentEffect[];
}): StudentProfileNormalizationRollbackPlan {
  // Effects keep their array order inside the digest: reversal order is the
  // plan, and two orderings undo different things.
  const rollbackDigest = sha256(
    canonicalJson({
      runId: input.runId,
      planDigest: input.planDigest,
      approvalDigest: input.approvalDigest,
      rollbackArtifactDigest: input.rollbackArtifactDigest,
      documentEffects: [...input.documentEffects],
    })
  );

  return {
    approved: false,
    runId: input.runId,
    planDigest: input.planDigest,
    approvalDigest: input.approvalDigest,
    rollbackArtifactDigest: input.rollbackArtifactDigest,
    rollbackDigest,
    documentEffects: [...input.documentEffects],
  };
}

export function createReviewedStudentProfileNormalizationRollback(input: {
  rollbackPlan: StudentProfileNormalizationRollbackPlan;
  confirmRollbackDigest: string;
  approvals: ReadonlyArray<{
    role: StudentProfileRollbackApprovalRole;
    reviewerId: string;
    reviewedAt: string;
    rollbackDigest: string;
  }>;
  authorizedReviewers: Record<StudentProfileRollbackApprovalRole, readonly string[]>;
}): ReviewedStudentProfileNormalizationRollback {
  const plan = input.rollbackPlan;
  // Re-derived from the plan's own contents, so an edited digest field cannot
  // make a modified rollback look approved.
  const recomputed = planStudentProfileNormalizationRollback(plan).rollbackDigest;
  if (recomputed !== plan.rollbackDigest || plan.rollbackDigest !== input.confirmRollbackDigest) {
    throw new Error('STUDENT_PROFILE_ROLLBACK_DIGEST_MISMATCH');
  }

  const seenRoles = new Set<string>();
  const seenReviewers = new Set<string>();
  for (const approval of input.approvals) {
    if (approval.rollbackDigest !== plan.rollbackDigest) {
      throw new Error(`STUDENT_PROFILE_ROLLBACK_APPROVAL_STALE: ${approval.role}`);
    }
    if (seenRoles.has(approval.role)) {
      throw new Error(`STUDENT_PROFILE_ROLLBACK_APPROVAL_DUPLICATE_ROLE: ${approval.role}`);
    }
    if (seenReviewers.has(approval.reviewerId)) {
      throw new Error(
        `STUDENT_PROFILE_ROLLBACK_APPROVAL_NOT_DISTINCT: ${approval.reviewerId} signed more than one role`
      );
    }
    if (!(input.authorizedReviewers[approval.role] ?? []).includes(approval.reviewerId)) {
      throw new Error(
        `STUDENT_PROFILE_ROLLBACK_APPROVAL_UNAUTHORIZED: ${approval.reviewerId} may not sign ${approval.role}`
      );
    }
    seenRoles.add(approval.role);
    seenReviewers.add(approval.reviewerId);
  }

  for (const role of ['rollback_technical', 'rollback_finance'] as const) {
    if (!seenRoles.has(role)) {
      throw new Error(`STUDENT_PROFILE_ROLLBACK_APPROVAL_ROLE_MISSING: ${role}`);
    }
  }

  return {
    ...plan,
    approved: true,
    approvals: [...input.approvals],
    rollbackApprovalDigest: sha256(
      canonicalJson({
        rollbackDigest: plan.rollbackDigest,
        approvals: [...input.approvals].sort((a, b) =>
          a.role === b.role ? a.reviewerId.localeCompare(b.reviewerId) : a.role.localeCompare(b.role)
        ),
      })
    ),
  };
}

export type StudentProfileNormalizationRollbackResult = {
  status: 'rolled_back' | 'refused';
  runId: string;
  reversedPaths: string[];
  forwardRepairRequired: boolean;
  refusal: { code: string; detail: string } | null;
};

export async function applyStudentProfileNormalizationRollback(input: {
  reviewed: ReviewedStudentProfileNormalizationRollback;
  store: NormalizationStore;
  artifact: EncryptedRollbackArtifact;
  rollbackAad: RollbackArtifactAad;
  rollbackKeyBase64: string;
  confirmRollbackDigest: string;
  expectedActorId: string;
  /** Non-null once writes reopened. Past that point restoring loses data. */
  maintenanceLiftedAt: string | null;
}): Promise<StudentProfileNormalizationRollbackResult> {
  const { reviewed, store } = input;
  const refuse = (
    code: string,
    detail: string,
    forwardRepairRequired = false
  ): StudentProfileNormalizationRollbackResult => ({
    status: 'refused',
    runId: reviewed.runId,
    reversedPaths: [],
    forwardRepairRequired,
    refusal: { code, detail },
  });

  // Checked first, because after the lift no amount of digest agreement makes
  // a restore safe.
  if (input.maintenanceLiftedAt !== null) {
    return refuse(
      'STUDENT_PROFILE_ROLLBACK_WINDOW_CLOSED',
      `maintenance was lifted at ${input.maintenanceLiftedAt}; repair forward instead`,
      true
    );
  }

  if (reviewed.approved !== true) {
    return refuse('STUDENT_PROFILE_ROLLBACK_NOT_APPROVED', 'rollback plan carries no approval');
  }
  if (reviewed.rollbackDigest !== input.confirmRollbackDigest) {
    return refuse(
      'STUDENT_PROFILE_ROLLBACK_DIGEST_MISMATCH',
      'confirmation does not match the plan'
    );
  }
  if (reviewed.rollbackArtifactDigest !== input.artifact.digest) {
    return refuse(
      'STUDENT_PROFILE_ROLLBACK_ARTIFACT_MISMATCH',
      'the supplied artifact is not the one this rollback was planned against'
    );
  }

  let entries: RollbackBeforeImageEntry[];
  try {
    entries = decryptRollbackBeforeImages({
      artifact: input.artifact,
      aad: input.rollbackAad,
      keyBase64: input.rollbackKeyBase64,
    });
  } catch (error) {
    return refuse(
      'STUDENT_PROFILE_ROLLBACK_ARTIFACT_UNAUTHENTIC',
      String((error as Error).message)
    );
  }
  const beforeImages = new Map(entries.map((entry) => [entry.entryId, entry]));

  // Everything is validated before anything is written; all-or-nothing means
  // these checks cannot be interleaved with the reversal.
  for (const effect of reviewed.documentEffects) {
    if (effect.restoreStrategy !== 'restore_before_image') continue;
    if (!effect.rollbackArtifactEntryId || !beforeImages.has(effect.rollbackArtifactEntryId)) {
      return refuse(
        'STUDENT_PROFILE_ROLLBACK_BEFORE_IMAGE_MISSING',
        `no before image for ${effect.path}`
      );
    }
  }

  const effectsByPath = new Map<string, StudentMergeDocumentEffect[]>();
  for (const effect of reviewed.documentEffects) {
    const chain = effectsByPath.get(effect.path) ?? [];
    chain.push(effect);
    effectsByPath.set(effect.path, chain);
  }
  for (const [path, chain] of effectsByPath) {
    for (let index = 0; index < chain.length - 1; index += 1) {
      if (chain[index].afterFingerprint !== chain[index + 1].beforeFingerprint) {
        return refuse(
          'STUDENT_PROFILE_ROLLBACK_EFFECT_CHAIN_INVALID',
          `${path} has a gap between planned effects ${index} and ${index + 1}`
        );
      }
    }
  }
  const rollbackPathOrder: string[] = [];
  const seenRollbackPaths = new Set<string>();
  for (const effect of [...reviewed.documentEffects].reverse()) {
    if (seenRollbackPaths.has(effect.path)) continue;
    seenRollbackPaths.add(effect.path);
    rollbackPathOrder.push(effect.path);
  }

  const reversedPaths: string[] = [];
  const drift = await store.runTransaction(async (tx) => {
    const maintenance = await tx.get(MAINTENANCE_DOC_PATH);
    if (!maintenance || maintenance.data.mode !== 'read_only') {
      return { code: 'STUDENT_PROFILE_ROLLBACK_MAINTENANCE_LOST', detail: 'writes are open' };
    }
    if (maintenance.data.activeRunId !== reviewed.runId) {
      return {
        code: 'STUDENT_PROFILE_ROLLBACK_ACTIVE_RUN_MISMATCH',
        detail: `maintenance holds ${String(maintenance.data.activeRunId ?? 'none')}`,
      };
    }
    if (maintenance.data.migrationActorId !== input.expectedActorId) {
      return {
        code: 'STUDENT_PROFILE_ROLLBACK_ACTOR_MISMATCH',
        detail: 'maintenance is owned by a different actor',
      };
    }
    // One read and one final restore per path. If a run touched a document
    // several times, the chain above proves the intermediate edges join; the
    // database only has to match the final edge before the transaction puts
    // back the first edge's before-image. Keeping every read and write inside
    // this one transaction is what makes rollback genuinely all-or-nothing.
    const currentByPath = new Map<
      string,
      { data: Record<string, unknown>; fingerprint: string } | null
    >();
    for (const path of rollbackPathOrder) {
      const chain = effectsByPath.get(path)!;
      const last = chain.at(-1)!;
      const current = (await tx.get(path)) ?? null;
      currentByPath.set(path, current);
      const observed = current?.fingerprint ?? null;
      if (observed !== last.afterFingerprint) {
        return {
          code: 'STUDENT_PROFILE_ROLLBACK_DRIFT',
          detail: `${path} is no longer the document this run produced`,
        };
      }
    }
    const restoredByPath = new Map<string, Record<string, unknown> | null>();
    for (const path of rollbackPathOrder) {
      const chain = effectsByPath.get(path)!;
      let restored = currentByPath.get(path)?.data ?? null;

      for (const effect of [...chain].reverse()) {
        if (effect.restoreStrategy === 'delete_run_created_document') {
          restored = null;
          continue;
        }
        const image = beforeImages.get(effect.rollbackArtifactEntryId!)!;
        if ((image.restoreMode ?? 'replace') === 'replace') {
          restored = image.before;
          continue;
        }
        if (restored === null) {
          return {
            code: 'STUDENT_PROFILE_ROLLBACK_PATCH_TARGET_MISSING',
            detail: `${path} cannot restore patch fields onto a missing document`,
          };
        }
        restored = restoreFieldPathPatch(
          restored,
          image.before,
          image.absentFieldPaths ?? []
        );
      }

      restoredByPath.set(path, restored);
    }

    // Stage writes only after every path can be reconstructed. A malformed
    // partial image on the last path must not leave earlier paths queued for
    // commit in stores whose transaction callback returns a refusal value.
    for (const path of rollbackPathOrder) {
      const chain = effectsByPath.get(path)!;
      const restored = restoredByPath.get(path) ?? null;
      const initialFingerprint = chain[0].beforeFingerprint;
      if (restored === null) {
        tx.delete(path);
      } else {
        tx.set(path, { data: restored, fingerprint: initialFingerprint ?? '' });
      }
      reversedPaths.push(path);
    }
    return null;
  });
  if (drift) return refuse(drift.code, drift.detail);

  return {
    status: 'rolled_back',
    runId: reviewed.runId,
    reversedPaths,
    forwardRepairRequired: false,
    refusal: null,
  };
}
