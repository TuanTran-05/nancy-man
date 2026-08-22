import { createHash } from 'node:crypto';
import { FieldValue, type DocumentStore, type Transaction } from '@/server/db/documentStore.js';
import { readStudentIdentityMaintenanceInTransaction } from '../../server/api/lib/maintenance/studentIdentityMaintenance.js';
import { LEGACY_PROJECTION_FIELDS, type LegacyStudentRetirementOperation, type LegacyStudentRetirementReviewedFile } from './types.js';

/**
 * Applies one reviewed operation, or refuses and leaves everything alone.
 *
 *
 * - **Each operation is one transaction.** Nothing is half-deleted.
 * - **The maintenance window is re-read inside that transaction.** A window
 *   that closed mid-run stops the next operation rather than the next run.
 * - **The before-fingerprint is compared before writing.** A document that
 *   changed since the plan was reviewed is not the document that was
 *   approved, and deleting it would be deleting something nobody looked at.
 *
 * Resuming is therefore ordinary: re-running the same plan skips what is
 * already gone and re-checks what is not. There is no separate resume path to
 * get wrong.
 */

export const STUDENT_RETIREMENT_JOURNAL = 'student_profile_merge_journal';

export type RetirementApplyOutcome =
  | { status: 'applied'; operationId: string }
  | { status: 'already_applied'; operationId: string }
  | { status: 'refused'; operationId: string; code: string; detail: string };

