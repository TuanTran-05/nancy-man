import {
  assertArtifactContainsNoCredentialSecrets,
  fingerprintDocumentProjection,
  sha256,
} from './canonicalJson.js';
import {
  verifyManagedExportEvidence,
  type ManagedExportOperation,
} from './managedExportEvidence.js';
import type {
  StudentProfileMergePlan,
} from './reporter.js';
import { createStudentProfileMergePlanDigest } from './reporter.js';
import {
  encryptRollbackBeforeImages,
  type EncryptedRollbackArtifact,
  type RollbackBeforeImageEntry,
} from './rollbackArtifact.js';
import { deriveNormalizationOperationId } from './writer.js';
import { applyFieldPathPatch, readFieldPathValue } from './fieldPathPatch.js';
import type { StudentMergeDocumentEffect } from './types.js';

export { applyFieldPathPatch } from './fieldPathPatch.js';

/** One authoritative DocumentStore reading used to bind a final plan. */
export type FinalAuditDocument = {
  path: string;
  data: Record<string, unknown> | null;
  updateTime?: string | null;
};

type VirtualDocument = Record<string, unknown> | null;

function fingerprint(value: VirtualDocument): string | null {
  return value === null ? null : fingerprintDocumentProjection(value);
}

function entryId(operationId: string, path: string): string {
  return sha256(`${operationId}|${path}`).slice(0, 32);
}

function latestUpdateTime(documents: readonly FinalAuditDocument[]): string | undefined {
  const times = documents
    .map((document) => document.updateTime)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort();
  return times.at(-1);
}

function requireDocument(
  documents: Map<string, VirtualDocument>,
  path: string,
  role: 'source' | 'target'
): Record<string, unknown> {
  const value = documents.get(path) ?? null;
  if (value === null) {
    throw new Error(`STUDENT_PROFILE_FINAL_AUDIT_${role.toUpperCase()}_MISSING:${path}`);
  }
  return value;
}

/**
 * Turns a final-phase logical plan into the exact executable plan a reviewer
 * signs. Every source/target fingerprint and every rollback before-image is
 * derived from the same authoritative read; the executor therefore has no
 * value left to invent at apply time.
 */
