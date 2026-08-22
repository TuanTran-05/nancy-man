import { canonicalJson, sha256 } from './canonicalJson.js';
import { MAINTENANCE_DOC_PATH, type NormalizationStore } from './writerCore.js';
import { applyFieldPathPatch } from './fieldPathPatch.js';
import { decryptRollbackBeforeImages, type EncryptedRollbackArtifact, type RollbackArtifactAad } from './rollbackArtifact.js';
import {
  createStudentProfileMergeApprovalDigest,
  createStudentProfileMergePlanDigest,
  type StudentProfileMergePlanOperation,
  type StudentProfileMergePlanWrite,
  type StudentProfileMergeReviewedFile,
} from './reporter.js';

/**
 * Preflight and journaled apply.
 *
 * Preflight's job is to disprove the operator, not to agree with them. Every
 * confirmation they typed is checked against the reviewed artifact, and the
 * artifact is then checked against the live database — because a confirmation
 * matching the plan proves only that the operator read the plan, never which
 * database this process actually opened or which commit is deployed.
 *
 * Apply's job is to be resumable and to never half-finish. Each operation runs
 * in its own transaction that re-reads the maintenance guard, the source
 * document, its dependencies, and its own journal entry before it writes
 * anything, and records its journal entry in the same transaction as the
 * effect. That pairing is what makes "did this operation run?" answerable after
 * a crash: there is no window where the write landed and the record did not.
 *
 * The guard is re-read inside every operation transaction rather than trusted
 * from preflight, because writes reopening mid-run is precisely the race the
 * maintenance window exists to prevent.
 */

export {
  MAINTENANCE_DOC_PATH,
  type NormalizationStore,
  type NormalizationTransaction,
} from './writerCore.js';
export * from './rollback.js';

const JOURNAL_COLLECTION = 'student_profile_merge_journal';
const RUN_COLLECTION = 'student_profile_merge_runs';

const WRITE_MODES = new Set(['copy_source', 'set', 'patch', 'delete']);

export type NormalizationOperation = Required<
  Pick<StudentProfileMergePlanOperation, 'operationId' | 'stage' | 'registryEntryId' | 'kind' | 'dependsOn' | 'expectedAfterFingerprint'>
> & {
  groupId: string;
  sourcePath: string | null;
  targetPath: string | null;
  sourceFingerprint: string | null;
  targetBeforeFingerprint: string | null;
  write: StudentProfileMergePlanWrite;
};

export type NormalizationJournalRecord = {
  runId: string;
  operationId: string;
  groupId: string;
  stage: string;
  status: 'pending' | 'applied' | 'failed';
  sourcePath: string | null;
  targetPath: string | null;
  expectedAfterFingerprint: string | null;
  errorCode?: string;
};

export type PreflightedStudentProfileNormalization = {
  status: 'preflighted';
  runId: string;
  actorId: string;
  operations: NormalizationOperation[];
  journalSkeletons: NormalizationJournalRecord[];
};

/**
 * Derived from content, never authored. An operation whose id does not hash
 * from its own fields is a hand-edited plan, and preflight refuses it.
 */
export function deriveNormalizationOperationId(input: {
  groupId: string;
  stage: string;
  registryEntryId: string;
  sourcePath: string | null;
  targetPath: string | null;
  expectedAfterFingerprint: string | null;
  /**
   * Part of the identity, not decoration. Two operations that differ only in
   * what they write are two different operations, and sharing an id would let
   * an approval cover neither of them in particular.
   */
  write?: StudentProfileMergePlanWrite;
}): string {
  return sha256(
    canonicalJson({
      groupId: input.groupId,
      stage: input.stage,
      registryEntryId: input.registryEntryId,
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      expectedAfterFingerprint: input.expectedAfterFingerprint,
      write: input.write ?? null,
    })
  ).slice(0, 32);
}

function confirm(label: string, expected: unknown, actual: unknown): void {
  if (expected !== actual) {
    // Values are plan and target identifiers, not secrets, and naming them is
    // what lets an operator see which of eight confirmations they mistyped.
    throw new Error(
      `STUDENT_PROFILE_PREFLIGHT_CONFIRMATION_MISMATCH: ${label} confirmed as ${String(
        actual
      )}, artifact says ${String(expected)}`
    );
  }
}

