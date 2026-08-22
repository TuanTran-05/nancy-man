import { canonicalJson, normalizeInstantForCanonicalJson, sha256 } from './canonicalJson.js';

/**
 * Verification of the managed DocumentStore export that a final audit binds to.
 *
 * The export is the rollback floor: if the run has to be undone by restore
 * rather than by reverse-patch, this snapshot is what production returns to.
 * So the checks here are about whether it is genuinely usable for that, not
 * whether an operator says it is.
 *
 * Two of them are easy to get wrong. First, the project and database are read
 * from the operation resource name rather than from the caller's flags — the
 * flags are the claim under test, so they cannot also be the evidence. Second,
 * a source document written after the snapshot time is not covered by the
 * export at all; restoring would silently discard that write, so a later
 * observed `updateTime` fails the audit rather than warning about it.
 */

/** A final audit must run against a snapshot no older than four hours. */
export const FINAL_AUDIT_EXPORT_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const OPERATION_NAME_PATTERN = /^projects\/([^/]+)\/databases\/([^/]+)\/operations\/([^/]+)$/;

export type ManagedExportOperation = {
  name: string;
  done?: boolean;
  error?: unknown;
  metadata?: {
    operationState?: string;
    outputUriPrefix?: string;
    startTime?: string;
    endTime?: string;
    snapshotTime?: string;
  };
};

export type ManagedExportEvidence = {
  operationName: string;
  operationId: string;
  projectId: string;
  databaseId: string;
  outputUriPrefix: string;
  startTime: string;
  endTime: string;
  snapshotTime: string;
  evidenceDigest: string;
};

export function verifyManagedExportEvidence(input: {
  operation: ManagedExportOperation;
  expected: { projectId: string; databaseId: string; outputUriPrefix: string };
  now: Date;
  /**
   * Newest `updateTime` observed across the documents this run touches. When
   * it postdates the snapshot, the export cannot restore the current state.
   */
  latestObservedSourceUpdateTime?: string;
  maxAgeMs?: number;
}): ManagedExportEvidence {
  const { operation, expected } = input;
  const metadata = operation.metadata ?? {};

  const parsed = OPERATION_NAME_PATTERN.exec(operation.name ?? '');
  if (!parsed) {
    throw new Error(`STUDENT_PROFILE_EXPORT_METADATA_INCOMPLETE: unparseable operation name`);
  }
  const [, projectId, databaseId, operationId] = parsed;

  if (projectId !== expected.projectId || databaseId !== expected.databaseId) {
    throw new Error(
      `STUDENT_PROFILE_EXPORT_TARGET_MISMATCH: operation targets ${projectId}/${databaseId}, ` +
        `expected ${expected.projectId}/${expected.databaseId}`
    );
  }

  if (operation.done !== true || operation.error || metadata.operationState !== 'SUCCESSFUL') {
    throw new Error(
      `STUDENT_PROFILE_EXPORT_NOT_SUCCESSFUL: done=${operation.done} state=${metadata.operationState}`
    );
  }

  const { outputUriPrefix, startTime, endTime, snapshotTime } = metadata;
  if (!outputUriPrefix || !startTime || !endTime || !snapshotTime) {
    // Never substituted with a nearby value. Inferring the snapshot time from
    // the start time would quietly widen the window the rollback floor covers.
    throw new Error(
      'STUDENT_PROFILE_EXPORT_METADATA_INCOMPLETE: ' +
        'outputUriPrefix, startTime, endTime, and snapshotTime are all required'
    );
  }

  if (outputUriPrefix !== expected.outputUriPrefix) {
    throw new Error(
      `STUDENT_PROFILE_EXPORT_URI_MISMATCH: operation wrote ${outputUriPrefix}`
    );
  }

  const normalizedSnapshot = normalizeInstantForCanonicalJson(snapshotTime);
  const snapshotMs = Date.parse(normalizedSnapshot);
  const maxAge = input.maxAgeMs ?? FINAL_AUDIT_EXPORT_MAX_AGE_MS;
  const ageMs = input.now.getTime() - snapshotMs;
  if (ageMs > maxAge) {
    throw new Error(
      `STUDENT_PROFILE_EXPORT_STALE: snapshot is ${Math.round(ageMs / 60000)} minutes old, ` +
        `limit ${Math.round(maxAge / 60000)}`
    );
  }

  if (input.latestObservedSourceUpdateTime) {
    const observedMs = Date.parse(
      normalizeInstantForCanonicalJson(input.latestObservedSourceUpdateTime)
    );
    if (observedMs > snapshotMs) {
      throw new Error(
        'STUDENT_PROFILE_EXPORT_PRECEDES_SOURCE_WRITE: ' +
          `a source document changed at ${input.latestObservedSourceUpdateTime}, ` +
          `after the snapshot at ${normalizedSnapshot}`
      );
    }
  }

  const evidence = {
    operationName: operation.name,
    operationId,
    projectId,
    databaseId,
    outputUriPrefix,
    startTime: normalizeInstantForCanonicalJson(startTime),
    endTime: normalizeInstantForCanonicalJson(endTime),
    snapshotTime: normalizedSnapshot,
  };

  return { ...evidence, evidenceDigest: sha256(canonicalJson(evidence)) };
}
