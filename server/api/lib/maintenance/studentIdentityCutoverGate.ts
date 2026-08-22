import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';
import {
  STUDENT_IDENTITY_MAINTENANCE_PATH,
  readStudentIdentityMaintenanceInTransaction,
  type StudentIdentityMaintenanceState,
} from './studentIdentityMaintenance.js';
import { STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH } from './studentIdentityMutationLease.js';
import { readCanonicalStudentReadControlInTransaction } from '../student/canonicalStudentReadControl.js';

/**
 * The only way maintenance changes mode.
 *
 * An operator cannot set a field and reopen writes. Every transition
 * revalidates its evidence *inside one transaction* and writes an immutable
 * release proof in the same commit, so there is no interval in which writes
 * are open while the rollback window is still notionally available. That
 * interval is the dangerous one: it is where a parent pays tuition into a
 * database somebody is about to roll back.
 *
 * Entering is the easy direction and still requires the reviewed artifacts to
 * be named, because "I ran it against the right plan" is a claim, and the gate
 * only accepts claims it can check.
 *
 * Leaving is the hard direction. Each reason demands different evidence and
 * none of them is "the operator says so":
 *
 * - `verified_cutover` — the migration finished, reads serve canonical, the
 *   projections were rebuilt, and smoke probes ran *after* both.
 * - `aborted_before_apply` — nothing was written, so nothing needs verifying;
 *   the check is that this is actually true.
 * - `verified_rollback` — the before-state was restored while maintenance was
 *   still held. After release this is forbidden outright, because the world
 *   has already seen the new data.
 * - `verified_retirement` — the legacy fields are gone and the center stayed
 *   healthy through the streak that allowed their removal.
 */

export const STUDENT_IDENTITY_RELEASE_PROOFS = 'student_identity_release_proofs';
export const STUDENT_IDENTITY_DRAIN_EVIDENCE = 'student_identity_drain_evidence';

export type StudentIdentityMaintenanceTransition =
  | {
      action: 'enter';
      runId: string;
      actorId: string;
      expectedMode: 'normal';
      expectedGeneration: number;
      planDigest: string;
      approvalDigest: string;
      sourceCommitSha: string;
      exportOperationId: string;
    }
  | {
      action: 'exit';
      runId: string;
      actorId: string;
      expectedGeneration: number;
      reason: 'verified_cutover';
      healthAuditId: string;
      healthDigest: string;
      smokeEvidenceId: string;
      projectionRebuildEvidenceId: string;
    }
  | {
      action: 'exit';
      runId: string;
      actorId: string;
      expectedGeneration: number;
      reason: 'verified_retirement';
      retirementVerificationId: string;
      healthAuditId: string;
      healthDigest: string;
      smokeEvidenceId: string;
    }
  | {
      action: 'exit';
      runId: string;
      actorId: string;
      expectedGeneration: number;
      reason: 'aborted_before_apply';
    }
  | {
      action: 'exit';
      runId: string;
      actorId: string;
      expectedGeneration: number;
      reason: 'verified_rollback';
      rollbackVerificationId: string;
    };

export type StudentIdentityCutoverExit = Extract<
  StudentIdentityMaintenanceTransition,
  { action: 'exit' }
>;

export class StudentIdentityCutoverGateError extends Error {
  readonly status = 409;
  readonly statusCode = 409;

  constructor(
    readonly code: string,
    detail: string
  ) {
    super(`${code}: ${detail}`);
    this.name = 'StudentIdentityCutoverGateError';
  }
}

function fail(code: string, detail: string): never {
  throw new StudentIdentityCutoverGateError(code, detail);
}

type Snapshot = { exists: boolean; data: () => Record<string, unknown> | undefined };