export class StudentRetirementWriteError extends Error {
  constructor(
    readonly code: string,
    detail: string
  ) {
    super(`${code}: ${detail}`);
    this.name = 'StudentRetirementWriteError';
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function operationId(operation: LegacyStudentRetirementOperation): string {
  if (operation.kind === 'delete_profile_tombstone') {
    return `delete_profile_tombstone:${operation.documentId}`;
  }
  if (operation.kind === 'delete_credential_tombstone') {
    return `delete_credential_tombstone:${operation.documentId}`;
  }
  if (operation.kind === 'remove_legacy_profile_projection_fields') {
    return `remove_profile_fields:${operation.canonicalProfileId}`;
  }
  return `remove_user_fields:${operation.userDocumentId}`;
}

function documentPath(operation: LegacyStudentRetirementOperation): string {
  if (operation.kind === 'delete_profile_tombstone') return `students/${operation.documentId}`;
  if (operation.kind === 'delete_credential_tombstone') {
    return `student_auth_credentials/${operation.documentId}`;
  }
  if (operation.kind === 'remove_legacy_profile_projection_fields') {
    return `students/${operation.canonicalProfileId}`;
  }
  return `users/${operation.userDocumentId}`;
}

export async function applyLegacyStudentRetirementOperation(
  db: DocumentStore,
  input: {
    operation: LegacyStudentRetirementOperation;
    runId: string;
    actorId: string;
    reviewedPlan: LegacyStudentRetirementReviewedFile;
    now?: Date;
  }
): Promise<RetirementApplyOutcome> {
  const now = input.now ?? new Date();
  const id = operationId(input.operation);
  const path = documentPath(input.operation);

  // Membership first, before any read of the target. Authority to delete
  // comes from the reviewed manifest; a plan that names no operations
  // authorises none.
  const reviewedIds = input.reviewedPlan.operationIds ?? [];
  if (!reviewedIds.includes(id)) {
    throw new StudentRetirementWriteError(
      'STUDENT_RETIREMENT_OPERATION_NOT_REVIEWED',
      `${id} is not named by plan ${input.reviewedPlan.planDigest}`
    );
  }

  return db.runTransaction(async (tx: Transaction) => {
    // A window that closed mid-run stops the next operation rather than the
    // next run, which is what makes an interrupt survivable.
    const maintenance = await readStudentIdentityMaintenanceInTransaction(tx, db);
    if (maintenance.mode !== 'read_only') {
      throw new StudentRetirementWriteError(
        'STUDENT_RETIREMENT_MAINTENANCE_NOT_HELD',
        `maintenance is ${maintenance.mode}`
      );
    }
    if (maintenance.activeRunId !== input.runId || maintenance.migrationActorId !== input.actorId) {
      throw new StudentRetirementWriteError(
        'STUDENT_RETIREMENT_RUN_OR_ACTOR_MISMATCH',
        `window holds ${maintenance.activeRunId ?? 'no run'}`
      );
    }

    const journalRef = db.doc(`${STUDENT_RETIREMENT_JOURNAL}/${input.runId}__${id}`);
    const journal = (await tx.get(journalRef as never)) as unknown as {
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    };
    if (journal.exists) {
      // Re-running the same plan is the resume path. There is no separate one
      // to get wrong — but "same plan" has to be checked, or a journal left
      // by an earlier, different review makes this operation look done.
      const recorded = journal.data() ?? {};
      if (
        recorded.planDigest !== input.reviewedPlan.planDigest ||
        recorded.approvalDigest !== input.reviewedPlan.approvalDigest
      ) {
        throw new StudentRetirementWriteError(
          'STUDENT_RETIREMENT_JOURNAL_PLAN_MISMATCH',
          `${id} was journalled under a different reviewed plan`
        );
      }
      return { status: 'already_applied' as const, operationId: id };
    }

    const ref = db.doc(path);
    const snapshot = (await tx.get(ref as never)) as unknown as {
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    };

    if (!snapshot.exists) {
      // Already gone: record it so a later pass does not re-check, but do not
      // pretend a deletion happened.
      tx.set(journalRef as never, {
        runId: input.runId,
        operationId: id,
        status: 'already_absent',
        appliedAt: now.toISOString(),
        actorId: input.actorId,
        planDigest: input.reviewedPlan.planDigest,
        approvalDigest: input.reviewedPlan.approvalDigest,
      });
      return { status: 'already_applied' as const, operationId: id };
    }

    const before = snapshot.data() || {};
    if (input.operation.kind !== 'delete_credential_tombstone') {
      const expected = (input.operation as { beforeFingerprint: string }).beforeFingerprint;
      if (fingerprint(before) !== expected) {
        // Changed since the plan was reviewed, so it is not the document that
        // was approved.
        return {
          status: 'refused' as const,
          operationId: id,
          code: 'STUDENT_RETIREMENT_SOURCE_DRIFT',
          detail: `${path} changed after the plan was reviewed`,
        };
      }
    } else if (
      fingerprint(Object.keys(before).sort()) !== input.operation.nonSecretFingerprint
    ) {
      // Field names only — the plan never carried the values, so drift is
      // detected without a secret ever leaving the database.
      return {
        status: 'refused' as const,
        operationId: id,
        code: 'STUDENT_RETIREMENT_SOURCE_DRIFT',
        detail: `${path} changed after the plan was reviewed`,
      };
    }

    if (
      input.operation.kind === 'delete_profile_tombstone' ||
      input.operation.kind === 'delete_credential_tombstone'
    ) {
      if (input.operation.kind === 'delete_credential_tombstone') {
        const boundaryRef = db.doc(`student_profile_retirement_irreversible_boundaries/${input.runId}`);
        const boundarySnapshot = (await tx.get(boundaryRef as never)) as unknown as { exists: boolean };
        if (!boundarySnapshot.exists) {
          tx.set(boundaryRef as never, {
            runId: input.runId,
            writtenAt: now.toISOString(),
            actorId: input.actorId
          });
        }
      }
      tx.delete(ref as never);
    } else {
      const removal: Record<string, unknown> = {};
      for (const field of LEGACY_PROJECTION_FIELDS) removal[field] = FieldValue.delete();
      tx.update(ref as never, removal);
    }

    tx.set(journalRef as never, {
      runId: input.runId,
      operationId: id,
      kind: input.operation.kind,
      documentPath: path,
      status: 'applied',
      appliedAt: now.toISOString(),
      actorId: input.actorId,
      planDigest: input.reviewedPlan.planDigest,
      approvalDigest: input.reviewedPlan.approvalDigest,
    });

    return { status: 'applied' as const, operationId: id };
  });
}
