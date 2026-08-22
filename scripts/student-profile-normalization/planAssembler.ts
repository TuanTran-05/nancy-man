import { fingerprintDocumentProjection } from './canonicalJson.js';
import {
  buildContainedStudentReferenceValue,
  getStudentReferenceSpec,
} from './referenceRegistry.js';
import { reconcileStudentProfileFields } from './profileReconciler.js';
import { reconcileStudentFinance, type FinanceProfileSource } from './financeReconciler.js';
import { reconcileStudentCredentialsAndUsers } from './credentialReconciler.js';
import { deriveNormalizationOperationId } from './writer.js';
import type { StudentIdentityCandidate } from './planner.js';
import type { StudentReferenceInventory } from './inventory.js';
import type { LinkedUserMetadata, StudentCredentialMetadata } from './authSources.js';
import type { StudentMergeBlocker } from './types.js';
import type {
  StudentProfileMergePlan,
  StudentProfileMergePlanGroup,
  StudentProfileMergePlanOperation,
  StudentProfileMergePlanWrite,
} from './reporter.js';

/**
 * Candidates and reconcilers, assembled into a plan somebody can review.
 *
 * Every part of this existed already: the candidate detector, the three
 * reconcilers, the reference registry, the executor. What did not exist was
 * the step that turns them into a list of operations — so the engine could
 * apply a plan and nothing could produce one, which made every mode after the
 * audit unreachable no matter how complete it was.
 *
 * Two rules govern what comes out.
 *
 * Stage order is fixed and dependencies are explicit. Codes are claimed before
 * aliases exist, aliases before the tombstone is laid, and the tombstone last,
 * because an alias pointing at a profile whose code another document still
 * owns is worse than no alias at all. The executor reads `dependsOn` from the
 * journal rather than from loop order, so a resumed run reaches the same
 * conclusion as an uninterrupted one.
 *
 * A preliminary audit emits the same shape with no execution fields. It is
 * produced before the export exists, from reads nobody has bound to a
 * snapshot, and an executable operation built from those is an artifact that
 * could be approved by mistake.
 */

export type NormalizationPlanSources = {
  runId: string;
  auditPhase: 'preliminary' | 'final';
  sourceCommit: string;
  registryVersion: string;
  target: { projectId: string; databaseId: string };
  exportEvidence: StudentProfileMergePlan['exportEvidence'];
  rollbackArtifact: StudentProfileMergePlan['rollbackArtifact'];
  actorId: string;
  now: string;
  candidates: readonly StudentIdentityCandidate[];
  /** Raw `students/{id}` documents for every profile named by a candidate. */
  profiles: Record<string, Record<string, unknown>>;
  finance: Record<string, FinanceProfileSource>;
  credentials: readonly StudentCredentialMetadata[];
  linkedUsers: readonly LinkedUserMetadata[];
  inventory: StudentReferenceInventory;
  /** Field-level choices a reviewer made, keyed by field path. */
  approvedFieldSources?: Record<string, string>;
};

/** Decisions that produce merge operations. Everything else is reported only. */
const MERGING_DECISIONS = new Set(['merge_same_human', 'audit_alias']);

/**
 * Rewrite kinds that mean "leave the id where it is".
 *
 * An immutable record names the profile that was correct when it was written.
 * Rewriting it edits the account of what happened; the alias is what makes it
 * resolve.
 */
const PRESERVED_REWRITE_KINDS = new Set(['preserve_via_alias']);

function sumTotals(
  totals: readonly Record<string, number>[]
): Record<string, number> {
  const summed: Record<string, number> = {};
  for (const entry of totals) {
    for (const [key, value] of Object.entries(entry)) {
      summed[key] = (summed[key] ?? 0) + value;
    }
  }
  return summed;
}

/**
 * The tombstone, exactly as `shared/studentIdentity.ts` defines it.
 *
 * Written here rather than assembled at apply time so a reviewer sees the
 * fields that will land, and so no local variant can drift from the predicate
 * every other workstream reads it with.
 */