async function txGet(tx: Transaction, db: DocumentStore, path: string): Promise<Snapshot> {
  return (await tx.get(db.doc(path) as never)) as unknown as Snapshot;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Queue and lease state, recorded once and re-read rather than re-measured.
 *
 * Apply preflight and exit both require this to be zero. Recording it as an
 * immutable document rather than checking live is deliberate: the two checks
 * happen minutes apart, and a number that was true at one of them and not the
 * other is exactly the drift the window exists to prevent.
 */
export type StudentIdentityDrainEvidence = {
  runId: string;
  observedAt: string;
  recordedBy: string;
  queueCounts: Record<string, number>;
  activeLeases: number;
  staleLeases: number;
  planDigest: string;
  approvalDigest: string;
};

export async function recordStudentIdentityDrainEvidence(
  db: DocumentStore,
  evidence: StudentIdentityDrainEvidence
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const existing = await txGet(tx, db, `${STUDENT_IDENTITY_DRAIN_EVIDENCE}/${evidence.runId}`);
    if (existing.exists) {
      fail('STUDENT_IDENTITY_HEALTH_EVIDENCE_IMMUTABLE', `drain evidence already exists for ${evidence.runId}`);
    }
    tx.set(
      db.collection(STUDENT_IDENTITY_DRAIN_EVIDENCE).doc(evidence.runId) as never,
      evidence as never
    );
  });
}

/**
 * Every queue that has to be empty before the window may lift.
 *
 * The list lives here rather than being inferred from whatever the evidence
 * happens to mention: an empty map trivially satisfies "all named queues are
 * zero", and evidence that measured nothing must not read as evidence that
 * everything was zero.
 */
const REQUIRED_DRAIN_QUEUES = [
  'outboxJobs',
  'accountingFinanceOutbox',
  'receiptNotificationOutbox',
  'zaloBulkJobs',
  'payosProcessors',
  'passwordResetWork',
] as const;

export function assertStudentIdentityDrainEvidence(
  evidence: StudentIdentityDrainEvidence | null,
  runId: string,
  binding: { planDigest: string; approvalDigest: string }
): void {
  if (!evidence) {
    fail('STUDENT_IDENTITY_DRAIN_EVIDENCE_MISSING', `no drain evidence recorded for ${runId}`);
  }
  if (evidence.runId !== runId) {
    fail(
      'STUDENT_IDENTITY_DRAIN_EVIDENCE_RUN_MISMATCH',
      `evidence names ${evidence.runId}, not ${runId}`
    );
  }
  const missing = REQUIRED_DRAIN_QUEUES.filter(
    (queue) => typeof evidence.queueCounts[queue] !== 'number'
  );
  if (missing.length > 0) {
    fail(
      'STUDENT_IDENTITY_DRAIN_EVIDENCE_INCOMPLETE',
      `no measurement recorded for ${missing.join(', ')}`
    );
  }
  if (
    evidence.planDigest !== binding.planDigest ||
    evidence.approvalDigest !== binding.approvalDigest
  ) {
    fail(
      'STUDENT_IDENTITY_DRAIN_EVIDENCE_BINDING_MISMATCH',
      `evidence is bound to a different reviewed plan or approval than run ${runId}`
    );
  }
  for (const [queue, count] of Object.entries(evidence.queueCounts)) {
    if (count !== 0) {
      fail('STUDENT_IDENTITY_QUEUE_NOT_DRAINED', `${queue} still has ${count} pending item(s)`);
    }
  }
  if (evidence.activeLeases !== 0 || evidence.staleLeases !== 0) {
    fail(
      'STUDENT_IDENTITY_LEASE_OUTSTANDING',
      `${evidence.activeLeases} active and ${evidence.staleLeases} stale lease(s)`
    );
  }
}

function parseDrainEvidence(raw: unknown): StudentIdentityDrainEvidence | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!text(value.runId)) return null;
  return {
    runId: text(value.runId),
    observedAt: text(value.observedAt),
    recordedBy: text(value.recordedBy),
    queueCounts: (value.queueCounts as Record<string, number>) ?? {},
    activeLeases: Number(value.activeLeases ?? 0),
    staleLeases: Number(value.staleLeases ?? 0),
    planDigest: text(value.planDigest),
    approvalDigest: text(value.approvalDigest),
  };
}