export function preflightStudentProfileNormalization(input: {
  reviewed: StudentProfileMergeReviewedFile;
  rollbackArtifact: EncryptedRollbackArtifact;
  rollbackAad: RollbackArtifactAad;
  rollbackKeyBase64: string;
  confirmations: {
    planDigest: string;
    approvalDigest: string;
    projectId: string;
    databaseId: string;
    sourceCommit: string;
    exportOperationId: string;
    actorId: string;
    runId: string;
  };
  observed: {
    projectId: string;
    databaseId: string;
    currentCommit: string;
    registryVersion: string;
    maintenanceMode: string;
    activeRunId: string | null;
    migrationActorId: string | null;
  };
}): PreflightedStudentProfileNormalization {
  const { reviewed, confirmations, observed } = input;
  const plan = reviewed.plan;

  if (reviewed.approved !== true || reviewed.applyable !== true) {
    throw new Error('STUDENT_PROFILE_PREFLIGHT_PLAN_NOT_APPLYABLE');
  }

  // Re-derive both digests from the artifact's own contents. A file whose
  // digest field was edited to match the operator's confirmation still fails
  // here, because the contents no longer hash to it.
  const recomputedPlanDigest = createStudentProfileMergePlanDigest(plan);
  if (recomputedPlanDigest !== reviewed.planDigest) {
    throw new Error('STUDENT_PROFILE_PREFLIGHT_PLAN_DIGEST_MISMATCH');
  }
  const recomputedApprovalDigest = createStudentProfileMergeApprovalDigest({
    planDigest: reviewed.planDigest,
    approvals: reviewed.approvals,
  });
  if (recomputedApprovalDigest !== reviewed.approvalDigest) {
    throw new Error('STUDENT_PROFILE_PREFLIGHT_APPROVAL_DIGEST_MISMATCH');
  }

  confirm('planDigest', reviewed.planDigest, confirmations.planDigest);
  confirm('approvalDigest', reviewed.approvalDigest, confirmations.approvalDigest);
  confirm('projectId', plan.target.projectId, confirmations.projectId);
  confirm('databaseId', plan.target.databaseId, confirmations.databaseId);
  confirm('sourceCommit', plan.sourceCommit, confirmations.sourceCommit);
  confirm('runId', plan.runId, confirmations.runId);
  confirm(
    'exportOperationId',
    plan.exportEvidence?.operationName ?? null,
    confirmations.exportOperationId
  );

  // Against the live process, not against the artifact the operator just read.
  if (
    observed.projectId !== plan.target.projectId ||
    observed.databaseId !== plan.target.databaseId
  ) {
    throw new Error(
      `STUDENT_PROFILE_PREFLIGHT_TARGET_MISMATCH: connected to ` +
        `${observed.projectId}/${observed.databaseId}, plan targets ` +
        `${plan.target.projectId}/${plan.target.databaseId}`
    );
  }
  if (observed.currentCommit !== plan.sourceCommit) {
    throw new Error(
      `STUDENT_PROFILE_PREFLIGHT_COMMIT_DRIFT: deployed ${observed.currentCommit}, ` +
        `plan built against ${plan.sourceCommit}`
    );
  }
  if (observed.registryVersion !== plan.registryVersion) {
    throw new Error('STUDENT_PROFILE_PREFLIGHT_REGISTRY_VERSION_MISMATCH');
  }
  if (observed.maintenanceMode !== 'read_only') {
    throw new Error(
      `STUDENT_PROFILE_PREFLIGHT_MAINTENANCE_NOT_READ_ONLY: ${observed.maintenanceMode}`
    );
  }
  if (observed.activeRunId !== plan.runId) {
    throw new Error(
      `STUDENT_PROFILE_PREFLIGHT_ACTIVE_RUN_MISMATCH: maintenance holds ${observed.activeRunId ?? 'none'}`
    );
  }
  if (observed.migrationActorId !== confirmations.actorId) {
    throw new Error('STUDENT_PROFILE_PREFLIGHT_MIGRATION_ACTOR_MISMATCH');
  }

  const blockers = [...plan.blockers, ...plan.groups.flatMap((group) => group.blockers)];
  if (blockers.length > 0) {
    throw new Error(
      `STUDENT_PROFILE_PREFLIGHT_PLAN_HAS_BLOCKERS: ${blockers.map((b) => b.code).join(', ')}`
    );
  }

  if (!plan.rollbackArtifact) {
    throw new Error('STUDENT_PROFILE_PREFLIGHT_ROLLBACK_ARTIFACT_MISSING');
  }
  if (plan.rollbackArtifact.digest !== input.rollbackArtifact.digest) {
    throw new Error(
      'STUDENT_PROFILE_PREFLIGHT_ROLLBACK_ARTIFACT_MISMATCH: ' +
        'the supplied artifact is not the one this plan was approved with'
    );
  }
  // Opened, not merely digested. An artifact that cannot be decrypted is not a
  // rollback path, and apply must not begin without one.
  const entries = decryptRollbackBeforeImages({
    artifact: input.rollbackArtifact,
    aad: input.rollbackAad,
    keyBase64: input.rollbackKeyBase64,
  });
  if (entries.length !== plan.rollbackArtifact.entryCount) {
    throw new Error('STUDENT_PROFILE_PREFLIGHT_ROLLBACK_ARTIFACT_MISMATCH: entry count');
  }

  const operations: NormalizationOperation[] = [];
  for (const group of plan.groups) {
    for (const operation of group.operations) {
      if (
        !operation.registryEntryId ||
        !operation.kind ||
        operation.expectedAfterFingerprint === undefined ||
        operation.targetBeforeFingerprint === undefined ||
        operation.dependsOn === undefined
      ) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE: ${operation.operationId}`
        );
      }
      // An operation that cannot say what it writes is one that journals
      // itself applied while touching nothing. That is worse than a failure:
      // the run reports success and the group is left half-normalized.
      const write = operation.write;
      if (!write || !WRITE_MODES.has(write.mode)) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE: ${operation.operationId} ` +
            `has no usable write instruction`
        );
      }
      if (!operation.targetPath) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE: ${operation.operationId} names no target`
        );
      }
      if (write.mode === 'copy_source' && !operation.sourcePath) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE: ${operation.operationId} ` +
            `copies a source it does not name`
        );
      }
      if ((write.mode === 'set' || write.mode === 'patch') && !write.payload) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE: ${operation.operationId} ` +
            `carries no payload`
        );
      }
      if (write.mode === 'delete' && operation.expectedAfterFingerprint !== null) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE: ${operation.operationId} ` +
            'delete must expect an absent target'
        );
      }
      if (write.mode !== 'delete' && operation.expectedAfterFingerprint === null) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE: ${operation.operationId} ` +
            'a write must expect a document fingerprint'
        );
      }
      const expectedId = deriveNormalizationOperationId({
        groupId: group.groupId,
        stage: operation.stage,
        registryEntryId: operation.registryEntryId,
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
        expectedAfterFingerprint: operation.expectedAfterFingerprint,
        write: operation.write,
      });
      if (expectedId !== operation.operationId) {
        throw new Error(
          `STUDENT_PROFILE_PREFLIGHT_OPERATION_ID_MISMATCH: ${operation.operationId} ` +
            `does not hash from its own content`
        );
      }
      operations.push({
        operationId: operation.operationId,
        groupId: group.groupId,
        stage: operation.stage,
        registryEntryId: operation.registryEntryId,
        kind: operation.kind,
        dependsOn: operation.dependsOn,
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
        sourceFingerprint: operation.sourceFingerprint ?? null,
        targetBeforeFingerprint: operation.targetBeforeFingerprint,
        expectedAfterFingerprint: operation.expectedAfterFingerprint,
        write,
      });
    }
  }

  return {
    status: 'preflighted',
    runId: plan.runId,
    actorId: confirmations.actorId,
    operations,
    journalSkeletons: operations.map((operation) => ({
      runId: plan.runId,
      operationId: operation.operationId,
      groupId: operation.groupId,
      stage: operation.stage,
      status: 'pending' as const,
      sourcePath: operation.sourcePath,
      targetPath: operation.targetPath,
      expectedAfterFingerprint: operation.expectedAfterFingerprint,
    })),
  };
}

// --- Apply ---


export type StudentProfileNormalizationApplyResult = {
  status: 'applied' | 'failed';
  runId: string;
  appliedOperationIds: string[];
  skippedOperationIds: string[];
  failure: { operationId: string; code: string } | null;
};

function journalPath(runId: string, operationId: string): string {
  return `${JOURNAL_COLLECTION}/${runId}_${operationId}`;
}

/** Thrown inside a transaction to carry a stable code out to the run loop. */
class OperationFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function applyStudentProfileNormalization(input: {
  preflighted: PreflightedStudentProfileNormalization;
  store: NormalizationStore;
}): Promise<StudentProfileNormalizationApplyResult> {
  const { preflighted, store } = input;
  const runId = preflighted.runId;
  const applied: string[] = [];
  const skipped: string[] = [];
  const satisfied = new Set<string>();

  for (const operation of preflighted.operations) {
    const outcome = await store.runTransaction(async (tx) => {
      // 1. The guard, freshly. Preflight's reading of it is already stale.
      const maintenance = await tx.get(MAINTENANCE_DOC_PATH);
      if (!maintenance || maintenance.data.mode !== 'read_only') {
        return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_MAINTENANCE_LOST' };
      }
      if (maintenance.data.activeRunId !== runId) {
        return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_ACTIVE_RUN_CHANGED' };
      }
      if (maintenance.data.migrationActorId !== preflighted.actorId) {
        return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_MIGRATION_ACTOR_CHANGED' };
      }
      const runPath = `${RUN_COLLECTION}/${runId}`;
      const run = await tx.get(runPath);
      if (!run || !['prepared', 'applying', 'applied'].includes(String(run.data.status ?? ''))) {
        return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_RUN_NOT_PREPARED' };
      }

      // 2. Our own journal entry, which decides retry versus refusal.
      const journal = await tx.get(journalPath(runId, operation.operationId));
      if (journal?.data.status === 'applied') {
        const target = operation.targetPath ? ((await tx.get(operation.targetPath)) ?? null) : null;
        const observedTarget = target?.fingerprint ?? null;
        if (observedTarget !== operation.expectedAfterFingerprint) {
          return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_JOURNAL_AFTER_DRIFT' };
        }
        if (operation.write.mode === 'copy_source' && operation.sourcePath) {
          const source = (await tx.get(operation.sourcePath)) ?? null;
          if (source) {
            return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_JOURNAL_SOURCE_REAPPEARED' };
          }
        }
        return { kind: 'skipped' as const };
      }
      if (journal?.data.status === 'failed') {
        // A previous failure needs a human decision. Retrying silently would
        // paper over whatever caused it.
        return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_JOURNAL_FAILED_PRESENT' };
      }
      if (run.data.status === 'applied') {
        return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_RUN_COMPLETE_JOURNAL_MISSING' };
      }

      // 3. Dependencies, read from their journals rather than assumed from
      //    loop order, so a resumed run reaches the same conclusion.
      for (const dependencyId of operation.dependsOn) {
        if (satisfied.has(dependencyId)) continue;
        const dependency = await tx.get(journalPath(runId, dependencyId));
        if (dependency?.data.status !== 'applied') {
          return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_DEPENDENCY_UNSATISFIED' };
        }
      }

      // 4. The source, compared against the fingerprint the reviewer approved.
      let sourceDoc: { data: Record<string, unknown>; fingerprint: string } | null = null;
      if (operation.sourcePath) {
        sourceDoc = (await tx.get(operation.sourcePath)) ?? null;
        if (!sourceDoc) {
          return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_SOURCE_MISSING' };
        }
        if (
          operation.sourceFingerprint !== null &&
          sourceDoc.fingerprint !== operation.sourceFingerprint
        ) {
          return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_SOURCE_DRIFT' };
        }
      }

      // 5. The target is the document the reviewer saw, including absence.
      // A source match alone does not authorize overwriting a target that was
      // created or edited after the final audit.
      const targetPath = operation.targetPath as string;
      const targetBefore = (await tx.get(targetPath)) ?? null;
      if ((targetBefore?.fingerprint ?? null) !== operation.targetBeforeFingerprint) {
        return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_TARGET_DRIFT' };
      }

      // 6. The effect and its journal entry, in one transaction. There is no
      //    window where the write landed and the record did not.
      if (operation.write.mode === 'delete') {
        tx.delete(targetPath);
      } else if (operation.write.mode === 'patch') {
        // Merged onto what is there, and only onto what is there. A patch that
        // created its target would invent a record nobody reviewed, and the
        // absence is itself drift: the plan was built where it existed.
        if (!targetBefore) {
          return { kind: 'failed' as const, code: 'STUDENT_PROFILE_APPLY_TARGET_MISSING' };
        }
        tx.set(targetPath, {
          data: applyFieldPathPatch(targetBefore.data, operation.write.payload),
          fingerprint: operation.expectedAfterFingerprint as string,
        });
      } else if (operation.write.mode === 'set') {
        tx.set(targetPath, {
          data: operation.write.payload,
          fingerprint: operation.expectedAfterFingerprint as string,
        });
      } else if (sourceDoc) {
        tx.set(targetPath, {
          data: sourceDoc.data,
          fingerprint: operation.expectedAfterFingerprint as string,
        });
        tx.delete(operation.sourcePath as string);
      }
      tx.set(journalPath(runId, operation.operationId), {
        data: {
          runId,
          operationId: operation.operationId,
          groupId: operation.groupId,
          stage: operation.stage,
          status: 'applied',
          sourcePath: operation.sourcePath,
          targetPath: operation.targetPath,
          expectedAfterFingerprint: operation.expectedAfterFingerprint,
        },
        fingerprint: operation.expectedAfterFingerprint ?? 'deleted',
      });
      const nextAppliedCount = Number(run.data.appliedOperationCount ?? 0) + 1;
      tx.set(runPath, {
        data: {
          ...run.data,
          status: 'applying',
          appliedOperationCount: nextAppliedCount,
          pendingOperationCount: Math.max(preflighted.operations.length - nextAppliedCount, 0),
        },
        fingerprint: 'applying',
      });
      return { kind: 'applied' as const };
    });

    if (outcome.kind === 'skipped') {
      skipped.push(operation.operationId);
      satisfied.add(operation.operationId);
      continue;
    }
    if (outcome.kind === 'applied') {
      applied.push(operation.operationId);
      satisfied.add(operation.operationId);
      continue;
    }

    // Record the failure in its own transaction so the reason survives, then
    // stop. Continuing past a failure would apply operations whose
    // preconditions were established by the one that did not run.
    if (outcome.code !== 'STUDENT_PROFILE_APPLY_JOURNAL_FAILED_PRESENT') {
      await store.runTransaction(async (tx) => {
        const runPath = `${RUN_COLLECTION}/${runId}`;
        const run = await tx.get(runPath);
        tx.set(journalPath(runId, operation.operationId), {
          data: {
            runId,
            operationId: operation.operationId,
            groupId: operation.groupId,
            stage: operation.stage,
            status: 'failed',
            errorCode: outcome.code,
            sourcePath: operation.sourcePath,
            targetPath: operation.targetPath,
            expectedAfterFingerprint: operation.expectedAfterFingerprint,
          },
          fingerprint: 'failed',
        });
        if (run) {
          const appliedCount = Number(run.data.appliedOperationCount ?? 0);
          tx.set(runPath, {
            data: {
              ...run.data,
              status: appliedCount === 0 ? 'aborted' : 'failed',
              failedOperationCount: Number(run.data.failedOperationCount ?? 0) + 1,
              pendingOperationCount: Math.max(
                preflighted.operations.length - appliedCount - 1,
                0
              ),
              lastErrorCode: outcome.code,
            },
            fingerprint: appliedCount === 0 ? 'aborted' : 'failed',
          });
        }
      });
    }

    return {
      status: 'failed',
      runId,
      appliedOperationIds: applied,
      skippedOperationIds: skipped,
      failure: { operationId: operation.operationId, code: outcome.code },
    };
  }

  await store.runTransaction(async (tx) => {
    const maintenance = await tx.get(MAINTENANCE_DOC_PATH);
    if (
      !maintenance ||
      maintenance.data.mode !== 'read_only' ||
      maintenance.data.activeRunId !== runId ||
      maintenance.data.migrationActorId !== preflighted.actorId
    ) {
      throw new Error('STUDENT_PROFILE_APPLY_MAINTENANCE_LOST_BEFORE_COMPLETION');
    }
    const runPath = `${RUN_COLLECTION}/${runId}`;
    const run = await tx.get(runPath);
    if (!run || Number(run.data.appliedOperationCount ?? -1) !== preflighted.operations.length) {
      throw new Error('STUDENT_PROFILE_APPLY_RUN_COUNT_INCOMPLETE');
    }
    tx.set(runPath, {
      data: {
        ...run.data,
        status: 'applied',
        plannedOperationCount: preflighted.operations.length,
        pendingOperationCount: 0,
        failedOperationCount: 0,
      },
      fingerprint: 'applied',
    });
  });

  return {
    status: 'applied',
    runId,
    appliedOperationIds: applied,
    skippedOperationIds: skipped,
    failure: null,
  };
}

export { OperationFailure };