function tombstonePayload(input: {
  canonicalProfileId: string;
  runId: string;
  now: string;
  sourceFingerprint: string;
}): Record<string, unknown> {
  return {
    studentProfileState: 'merged_tombstone',
    canonicalProfileId: input.canonicalProfileId,
    mergeRunId: input.runId,
    mergedAt: input.now,
    identityWriteDisabled: true,
    authDisabled: true,
    walletOwnership: 'canonicalized',
    tombstoneSourceFingerprint: input.sourceFingerprint,
  };
}

export function planStudentProfileNormalization(
  sources: NormalizationPlanSources
): StudentProfileMergePlan {
  const isFinal = sources.auditPhase === 'final';
  const groups: StudentProfileMergePlanGroup[] = [];
  const planBlockers: StudentMergeBlocker[] = [];

  // Global, not per group: an unknown reference means the registry cannot say
  // what would happen to a document, and that is not a fact about one merge.
  for (const unknown of sources.inventory.unknown) {
    planBlockers.push({
      code: 'UNKNOWN_REFERENCE',
      candidateId: '',
      detail: `${unknown.documentPath} names ${unknown.matchedProfileIds.join(', ')}`,
    });
  }

  const orderedCandidates = [...sources.candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId)
  );

  for (const candidate of orderedCandidates) {
    const canonicalProfileId = candidate.proposedCanonicalProfileId ?? '';
    const legacyProfileIds = candidate.profileIds
      .filter((id) => id !== canonicalProfileId)
      .sort();

    const groupBlockers: StudentMergeBlocker[] = [...candidate.blockers];
    const operations: StudentProfileMergePlanOperation[] = [];
    const decisions: Record<string, unknown> = { identity: candidate.decision };

    const financeSources = candidate.profileIds
      .map((id) => sources.finance[id])
      .filter((entry): entry is FinanceProfileSource => Boolean(entry));
    const finance = canonicalProfileId
      ? reconcileStudentFinance({ canonicalProfileId, profiles: financeSources })
      : null;
    const money = finance
      ? { before: { ...finance.before }, expectedAfter: { ...finance.expectedAfter } }
      : { before: {}, expectedAfter: {} };

    if (!MERGING_DECISIONS.has(candidate.decision)) {
      // Reported, never merged. `confirmed_distinct_person` is evidence that
      // somebody looked and said these are two children; a hold or an
      // unreviewed candidate is the absence of that, and only the second is a
      // blocker.
      if (candidate.decision !== 'confirmed_distinct_person') {
        groupBlockers.push({
          code: 'IDENTITY_DECISION_REQUIRED',
          candidateId: candidate.candidateId,
          detail: `${candidate.candidateId} is ${candidate.decision}`,
        });
      }
      groups.push({
        groupId: candidate.candidateId,
        canonicalProfileId,
        legacyProfileIds,
        candidateKind: candidate.kind,
        evidenceFingerprint: candidate.evidenceFingerprint,
        operations: [],
        documentEffects: [],
        decisions,
        money,
        blockers: groupBlockers,
      });
      continue;
    }

    if (!canonicalProfileId) {
      groupBlockers.push({
        code: 'CANONICAL_PROFILE_UNSELECTED',
        candidateId: candidate.candidateId,
        detail: `${candidate.candidateId} has no proposed canonical profile`,
      });
    }

    if (finance) groupBlockers.push(...finance.blockers);

    const profileDocs = candidate.profileIds
      .map((id) => ({ id, data: sources.profiles[id] }))
      .filter((entry): entry is { id: string; data: Record<string, unknown> } =>
        Boolean(entry.data)
      );
    const profileReconciliation = canonicalProfileId
      ? reconcileStudentProfileFields({
          canonicalProfileId,
          profiles: profileDocs,
          approvedFieldSources: sources.approvedFieldSources,
        })
      : null;
    if (profileReconciliation) {
      groupBlockers.push(...profileReconciliation.blockers);
      decisions.profileFields = profileReconciliation.decisions;
    }

    const groupProfileIds = new Set(candidate.profileIds);
    const credentials = sources.credentials.filter((entry) =>
      groupProfileIds.has(entry.profileId)
    );
    const linkedUsers = sources.linkedUsers.filter(
      (entry) =>
        (entry.idProfileId && groupProfileIds.has(entry.idProfileId)) ||
        (entry.fieldProfileId && groupProfileIds.has(entry.fieldProfileId))
    );
    const credentialReconciliation = canonicalProfileId
      ? reconcileStudentCredentialsAndUsers({ canonicalProfileId, credentials, linkedUsers })
      : null;
    if (credentialReconciliation) {
      groupBlockers.push(...credentialReconciliation.blockers);
      decisions.credential = credentialReconciliation.decision;
    }

    let previousOperationId: string | null = null;
    const push = (input: {
      stage: string;
      registryEntryId: string;
      kind: string;
      sourcePath: string | null;
      targetPath: string;
      write: StudentProfileMergePlanWrite;
      afterData: Record<string, unknown> | null;
      sourceFingerprint?: string | null;
    }) => {
      const operation: StudentProfileMergePlanOperation = {
        operationId: '',
        stage: input.stage,
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
      };
      if (isFinal) {
        operation.registryEntryId = input.registryEntryId;
        operation.kind = input.kind;
        operation.dependsOn = previousOperationId ? [previousOperationId] : [];
        operation.sourceFingerprint = input.sourceFingerprint ?? null;
        operation.expectedAfterFingerprint = fingerprintDocumentProjection(input.afterData ?? {});
        operation.write = input.write;
      }
      operation.operationId = deriveNormalizationOperationId({
        groupId: candidate.candidateId,
        stage: input.stage,
        registryEntryId: input.registryEntryId,
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        expectedAfterFingerprint: operation.expectedAfterFingerprint ?? '',
        write: operation.write,
      });
      operations.push(operation);
      previousOperationId = operation.operationId;
      return operation;
    };

    if (canonicalProfileId) {
      // 1. Codes, before anything resolves through them.
      for (const code of [...candidate.normalizedCodes].sort()) {
        const payload = {
          normalizedCode: code,
          canonicalProfileId,
          isPrimary: code === String(sources.profiles[canonicalProfileId]?.studentId ?? ''),
          status: 'alias',
          mergeRunId: sources.runId,
          updatedAt: sources.now,
          updatedBy: sources.actorId,
        };
        push({
          stage: 'claim_codes',
          registryEntryId: 'student_code_registry.claim',
          kind: 'claim_registry',
          sourcePath: null,
          targetPath: `student_code_registry/${code}`,
          write: { mode: 'set', payload },
          afterData: payload,
        });
      }

      // 2. Aliases, so every retired id keeps resolving from here on.
      for (const legacyProfileId of legacyProfileIds) {
        const payload = {
          legacyProfileId,
          canonicalProfileId,
          mergeRunId: sources.runId,
          reasonCode: 'profile_normalization',
          sourceFingerprint: fingerprintDocumentProjection(
            sources.profiles[legacyProfileId] ?? {}
          ),
          createdAt: sources.now,
          createdBy: sources.actorId,
        };
        push({
          stage: 'create_aliases',
          registryEntryId: 'student_profile_aliases.alias',
          kind: 'create_alias',
          sourcePath: null,
          targetPath: `student_profile_aliases/${legacyProfileId}`,
          write: { mode: 'set', payload },
          afterData: payload,
        });
      }

      // 3. The reconciled profile, only where a field actually changes.
      if (profileReconciliation && Object.keys(profileReconciliation.canonicalPatch).length > 0) {
        push({
          stage: 'reconcile_profile',
          registryEntryId: 'students.profile',
          kind: 'patch_field',
          sourcePath: null,
          targetPath: `students/${canonicalProfileId}`,
          write: { mode: 'patch', payload: profileReconciliation.canonicalPatch },
          afterData: {
            ...(sources.profiles[canonicalProfileId] ?? {}),
            ...profileReconciliation.canonicalPatch,
          },
        });
      }

      // 4. Keyed finance moves, planned by the reconciler that owns the money.
      for (const move of finance?.operations ?? []) {
        push({
          stage: 'move_finance_keys',
          registryEntryId: move.registryEntryId,
          kind: 'recreate_document',
          sourcePath: move.sourcePath,
          targetPath: move.targetPath,
          write: { mode: 'copy_source' },
          afterData: null,
        });
      }

      // 5. Everything else that names a retired id, from the inventory.
      const rewrites = sources.inventory.known
        .filter((match) =>
          match.matchedProfileIds.some((id) => legacyProfileIds.includes(id))
        )
        .filter((match) => {
          const spec = getStudentReferenceSpec(match.registryEntryId);
          return !PRESERVED_REWRITE_KINDS.has(spec.rewriteKind) && !spec.mayRetainLegacyId;
        })
        .sort((left, right) => left.documentPath.localeCompare(right.documentPath));

      for (const match of rewrites) {
        const spec = getStudentReferenceSpec(match.registryEntryId);

        // These records are already owned by dedicated stages below. Letting
        // the generic field rewriter see the derived summary would first try
        // to patch `__documentId__` (which is not a DocumentStore field) and then
        // delete the same document in `rebuild_projections`. The registry
        // strategy is the authority: delete/rebuild means no in-place patch.
        if (spec.rewriteKind === 'delete_and_rebuild') {
          if (spec.id !== 'accounting_student_summaries.derived') {
            groupBlockers.push({
              code: 'REFERENCE_DOCUMENT_REKEY_REQUIRED',
              candidateId: candidate.candidateId,
              detail: `${match.documentPath} requires unplanned ${spec.rewriteKind}`,
            });
          }
          continue;
        }

        // Code ownership is emitted in `claim_codes`, from the candidate's
        // complete normalized-code set. A second generic patch would be a
        // competing implementation of the same registry strategy.
        if (spec.rewriteKind === 'claim_registry') continue;

        // Only the fields that actually name a retired id are this group's
        // business. A document reaches here because *something* in it named a
        // retired profile, which is not the same as every matched field having
        // done so: a linked account keyed `users/student:<canonicalId>` can
        // carry a stale `studentId`, and its `uid` and document key name the
        // canonical id that is already correct. Rewriting the whole matched
        // set would flatten `student:<canonicalId>` to `<canonicalId>` and
        // break a live auth account.
        const retiredFields = match.fieldMatches.filter((field) =>
          field.profileIds.some((id) => legacyProfileIds.includes(id))
        );
        if (retiredFields.length === 0) continue;

        const retiredDocumentKey = retiredFields.some(
          (field) => field.fieldPath === '__documentId__'
        );
        if (retiredDocumentKey) {
          groupBlockers.push({
            code: 'REFERENCE_DOCUMENT_REKEY_REQUIRED',
            candidateId: candidate.candidateId,
            detail: `${match.documentPath} has a document key owned by a retired profile`,
          });
          continue;
        }

        // The one safe in-place remainder of a deterministic user move is a
        // document whose key is already canonical while `studentId` or `uid`
        // still names the retired profile. Production has exactly this shape.
        // Other recreate_document entries need source data, target-key
        // construction and collision checks from their owning reconciler;
        // pretending they are ordinary patches would strand an opaque key.
        if (
          spec.rewriteKind === 'recreate_document' &&
          spec.id !== 'users.deterministic'
        ) {
          groupBlockers.push({
            code: 'REFERENCE_DOCUMENT_REKEY_REQUIRED',
            candidateId: candidate.candidateId,
            detail: `${match.documentPath} requires ${spec.rewriteStrategyId}`,
          });
          continue;
        }

        // A field that only *contains* the id cannot be repointed by
        // assigning the canonical id to it. A receipt's `ledgerId` is
        // `<studentId>__<courseId>`; writing the bare profile id over it
        // replaces a composite key with half of one and orphans the receipt
        // from its ledger. There is no safe default here — rebuilding the key
        // needs the strategy that knows how it is composed — so the group
        // stops and says which field it could not express.
        const payloadEntries: Array<[string, unknown]> = [];
        const unexpressible: string[] = [];
        for (const field of retiredFields) {
          if (!field.contained) {
            payloadEntries.push([field.fieldPath, canonicalProfileId]);
            continue;
          }

          const rebuilt = buildContainedStudentReferenceValue({
            specId: match.registryEntryId,
            fieldPath: field.fieldPath,
            documentPath: match.documentPath,
            canonicalProfileId,
          });
          if (rebuilt === null) unexpressible.push(field.fieldPath);
          else payloadEntries.push([field.fieldPath, rebuilt]);
        }

        if (unexpressible.length > 0) {
          groupBlockers.push({
            code: 'REFERENCE_VALUE_NOT_A_BARE_ID',
            candidateId: candidate.candidateId,
            detail: `${match.documentPath} carries the id inside ${unexpressible.sort().join(', ')}`,
          });
          continue;
        }

        const payload = Object.fromEntries(
          payloadEntries.sort(([left], [right]) => left.localeCompare(right))
        );
        push({
          stage:
            spec.collectionPath === 'users'
              ? 'rewrite_linked_users'
              : 'rewrite_references',
          registryEntryId: match.registryEntryId,
          kind:
            spec.rewriteKind === 'recreate_document'
              ? 'patch_field'
              : spec.rewriteKind,
          sourcePath: null,
          targetPath: match.documentPath,
          write: { mode: 'patch', payload },
          afterData: payload,
        });
      }

      // 6. Auth ownership, whose decision is metadata-only by construction.
      for (const move of credentialReconciliation?.operations ?? []) {
        if (!move.targetPath) continue;
        push({
          stage: move.stage,
          registryEntryId:
            move.stage === 'select_credentials'
              ? 'student_auth_credentials.metadata'
              : 'users.deterministic_identity',
          kind: move.kind,
          sourcePath: move.sourcePath,
          targetPath: move.targetPath,
          write: { mode: 'copy_source' },
          afterData: null,
        });
      }

      // 7. Stale derived rows, deleted rather than rewritten: the canonical
      //    one is rebuilt from sources afterwards.
      for (const legacyProfileId of legacyProfileIds) {
        push({
          stage: 'rebuild_projections',
          registryEntryId: 'accounting_student_summaries.owner',
          kind: 'delete_and_rebuild',
          sourcePath: null,
          targetPath: `accounting_student_summaries/${legacyProfileId}`,
          write: { mode: 'delete' },
          afterData: null,
        });
      }

      // 8. The tombstone, last, once everything else about the group verifies.
      for (const legacyProfileId of legacyProfileIds) {
        const before = sources.profiles[legacyProfileId] ?? {};
        const payload = tombstonePayload({
          canonicalProfileId,
          runId: sources.runId,
          now: sources.now,
          sourceFingerprint: fingerprintDocumentProjection(before),
        });
        push({
          stage: 'tombstone_legacy',
          registryEntryId: 'students.profile',
          kind: 'patch_field',
          sourcePath: null,
          targetPath: `students/${legacyProfileId}`,
          write: { mode: 'patch', payload },
          afterData: { ...before, ...payload },
        });
      }
    }

    groups.push({
      groupId: candidate.candidateId,
      canonicalProfileId,
      legacyProfileIds,
      candidateKind: candidate.kind,
      evidenceFingerprint: candidate.evidenceFingerprint,
      operations,
      documentEffects: operations.map((operation) => ({
        path: operation.targetPath ?? '',
        beforeFingerprint: null,
        afterFingerprint: operation.expectedAfterFingerprint ?? null,
        restoreStrategy:
          operation.write?.mode === 'set'
            ? ('delete_run_created_document' as const)
            : ('restore_before_image' as const),
        rollbackArtifactEntryId: null,
      })),
      decisions,
      money,
      blockers: groupBlockers,
    });
  }

  return {
    schemaVersion: 1,
    auditPhase: sources.auditPhase,
    runId: sources.runId,
    sourceCommit: sources.sourceCommit,
    registryVersion: sources.registryVersion,
    target: sources.target,
    exportEvidence: sources.exportEvidence,
    rollbackArtifact: sources.rollbackArtifact,
    groups,
    money: {
      before: sumTotals(groups.map((group) => group.money.before)),
      expectedAfter: sumTotals(groups.map((group) => group.money.expectedAfter)),
    },
    blockers: planBlockers,
  };
}