async function readRun(tx: Transaction, db: DocumentStore, runId: string) {
  const snapshot = await txGet(tx, db, `student_profile_merge_runs/${runId}`);
  if (!snapshot.exists) {
    fail('STUDENT_IDENTITY_RUN_NOT_FOUND', runId);
  }
  return snapshot.data() || {};
}

async function readHealth(tx: Transaction, db: DocumentStore, auditId: string) {
  const snapshot = await txGet(tx, db, `student_identity_health_runs/${auditId}`);
  if (!snapshot.exists) {
    fail('STUDENT_IDENTITY_HEALTH_AUDIT_NOT_FOUND', auditId);
  }
  return snapshot.data() || {};
}

/**
 * Validates an exit without performing it.
 *
 * Exported so the CLI can tell an operator *why* the window will not lift
 * before they attempt it, and so the transition itself can call exactly the
 * same policy rather than a second copy that drifts.
 */
export async function assertStudentIdentityCutoverCanExit(
  db: DocumentStore,
  input: StudentIdentityCutoverExit,
  now: Date = new Date()
): Promise<void> {
  await db.runTransaction(async (tx) => {
    await validateExitInTransaction(tx, db, input, now);
  });
}

async function validateExitInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: StudentIdentityCutoverExit,
  now: Date
): Promise<void> {
  const state = await readStudentIdentityMaintenanceInTransaction(tx, db);
  if (state.generation !== input.expectedGeneration) {
    fail('STUDENT_IDENTITY_GENERATION_MISMATCH', `at ${state.generation}, expected ${input.expectedGeneration}`);
  }
  if (state.mode !== 'read_only') {
    fail('STUDENT_IDENTITY_NOT_IN_MAINTENANCE', `mode is ${state.mode}`);
  }
  if (state.activeRunId !== input.runId) {
    fail(
      'STUDENT_IDENTITY_RUN_MISMATCH',
      `window holds ${state.activeRunId ?? 'no run'}, not ${input.runId}`
    );
  }
  if (state.migrationActorId !== input.actorId) {
    fail('STUDENT_IDENTITY_ACTOR_MISMATCH', 'the exiting actor did not enter this window');
  }

  const run = await readRun(tx, db, input.runId);
  const appliedCount = Number(run.appliedOperationCount ?? 0);

  if (input.reason === 'aborted_before_apply') {
    // Nothing was written, so nothing needs verifying — but that has to be
    // true rather than assumed. An abort that quietly lifts the window over
    // half-applied work is worse than no abort path at all.
    if (text(run.status) !== 'aborted') {
      fail('STUDENT_IDENTITY_RUN_NOT_ABORTED', `run status is ${text(run.status) || 'unset'}`);
    }
    if (appliedCount !== 0) {
      fail('STUDENT_IDENTITY_ABORT_AFTER_APPLY', `${appliedCount} operation(s) already applied`);
    }
    return;
  }

  if (input.reason === 'verified_rollback') {
    if (text(run.maintenanceLiftedAt)) {
      // The world has already seen the new data: receipts printed, messages
      // sent, parents told a balance. Recovery from here is forward repair
      // under a new reviewed run, not a restore.
      fail(
        'STUDENT_IDENTITY_ROLLBACK_AFTER_RELEASE_FORBIDDEN',
        'maintenance was already lifted for this run'
      );
    }
    const verification = await txGet(
      tx,
      db,
      `student_profile_rollback_verifications/${input.rollbackVerificationId}`
    );
    if (!verification.exists) {
      fail('STUDENT_IDENTITY_ROLLBACK_VERIFICATION_NOT_FOUND', input.rollbackVerificationId);
    }
    const data = verification.data() || {};
    if (text(data.runId) !== input.runId) {
      fail('STUDENT_IDENTITY_ROLLBACK_VERIFICATION_RUN_MISMATCH', input.rollbackVerificationId);
    }
    if (Number(data.restoredOperationCount ?? -1) !== appliedCount) {
      fail(
        'STUDENT_IDENTITY_ROLLBACK_INCOMPLETE',
        `restored ${Number(data.restoredOperationCount ?? -1)} of ${appliedCount} applied operation(s)`
      );
    }
    if (data.beforeStateMatches !== true || data.monetaryTotalsMatch !== true) {
      fail('STUDENT_IDENTITY_ROLLBACK_STATE_MISMATCH', 'before-state or money did not match');
    }
    return;
  }

  // --- verified_cutover and verified_retirement share the health evidence ---
  const drain = parseDrainEvidence(
    (await txGet(tx, db, `${STUDENT_IDENTITY_DRAIN_EVIDENCE}/${input.runId}`)).data()
  );
  assertStudentIdentityDrainEvidence(drain, input.runId, {
    planDigest: text(run.planDigest),
    approvalDigest: text(run.approvalDigest),
  });

  if (Number(run.pendingOperationCount ?? 0) !== 0) {
    fail('STUDENT_IDENTITY_OPERATIONS_PENDING', `${run.pendingOperationCount} pending`);
  }
  if (Number(run.failedOperationCount ?? 0) !== 0) {
    fail('STUDENT_IDENTITY_OPERATIONS_FAILED', `${run.failedOperationCount} failed`);
  }
  if (Number(run.plannedOperationCount) !== appliedCount || appliedCount !== Number(run.verifiedOperationCount)) {
    fail('STUDENT_IDENTITY_OPERATIONS_MISMATCH', `planned, applied, or verified counts do not match`);
  }

  const health = await readHealth(tx, db, input.healthAuditId);
  if (text(health.digest) !== input.healthDigest) {
    fail('STUDENT_IDENTITY_HEALTH_DIGEST_MISMATCH', input.healthAuditId);
  }
  if (text(health.runId) !== input.runId) {
    fail('STUDENT_IDENTITY_HEALTH_RUN_MISMATCH', input.healthAuditId);
  }
  if (text(health.status) !== 'green') {
    fail('STUDENT_IDENTITY_HEALTH_NOT_GREEN', input.healthAuditId);
  }
  // `green` is a verdict some earlier process wrote. The gate re-derives the
  // parts it depends on from the same document, so a stored verdict cannot
  // outvote the evidence stored beside it.
  const invariants = (health.invariants as Record<string, unknown>) || {};
  const unmet = [
    invariants.monetaryTotalsMatchReviewedPlan !== true ? 'monetaryTotalsMatchReviewedPlan' : '',
    invariants.projectionRebuildComplete !== true ? 'projectionRebuildComplete' : '',
    invariants.aliasesOneHopAndAcyclic !== true ? 'aliasesOneHopAndAcyclic' : '',
    invariants.authenticationPathsCanonical !== true ? 'authenticationPathsCanonical' : '',
  ].filter(Boolean);
  if (unmet.length > 0) {
    fail('STUDENT_IDENTITY_HEALTH_INVARIANTS_NOT_MET', `${input.healthAuditId}: ${unmet.join(', ')}`);
  }
  if (Array.isArray(health.blockers) && health.blockers.length > 0) {
    fail(
      'STUDENT_IDENTITY_HEALTH_INVARIANTS_NOT_MET',
      `${input.healthAuditId} carries ${health.blockers.length} blocker(s) under a green verdict`
    );
  }


  const canonicalControl = await readCanonicalStudentReadControlInTransaction(tx, db);
  if (canonicalControl.mode !== 'canonical_required') {
    fail('STUDENT_IDENTITY_READ_MODE_NOT_REQUIRED', `read mode is ${canonicalControl.mode}`);
  }

  const smoke = await txGet(tx, db, `student_identity_smoke_runs/${input.smokeEvidenceId}`);
  if (!smoke.exists) {
    fail('STUDENT_IDENTITY_SMOKE_EVIDENCE_NOT_FOUND', input.smokeEvidenceId);
  }
  const smokeData = smoke.data() || {};
  if (text(smokeData.runId) !== input.runId || text(smokeData.status) !== 'green') {
    fail('STUDENT_IDENTITY_SMOKE_NOT_GREEN', input.smokeEvidenceId);
  }
  // Ordering matters as much as the result: probes that ran before the read
  // switch and the projection rebuild tested the old system.
  if (Date.parse(text(smokeData.startedAt)) < Date.parse(text(health.startedAt))) {
    fail(
      'STUDENT_IDENTITY_SMOKE_BEFORE_HEALTH',
      'smoke probes ran before the health audit they are meant to confirm'
    );
  }

  if (input.reason === 'verified_cutover') {
    if (now.getTime() - Date.parse(text(smokeData.startedAt)) > 60 * 60 * 1000) {
      fail('STUDENT_IDENTITY_SMOKE_TOO_OLD', input.smokeEvidenceId);
    }
    if (Number(smokeData.passedSurfacesCount) !== 10) {
      fail('STUDENT_IDENTITY_SMOKE_SURFACES_INCOMPLETE', input.smokeEvidenceId);
    }
    if (smokeData.mutationProbesBlocked !== true) {
      fail('STUDENT_IDENTITY_SMOKE_MUTATIONS_NOT_BLOCKED', input.smokeEvidenceId);
    }
    const bindings = smokeData.bindings as any || {};
    if (
      bindings.runId !== input.runId ||
      bindings.planDigest !== text(run.planDigest) ||
      bindings.approvalDigest !== text(run.approvalDigest) ||
      bindings.sourceCommitSha !== text(run.sourceCommitSha) ||
      bindings.exportOperationId !== text(run.exportOperationId) ||
      bindings.projectionRebuildEvidenceId !== input.projectionRebuildEvidenceId
    ) {
      fail('STUDENT_IDENTITY_SMOKE_BINDINGS_MISMATCH', input.smokeEvidenceId);
    }

    const rebuild = await txGet(tx, db, `student_identity_projection_rebuilds/${input.projectionRebuildEvidenceId}`);
    if (!rebuild.exists) {
       fail('STUDENT_IDENTITY_REBUILD_NOT_FOUND', input.projectionRebuildEvidenceId);
    }
    const rebuildData = rebuild.data() || {};
    if (text(rebuildData.status) !== 'valid' || Number(rebuildData.missingCount ?? -1) !== 0 || Number(rebuildData.staleCount ?? -1) !== 0) {
       fail('STUDENT_IDENTITY_REBUILD_INVALID', input.projectionRebuildEvidenceId);
    }
  }

  if (input.reason === 'verified_retirement') {
    const retirement = await txGet(
      tx,
      db,
      `student_profile_retirement_verifications/${input.retirementVerificationId}`
    );
    if (!retirement.exists) {
      fail('STUDENT_IDENTITY_RETIREMENT_VERIFICATION_NOT_FOUND', input.retirementVerificationId);
    }
    const data = retirement.data() || {};
    if (text(data.runId) !== input.runId || text(data.status) !== 'verified') {
      fail('STUDENT_IDENTITY_RETIREMENT_NOT_VERIFIED', input.retirementVerificationId);
    }
    const counts = (health.counts as Record<string, unknown>) || {};
    if (Number(counts.legacyProjectionFieldsRemaining ?? -1) !== 0) {
      fail(
        'STUDENT_IDENTITY_LEGACY_PROJECTION_FIELDS_REMAIN',
        `${counts.legacyProjectionFieldsRemaining} field(s) still written`
      );
    }
  }
}