export function finalizeStudentProfileNormalizationPlan(input: {
  plan: StudentProfileMergePlan;
  documents: readonly FinalAuditDocument[];
  exportOperation: ManagedExportOperation;
  expectedExportUri: string;
  now: Date;
  rollbackKeyBase64: string;
}): { plan: StudentProfileMergePlan; artifact: EncryptedRollbackArtifact } {
  if (input.plan.auditPhase !== 'final') {
    throw new Error('STUDENT_PROFILE_FINAL_AUDIT_PHASE_REQUIRED');
  }

  const exportEvidence = verifyManagedExportEvidence({
    operation: input.exportOperation,
    expected: {
      projectId: input.plan.target.projectId,
      databaseId: input.plan.target.databaseId,
      outputUriPrefix: input.expectedExportUri,
    },
    now: input.now,
    latestObservedSourceUpdateTime: latestUpdateTime(input.documents),
  });
  input.plan.exportEvidence = {
    operationName: exportEvidence.operationName,
    outputUriPrefix: exportEvidence.outputUriPrefix,
    snapshotTime: exportEvidence.snapshotTime,
    evidenceDigest: exportEvidence.evidenceDigest,
  };
  input.plan.rollbackArtifact = null;

  const virtual = new Map<string, VirtualDocument>(
    input.documents.map((document) => [document.path, document.data])
  );
  const beforeImages: RollbackBeforeImageEntry[] = [];

  for (const group of input.plan.groups) {
    let previousOperationId: string | null = null;
    const effects: StudentMergeDocumentEffect[] = [];

    for (const operation of group.operations) {
      if (!operation.write || !operation.registryEntryId || !operation.kind || !operation.targetPath) {
        throw new Error(`STUDENT_PROFILE_FINAL_AUDIT_OPERATION_INCOMPLETE:${operation.operationId}`);
      }

      const sourceBefore = operation.sourcePath
        ? requireDocument(virtual, operation.sourcePath, 'source')
        : null;
      const targetBefore = virtual.get(operation.targetPath) ?? null;
      let targetAfter: VirtualDocument;

      switch (operation.write.mode) {
        case 'copy_source':
          if (!operation.sourcePath || sourceBefore === null) {
            throw new Error(`STUDENT_PROFILE_FINAL_AUDIT_SOURCE_MISSING:${operation.sourcePath ?? ''}`);
          }
          if (operation.sourcePath === operation.targetPath) {
            throw new Error(`STUDENT_PROFILE_FINAL_AUDIT_COPY_SOURCE_EQUALS_TARGET:${operation.sourcePath}`);
          }
          targetAfter = sourceBefore;
          break;
        case 'set':
          targetAfter = operation.write.payload;
          break;
        case 'patch':
          targetAfter = applyFieldPathPatch(
            requireDocument(virtual, operation.targetPath, 'target'),
            operation.write.payload
          );
          break;
        case 'delete':
          targetAfter = null;
          break;
      }

      operation.sourceFingerprint = fingerprint(sourceBefore);
      operation.targetBeforeFingerprint = fingerprint(targetBefore);
      operation.expectedAfterFingerprint = fingerprint(targetAfter);
      operation.dependsOn = previousOperationId ? [previousOperationId] : [];
      operation.operationId = deriveNormalizationOperationId({
        groupId: group.groupId,
        stage: operation.stage,
        registryEntryId: operation.registryEntryId,
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
        expectedAfterFingerprint: operation.expectedAfterFingerprint,
        write: operation.write,
      });
      previousOperationId = operation.operationId;

      const addEffect = (
        path: string,
        before: VirtualDocument,
        after: VirtualDocument,
        patchPayload?: Record<string, unknown>
      ) => {
        const beforeFingerprint = fingerprint(before);
        const rollbackArtifactEntryId = before === null ? null : entryId(operation.operationId, path);
        if (before !== null) {
          const patchBefore: Record<string, unknown> = {};
          const absentFieldPaths: string[] = [];
          if (patchPayload) {
            for (const fieldPath of Object.keys(patchPayload).sort()) {
              const observed = readFieldPathValue(before, fieldPath);
              if (observed.exists) patchBefore[observed.restorePath] = observed.value;
              else absentFieldPaths.push(observed.restorePath);
            }
          }
          beforeImages.push({
            entryId: rollbackArtifactEntryId as string,
            path,
            restoreMode: patchPayload ? 'patch' : 'replace',
            before: patchPayload ? patchBefore : before,
            absentFieldPaths: patchPayload ? [...new Set(absentFieldPaths)].sort() : [],
          });
        }
        effects.push({
          operationId: operation.operationId,
          path,
          beforeFingerprint,
          afterFingerprint: fingerprint(after),
          restoreStrategy:
            before === null ? ('delete_run_created_document' as const) : ('restore_before_image' as const),
          rollbackArtifactEntryId,
        });
      };

      if (operation.write.mode === 'copy_source' && operation.sourcePath && sourceBefore !== null) {
        addEffect(operation.sourcePath, sourceBefore, null);
        virtual.set(operation.sourcePath, null);
      }
      addEffect(
        operation.targetPath,
        targetBefore,
        targetAfter,
        operation.write.mode === 'patch' ? operation.write.payload : undefined
      );
      virtual.set(operation.targetPath, targetAfter);
    }

    group.documentEffects = effects;
  }

  assertArtifactContainsNoCredentialSecrets(beforeImages);
  const planPreimageDigest = createPlanPreimageDigest(input.plan);
  const artifact = encryptRollbackBeforeImages({
    entries: beforeImages,
    aad: {
      projectId: input.plan.target.projectId,
      databaseId: input.plan.target.databaseId,
      runId: input.plan.runId,
      planPreimageDigest,
    },
    keyBase64: input.rollbackKeyBase64,
  });
  input.plan.rollbackArtifact = {
    fileName: artifact.fileName,
    digest: artifact.digest,
    entryCount: artifact.entryCount,
  };

  return { plan: input.plan, artifact };
}

/** Kept local to avoid a reporter → final-audit import cycle. */
function createPlanPreimageDigest(plan: StudentProfileMergePlan): string {
  const rollbackArtifact = plan.rollbackArtifact;
  plan.rollbackArtifact = null;
  try {
    return createStudentProfileMergePlanDigest(plan);
  } finally {
    plan.rollbackArtifact = rollbackArtifact;
  }
}