export async function transitionStudentIdentityMaintenance(
  db: DocumentStore,
  input: StudentIdentityMaintenanceTransition,
  now: Date = new Date()
): Promise<StudentIdentityMaintenanceState> {
  return db.runTransaction(async (tx: Transaction) => {
    const state = await readStudentIdentityMaintenanceInTransaction(tx, db);

    if (state.generation !== input.expectedGeneration) {
      fail('STUDENT_IDENTITY_GENERATION_MISMATCH', `at ${state.generation}, expected ${input.expectedGeneration}`);
    }

    if (input.action === 'enter') {
      if (state.mode !== input.expectedMode) {
        // Compare-and-set. Two operators entering at once must not both
        // believe they own the window.
        fail('STUDENT_IDENTITY_UNEXPECTED_MODE', `mode is ${state.mode}, expected ${input.expectedMode}`);
      }
      const run = await readRun(tx, db, input.runId);
      if (text(run.planDigest) !== input.planDigest) {
        fail('STUDENT_IDENTITY_PLAN_DIGEST_MISMATCH', input.runId);
      }
      if (text(run.approvalDigest) !== input.approvalDigest) {
        fail('STUDENT_IDENTITY_APPROVAL_DIGEST_MISMATCH', input.runId);
      }
      if (text(run.sourceCommitSha) !== input.sourceCommitSha) {
        fail('STUDENT_IDENTITY_SOURCE_COMMIT_MISMATCH', input.runId);
      }
      if (text(run.exportOperationId) !== input.exportOperationId) {
        // Without an export completed immediately before, rollback has nothing
        // to restore from.
        fail('STUDENT_IDENTITY_EXPORT_MISMATCH', input.runId);
      }

      // Read through the transaction, so a lease created concurrently either
      // loses to this write or forces a retry. Checking outside would leave a
      // gap in which one more long-running writer slips into the window.
      const leases = await tx.get(db.collection(STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH) as never);
      const held = ((leases as unknown as { docs?: Array<{ data: () => Record<string, unknown> }> })
        .docs ?? []
      ).filter((doc) => text(doc.data().state) === 'active');
      if (held.length > 0) {
        fail('STUDENT_IDENTITY_LEASE_ACTIVE', `${held.length} lease(s) still held`);
      }

      const next: StudentIdentityMaintenanceState = {
        mode: 'read_only',
        activeRunId: input.runId,
        migrationActorId: input.actorId,
        updatedAt: now.toISOString(),
        updatedBy: input.actorId,
        generation: state.generation + 1,
      };
      tx.set(db.doc(STUDENT_IDENTITY_MAINTENANCE_PATH) as never, next);
      return next;
    }

    await validateExitInTransaction(tx, db, input, now);

    // The release proof and the mode change land in one commit. Splitting them
    // would leave an interval in which writes are open while the rollback
    // window is still notionally available — the interval in which a parent
    // pays into a database somebody is about to roll back.
    const existingRelease = await txGet(tx, db, `${STUDENT_IDENTITY_RELEASE_PROOFS}/${input.runId}`);
    if (existingRelease.exists) {
      fail('STUDENT_IDENTITY_HEALTH_EVIDENCE_IMMUTABLE', `release proof already exists for ${input.runId}`);
    }

    tx.create(db.doc(`${STUDENT_IDENTITY_RELEASE_PROOFS}/${input.runId}`) as never, {
      runId: input.runId,
      reason: input.reason,
      actorId: input.actorId,
      releasedAt: now.toISOString(),
      ...(input.reason === 'verified_cutover' || input.reason === 'verified_retirement'
        ? { healthAuditId: input.healthAuditId, smokeEvidenceId: input.smokeEvidenceId }
        : {}),
      ...(input.reason === 'verified_cutover'
        ? { projectionRebuildEvidenceId: input.projectionRebuildEvidenceId }
        : {}),
      ...(input.reason === 'verified_rollback'
        ? { rollbackVerificationId: input.rollbackVerificationId }
        : {}),
      ...(input.reason === 'verified_retirement'
        ? { retirementVerificationId: input.retirementVerificationId }
        : {}),
    });
    tx.set(
      db.doc(`student_profile_merge_runs/${input.runId}`) as never,
      { maintenanceLiftedAt: now.toISOString(), maintenanceLiftedReason: input.reason },
      { merge: true } as never
    );

    const next: StudentIdentityMaintenanceState = {
      mode: 'normal',
      activeRunId: null,
      migrationActorId: null,
      updatedAt: now.toISOString(),
      updatedBy: input.actorId,
      generation: state.generation + 1,
    };
    tx.set(db.doc(STUDENT_IDENTITY_MAINTENANCE_PATH) as never, next);
    return next;
  });
}
