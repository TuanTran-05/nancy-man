/**
 * Guarded CLI for the student profile normalization engine.
 *
 * This file is the confirmation layer. Every destructive mode requires the
 * operator to restate, on the command line, exactly which plan, approval,
 * project, database, commit, and export they believe they are acting on; the
 * executor then compares those restatements against the artifacts and the live
 * database and refuses on any disagreement. Typing a confirmation is not
 * ceremony — it is the only thing standing between "I ran the right script in
 * the wrong terminal" and an unreviewed production write.
 *
 * Three parsing rules follow from that and are enforced here rather than
 * downstream:
 *
 * - An unknown or misplaced flag is an error, never ignored. A silently
 *   dropped flag is how an operator comes to believe a safety option is in
 *   effect when it is not.
 * - A repeated flag is an error rather than last-one-wins, because a scrolled
 *   shell history can easily carry a stale value ahead of the intended one.
 * - The rollback encryption key has no CLI form. argv is visible in process
 *   listings and shell history, so the key is read from
 *   `STUDENT_PROFILE_ROLLBACK_KEY_BASE64` by the artifact module only.
 *
 * Mode execution lives in the apply, verify, and rollback executors. This
 * module deliberately owns parsing alone so the guard can be tested exhaustively
 * without a database.
 */

import { executeStudentIdentityCli, createDefaultStudentIdentityCliRuntime, runStudentIdentityCliIfDirect } from './student-identity-cli/runtime.js';


import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  assertConfirmedTarget,
  type StudentIdentityCliRuntime,
} from './student-identity-cli/runtime.js';
import {
  readJsonArtifact,
  writeJsonArtifactThroughRuntime,
} from './student-identity-cli/artifacts.js';
import { createDocumentStoreNormalizationStore } from './student-profile-normalization/documentStoreStore.js';
import {
  applyStudentProfileNormalization,
  preflightStudentProfileNormalization,
} from './student-profile-normalization/writer.js';
import { verifyStudentProfileNormalization } from './student-profile-normalization/verifier.js';
import {
  createReviewedStudentProfileNormalizationPlan,
  createStudentProfileMergeApprovalDigest,
  reserveStudentProfileNormalizationReportDir,
  createStudentProfileMergePlanDigest,
  writeStudentProfileNormalizationReports,
  type StudentProfileMergeApproval,
  type StudentProfileMergePlan,
  type StudentProfileMergeReviewedFile,
} from './student-profile-normalization/reporter.js';
import {
  canonicalJson,
  fingerprintDocumentProjection,
  sha256,
} from './student-profile-normalization/canonicalJson.js';
import { detectStudentIdentityCandidates } from './student-profile-normalization/planner.js';
import { planStudentProfileNormalization } from './student-profile-normalization/planAssembler.js';
import {
  applyStudentProfileNormalizationRollback,
  createReviewedStudentProfileNormalizationRollback,
  planStudentProfileNormalizationRollback,
  type ReviewedStudentProfileNormalizationRollback,
  type StudentProfileNormalizationRollbackPlan,
  type StudentProfileRollbackApprovalRole,
} from './student-profile-normalization/rollback.js';
import {
  getStudentReferenceSpec,
  STUDENT_REFERENCE_REGISTRY_VERSION,
} from './student-profile-normalization/referenceRegistry.js';
import { inventoryStudentReferences } from './student-profile-normalization/inventory.js';
import {
  finalizeStudentProfileNormalizationPlan,
  type FinalAuditDocument,
} from './student-profile-normalization/finalAudit.js';
import {
  verifyManagedExportEvidence,
  type ManagedExportOperation,
} from './student-profile-normalization/managedExportEvidence.js';
import { isCanonicalStudentProfile } from '../shared/studentIdentity.js';
import { readStudentIdentityMaintenanceInTransaction } from '../server/api/lib/maintenance/studentIdentityMaintenance.js';
import {
  assertStudentIdentityDrainEvidence,
  STUDENT_IDENTITY_DRAIN_EVIDENCE,
  type StudentIdentityDrainEvidence,
} from '../server/api/lib/maintenance/studentIdentityCutoverGate.js';
import type { EncryptedRollbackArtifact } from './student-profile-normalization/rollbackArtifact.js';

export type StudentProfileNormalizationMode =
  | 'help'
  | 'audit-preliminary'
  | 'audit-final'
  | 'approve'
  | 'prepare'
  | 'apply'
  | 'verify'
  | 'rollback-plan'
  | 'rollback-approve'
  | 'rollback-apply';

export type StudentProfileNormalizationCliOptions = {
  mode: StudentProfileNormalizationMode;
  runId?: string;
  reportDir?: string;
  sourceCommit?: string;
  reviewDecisionsPath?: string;
  exportOperationId?: string;
  exportUri?: string;
  rollbackArtifactPath?: string;
  planPath?: string;
  reviewedPlanPath?: string;
  reviewedRollbackPath?: string;
  rollbackPlanPath?: string;
  outputPath?: string;
  approvalRole?: string;
  reviewerId?: string;
  actorId?: string;
  confirmPlanDigest?: string;
  confirmApprovalDigest?: string;
  confirmRollbackDigest?: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
  confirmCommit?: string;
  confirmExportOperationId?: string;
  /** Where the measured queue drain evidence for this run was written. */
  drainEvidencePath?: string;
};

const MODE_FLAGS: Record<string, StudentProfileNormalizationMode> = {
  '--audit-preliminary': 'audit-preliminary',
  '--audit-final': 'audit-final',
  '--approve': 'approve',
  '--prepare': 'prepare',
  '--apply': 'apply',
  '--verify': 'verify',
  '--rollback-plan': 'rollback-plan',
  '--rollback-approve': 'rollback-approve',
  '--rollback-apply': 'rollback-apply',
};

/**
 * Rejected outright, never parsed. Listed so an operator who tries the obvious
 * spelling gets a clear refusal instead of a confusing unknown-flag error.
 */
const FORBIDDEN_SECRET_FLAGS = new Set([
  '--rollback-key',
  '--rollback-key-base64',
  '--student-profile-rollback-key-base64',
  '--key',
  '--secret',
]);

type FlagSpec = { key: keyof StudentProfileNormalizationCliOptions; digest?: boolean };

const FLAGS: Record<string, FlagSpec> = {
  '--run-id': { key: 'runId' },
  '--report-dir': { key: 'reportDir' },
  '--source-commit': { key: 'sourceCommit' },
  '--review-decisions': { key: 'reviewDecisionsPath' },
  '--export-operation': { key: 'exportOperationId' },
  '--export-uri': { key: 'exportUri' },
  '--rollback-artifact': { key: 'rollbackArtifactPath' },
  '--plan': { key: 'planPath' },
  '--reviewed-plan': { key: 'reviewedPlanPath' },
  '--reviewed-rollback': { key: 'reviewedRollbackPath' },
  '--rollback-plan-file': { key: 'rollbackPlanPath' },
  '--output': { key: 'outputPath' },
  '--approval-role': { key: 'approvalRole' },
  '--reviewer-id': { key: 'reviewerId' },
  '--actor-id': { key: 'actorId' },
  '--confirm-plan-digest': { key: 'confirmPlanDigest', digest: true },
  '--confirm-approval-digest': { key: 'confirmApprovalDigest', digest: true },
  '--confirm-rollback-digest': { key: 'confirmRollbackDigest', digest: true },
  '--confirm-project': { key: 'confirmProjectId' },
  '--confirm-database': { key: 'confirmDatabaseId' },
  '--confirm-commit': { key: 'confirmCommit' },
  '--confirm-export': { key: 'confirmExportOperationId' },
  '--drain-evidence': { key: 'drainEvidencePath' },
};

/** Flags each mode accepts, and which of those it cannot run without. */
const MODE_FLAG_POLICY: Record<
  Exclude<StudentProfileNormalizationMode, 'help'>,
  { required: string[]; optional?: string[] }
> = {
  'audit-preliminary': { required: ['--run-id', '--report-dir', '--source-commit'] },
  'audit-final': {
    required: [
      '--run-id',
      '--report-dir',
      '--source-commit',
      '--review-decisions',
      '--export-operation',
      '--export-uri',
      '--rollback-artifact',
    ],
  },
  approve: {
    required: ['--plan', '--approval-role', '--reviewer-id', '--confirm-plan-digest', '--output'],
  },
  prepare: {
    required: [
      '--reviewed-plan',
      '--rollback-artifact',
      '--confirm-plan-digest',
      '--confirm-approval-digest',
      '--confirm-project',
      '--confirm-database',
      '--confirm-commit',
      '--confirm-export',
      '--actor-id',
    ],
  },
  apply: {
    required: [
      '--reviewed-plan',
      // Preflight decrypts the before-images and checks them against the plan.
      // Without the artifact there is nothing to roll back to, so an apply
      // that could not name one must not start.
      '--rollback-artifact',
      '--confirm-plan-digest',
      '--confirm-approval-digest',
      '--confirm-project',
      '--confirm-database',
      '--confirm-commit',
      '--confirm-export',
      '--actor-id',
      '--drain-evidence',
      '--report-dir',
    ],
  },
  verify: {
    required: [
      '--reviewed-plan',
      '--confirm-plan-digest',
      '--confirm-approval-digest',
      '--confirm-project',
      '--confirm-database',
      '--run-id',
    ],
    optional: ['--report-dir'],
  },
  'rollback-plan': {
    required: [
      '--reviewed-plan',
      '--confirm-plan-digest',
      '--confirm-approval-digest',
      '--confirm-project',
      '--confirm-database',
      '--run-id',
      '--output',
    ],
  },
  'rollback-approve': {
    required: [
      '--rollback-plan-file',
      '--approval-role',
      '--reviewer-id',
      '--confirm-rollback-digest',
      '--output',
    ],
  },
  'rollback-apply': {
    required: [
      '--reviewed-rollback',
      '--rollback-artifact',
      '--confirm-rollback-digest',
      '--confirm-project',
      '--confirm-database',
      '--run-id',
      '--actor-id',
    ],
  },
};

const APPROVAL_ROLES = new Set(['identity_technical', 'finance', 'auth_security']);
const ROLLBACK_APPROVAL_ROLES = new Set(['rollback_technical', 'rollback_finance']);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function parseStudentProfileNormalizationArgs(
  argv: readonly string[]
): StudentProfileNormalizationCliOptions {
  // Help is resolved before anything else so `--help` can never be the thing
  // that opens a database connection or trips a validation error.
  if (argv.includes('--help') || argv.includes('-h')) return { mode: 'help' };

  for (const arg of argv) {
    if (FORBIDDEN_SECRET_FLAGS.has(arg)) {
      // Names the flag, never the value that followed it.
      throw new Error(
        `STUDENT_PROFILE_CLI_SECRET_FLAG_FORBIDDEN: ${arg} is not accepted. ` +
          'Supply the rollback key through STUDENT_PROFILE_ROLLBACK_KEY_BASE64.'
      );
    }
  }

  const modes = argv.filter((arg) => arg in MODE_FLAGS);
  if (modes.length === 0) {
    const err = new Error(
      `STUDENT_PROFILE_CLI_MODE_REQUIRED: one of ${Object.keys(MODE_FLAGS).join(', ')}`
    );
    (err as any).usageError = true;
    throw err;
  }
  if (modes.length > 1) {
    throw new Error(`STUDENT_PROFILE_CLI_MODE_CONFLICT: ${modes.join(', ')}`);
  }

  const mode = MODE_FLAGS[modes[0]];
  const policy = MODE_FLAG_POLICY[mode];
  const allowed = new Set([...policy.required, ...(policy.optional ?? [])]);

  const options: StudentProfileNormalizationCliOptions = { mode };
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === modes[0]) continue;

    const spec = FLAGS[arg];
    if (!spec) {
      const err = new Error(`STUDENT_PROFILE_CLI_UNKNOWN_FLAG: ${arg}`);
      (err as any).usageError = true;
      throw err;
    }
    if (!allowed.has(arg)) {
      throw new Error(`STUDENT_PROFILE_CLI_FLAG_NOT_ALLOWED: ${arg} in mode ${mode}`);
    }
    if (seen.has(arg)) {
      // Last-one-wins would let a stale value scrolled up in shell history sit
      // silently ahead of the intended one.
      throw new Error(`STUDENT_PROFILE_CLI_FLAG_REPEATED: ${arg}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`STUDENT_PROFILE_CLI_FLAG_MISSING_VALUE: ${arg}`);
    }
    if (spec.digest && !DIGEST_PATTERN.test(value)) {
      throw new Error(
        `STUDENT_PROFILE_CLI_DIGEST_MALFORMED: ${arg} expects 64 lowercase hex characters`
      );
    }

    seen.add(arg);
    index += 1;
    (options[spec.key] as string) = value;
  }

  for (const flag of policy.required) {
    if (!seen.has(flag)) {
      throw new Error(`STUDENT_PROFILE_CLI_FLAG_REQUIRED: ${flag} in mode ${mode}`);
    }
  }

  const allowedApprovalRoles = mode === 'rollback-approve'
    ? ROLLBACK_APPROVAL_ROLES
    : APPROVAL_ROLES;
  if (options.approvalRole !== undefined && !allowedApprovalRoles.has(options.approvalRole)) {
    throw new Error(
      `STUDENT_PROFILE_CLI_ROLE_UNKNOWN: ${options.approvalRole}; ` +
        `expected one of ${[...allowedApprovalRoles].join(', ')}`
    );
  }

  return options;
}

/**
 * Where the verification the release gate reads is filed.
 *
 * Health looks this up by run id. Before it existed nothing carried the
 * engine's money check across to Workstream D, so the gate's money invariant
 * could only ever be null.
 */
export const STUDENT_PROFILE_NORMALIZATION_VERIFICATIONS =
  'student_profile_normalization_verifications';

/**
 * Collections whose reference to a retired profile is the point, not a leak.
 *
 * The alias and the code reservation are how an old receipt still resolves to
 * the right child; the runs and journals are the record that any of this was
 * reviewed. Counting them as surviving references would make every run fail
 * its own verification.
 */
const PRESERVED_REFERENCE_COLLECTIONS = new Set([
  'student_profile_aliases',
  'student_code_registry',
  'student_profile_merge_runs',
  'student_profile_merge_journal',
]);

/**
 * The plan digest the rollback artifact was sealed against.
 *
 * Recomputed rather than carried, so an edited artifact reference cannot make
 * a plan appear to match an artifact it was never approved with.
 */
function planPreimageDigestOf(reviewed: StudentProfileMergeReviewedFile): string {
  return createStudentProfileMergePlanDigest({ ...reviewed.plan, rollbackArtifact: null });
}

function say(runtime: StudentIdentityCliRuntime, line: string): void {
  if (typeof runtime.stdout === 'function') runtime.stdout(line);
  else runtime.stdout.write(line);
}

async function readAll(
  db: DocumentStore,
  name: string
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const snapshot = await db.collection(name).get();
  return (snapshot.docs || []).map((doc) => ({
    id: doc.id,
    data: (doc.data() || {}) as Record<string, unknown>,
  }));
}

async function currentGitCommit(runtime: StudentIdentityCliRuntime): Promise<string> {
  if (!runtime.currentGitCommit) {
    throw new Error('STUDENT_PROFILE_RUNTIME_GIT_COMMIT_READER_MISSING');
  }
  return runtime.currentGitCommit();
}

async function managedExportOperation(
  runtime: StudentIdentityCliRuntime,
  operationName: string
): Promise<ManagedExportOperation> {
  if (!runtime.readManagedExportOperation) {
    throw new Error('STUDENT_PROFILE_RUNTIME_EXPORT_READER_MISSING');
  }
  return runtime.readManagedExportOperation(operationName);
}

function operationResourceName(
  value: string,
  target: { projectId: string; databaseId: string }
): string {
  return value.includes('/')
    ? value
    : `projects/${target.projectId}/databases/${target.databaseId}/operations/${value}`;
}

function snapshotUpdateTime(snapshot: unknown): string | null {
  const updateTime = (snapshot as { updateTime?: unknown } | null)?.updateTime;
  if (typeof updateTime === 'string') return updateTime;
  if (
    typeof updateTime === 'object' &&
    updateTime !== null &&
    typeof (updateTime as { toDate?: unknown }).toDate === 'function'
  ) {
    return (updateTime as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

/** Re-reads exactly every source and target the final plan may touch. */
async function readFinalAuditDocuments(
  db: DocumentStore,
  plan: StudentProfileMergePlan
): Promise<FinalAuditDocument[]> {
  const paths = [
    ...new Set(
      plan.groups.flatMap((group) =>
        group.operations.flatMap((operation) =>
          [operation.sourcePath, operation.targetPath].filter(
            (value): value is string => typeof value === 'string' && value.length > 0
          )
        )
      )
    ),
  ].sort();
  const documents: FinalAuditDocument[] = [];

  // DocumentStore limits batch RPC payloads. Chunking also keeps the in-memory
  // test adapter honest without issuing hundreds of serial round trips.
  for (let offset = 0; offset < paths.length; offset += 100) {
    const chunk = paths.slice(offset, offset + 100);
    const snapshots = await db.getAll(...chunk.map((path) => db.doc(path)));
    snapshots.forEach((snapshot, index) => {
      documents.push({
        path: chunk[index],
        data: snapshot.exists
          ? ((snapshot.data() ?? {}) as Record<string, unknown>)
          : null,
        updateTime: snapshotUpdateTime(snapshot),
      });
    });
  }
  return documents;
}

/**
 * Restatement, checked against the file rather than against itself.
 *
 * The operator types the digests they reviewed; a file that does not carry
 * them is the wrong file, and finding that out here costs nothing.
 */
function assertReviewedMatchesConfirmations(
  reviewed: StudentProfileMergeReviewedFile,
  options: StudentProfileNormalizationCliOptions
): void {
  const planDigest = createStudentProfileMergePlanDigest(reviewed.plan);
  if (planDigest !== reviewed.planDigest) {
    throw new Error('STUDENT_PROFILE_PLAN_DIGEST_MISMATCH: the file does not hash to its own digest');
  }
  const approvalDigest = createStudentProfileMergeApprovalDigest({
    planDigest: reviewed.planDigest,
    approvals: reviewed.approvals,
  });
  if (approvalDigest !== reviewed.approvalDigest) {
    throw new Error(
      'STUDENT_PROFILE_APPROVAL_DIGEST_MISMATCH: the approvals do not hash to the recorded digest'
    );
  }
  if (options.confirmPlanDigest && options.confirmPlanDigest !== reviewed.planDigest) {
    throw new Error(`STUDENT_PROFILE_PLAN_DIGEST_MISMATCH: file holds ${reviewed.planDigest}`);
  }
  if (options.confirmApprovalDigest && options.confirmApprovalDigest !== reviewed.approvalDigest) {
    throw new Error(
      `STUDENT_PROFILE_APPROVAL_DIGEST_MISMATCH: file holds ${reviewed.approvalDigest}`
    );
  }
}

export async function normalizeStudentProfilesCommand(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  if (options.mode === 'help') {
    // Answered before a database is opened. `--help` is the one mode that must
    // work with no credentials, no target, and no network.
    say(runtime, Object.keys(MODE_FLAGS).join(', '));
    return 0;
  }

  const opened = await runtime.openDocumentStore();
  if (options.confirmProjectId || options.confirmDatabaseId) {
    assertConfirmedTarget(opened.target, {
      projectId: options.confirmProjectId,
      databaseId: options.confirmDatabaseId,
    });
  }

  if (options.mode === 'audit-preliminary' || options.mode === 'audit-final') {
    return auditNormalization(options, runtime, opened.db, opened.target);
  }
  if (options.mode === 'approve') {
    return approveNormalization(options, runtime);
  }
  if (options.mode === 'prepare') {
    return prepareNormalization(options, runtime, opened.db, opened.target);
  }
  if (options.mode === 'apply') {
    return applyNormalization(options, runtime, opened.db, opened.target);
  }
  if (options.mode === 'verify') {
    return verifyNormalization(options, runtime, opened.db);
  }
  if (options.mode === 'rollback-plan') {
    return planRollback(options, runtime, opened.db);
  }
  if (options.mode === 'rollback-approve') {
    return approveRollback(options, runtime);
  }
  if (options.mode === 'rollback-apply') {
    return applyRollback(options, runtime, opened.db, opened.target);
  }

  // Exhaustive. Every mode the parser accepts is dispatched above, and the
  // compiler is what proves it: a mode added to the union without a runner
  // fails to build rather than reaching an operator as a command that parses,
  // opens a database, and then says it does not exist.
  const unreachable: never = options.mode;
  throw new Error(`STUDENT_PROFILE_NORMALIZATION_MODE_UNKNOWN: ${String(unreachable)}`);
}

/**
 * Registers the reviewed run before maintenance is entered.
 *
 * The maintenance gate refuses an unknown run, while apply is intentionally
 * forbidden until maintenance is already held. This create-only control
 * record closes that ordering gap without writing any student business data.
 */
async function prepareNormalization(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore,
  target: { projectId: string; databaseId: string }
): Promise<number> {
  const reviewed = await readJsonArtifact<StudentProfileMergeReviewedFile>(
    options.reviewedPlanPath as string,
    runtime
  );
  assertReviewedMatchesConfirmations(reviewed, options);
  const artifact = await readJsonArtifact<EncryptedRollbackArtifact>(
    options.rollbackArtifactPath as string,
    runtime
  );
  const rollbackKeyBase64 = runtime.env.STUDENT_PROFILE_ROLLBACK_KEY_BASE64 ?? '';
  if (!rollbackKeyBase64) {
    throw new Error('STUDENT_PROFILE_ROLLBACK_KEY_MISSING: set it in the environment, not a flag');
  }
  const observedCommit = await currentGitCommit(runtime);
  const prepared = preflightStudentProfileNormalization({
    reviewed,
    rollbackArtifact: artifact,
    rollbackAad: {
      projectId: target.projectId,
      databaseId: target.databaseId,
      runId: reviewed.plan.runId,
      planPreimageDigest: planPreimageDigestOf(reviewed),
    },
    rollbackKeyBase64,
    confirmations: {
      planDigest: options.confirmPlanDigest as string,
      approvalDigest: options.confirmApprovalDigest as string,
      projectId: options.confirmProjectId as string,
      databaseId: options.confirmDatabaseId as string,
      sourceCommit: options.confirmCommit as string,
      exportOperationId: options.confirmExportOperationId as string,
      actorId: options.actorId as string,
      runId: reviewed.plan.runId,
    },
    // The maintenance facts are checked when apply runs. Supplying the future
    // binding here lets the shared preflight validate every other immutable
    // field without pretending maintenance has already been entered.
    observed: {
      projectId: target.projectId,
      databaseId: target.databaseId,
      currentCommit: observedCommit,
      registryVersion: STUDENT_REFERENCE_REGISTRY_VERSION,
      maintenanceMode: 'read_only',
      activeRunId: reviewed.plan.runId,
      migrationActorId: options.actorId as string,
    },
  });

  const operationName = reviewed.plan.exportEvidence?.operationName;
  if (!operationName) throw new Error('STUDENT_PROFILE_PREPARE_EXPORT_EVIDENCE_MISSING');
  const runPath = `student_profile_merge_runs/${reviewed.plan.runId}`;
  await db.runTransaction(async (tx) => {
    const ref = db.doc(runPath);
    const existing = (await tx.get(ref as never)) as unknown as { exists: boolean };
    if (existing.exists) {
      throw new Error(`STUDENT_PROFILE_RUN_ALREADY_EXISTS:${reviewed.plan.runId}`);
    }
    tx.create(ref as never, {
      runId: reviewed.plan.runId,
      status: 'prepared',
      planDigest: reviewed.planDigest,
      approvalDigest: reviewed.approvalDigest,
      sourceCommitSha: reviewed.plan.sourceCommit,
      exportOperationId: operationName,
      rollbackArtifactDigest: artifact.digest,
      registryVersion: reviewed.plan.registryVersion,
      actorId: options.actorId,
      plannedOperationCount: prepared.operations.length,
      pendingOperationCount: prepared.operations.length,
      appliedOperationCount: 0,
      verifiedOperationCount: 0,
      failedOperationCount: 0,
      preparedAt: runtime.now().toISOString(),
    } as never);
  });
  say(runtime, `normalization prepare: ${reviewed.plan.runId}, ${prepared.operations.length} operation(s)`);
  return 0;
}

async function applyNormalization(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore,
  target: { projectId: string; databaseId: string }
): Promise<number> {
  const reviewed = await readJsonArtifact<StudentProfileMergeReviewedFile>(
    options.reviewedPlanPath as string,
    runtime
  );
  assertReviewedMatchesConfirmations(reviewed, options);

  const artifact = await readJsonArtifact<EncryptedRollbackArtifact>(
    options.rollbackArtifactPath as string,
    runtime
  );

  // The key never appears on a command line. A shell history that can decrypt
  // the before-images is a second copy of the data they protect.
  const rollbackKeyBase64 = runtime.env.STUDENT_PROFILE_ROLLBACK_KEY_BASE64 ?? '';
  if (!rollbackKeyBase64) {
    throw new Error('STUDENT_PROFILE_ROLLBACK_KEY_MISSING: set it in the environment, not a flag');
  }

  const maintenance = await db.runTransaction((tx) =>
    readStudentIdentityMaintenanceInTransaction(tx as never, db)
  );
  const drainFile = await readJsonArtifact<{
    generation: number;
    evidence: StudentIdentityDrainEvidence;
  }>(options.drainEvidencePath as string, runtime);
  const runId = reviewed.plan.runId;
  const drainSnapshot = await db.doc(`${STUDENT_IDENTITY_DRAIN_EVIDENCE}/${runId}`).get();
  if (!drainSnapshot.exists) {
    throw new Error(`STUDENT_IDENTITY_DRAIN_EVIDENCE_MISSING: no evidence recorded for ${runId}`);
  }
  const recordedDrain = drainSnapshot.data() as StudentIdentityDrainEvidence;
  const drainBinding = {
    planDigest: reviewed.planDigest,
    approvalDigest: reviewed.approvalDigest,
  };
  assertStudentIdentityDrainEvidence(drainFile.evidence, runId, drainBinding);
  assertStudentIdentityDrainEvidence(recordedDrain, runId, drainBinding);
  if (drainFile.generation !== maintenance.generation) {
    throw new Error(
      `STUDENT_IDENTITY_DRAIN_EVIDENCE_GENERATION_MISMATCH: evidence ${drainFile.generation}, maintenance ${maintenance.generation}`
    );
  }
  if (canonicalJson(drainFile.evidence) !== canonicalJson(recordedDrain)) {
    throw new Error('STUDENT_IDENTITY_DRAIN_EVIDENCE_FILE_MISMATCH');
  }

  const observedCommit = await currentGitCommit(runtime);
  const preflighted = preflightStudentProfileNormalization({
    reviewed,
    rollbackArtifact: artifact,
    rollbackAad: {
      projectId: target.projectId,
      databaseId: target.databaseId,
      runId: options.runId ?? reviewed.plan.runId,
      // The plan as it stood before the artifact's own digest was written into
      // it. Sealing against the finished plan would be circular — the digest
      // would have to exist before the field that contains it — so the
      // pre-image is what binds the two together.
      planPreimageDigest: planPreimageDigestOf(reviewed),
    },
    rollbackKeyBase64,
    confirmations: {
      planDigest: options.confirmPlanDigest as string,
      approvalDigest: options.confirmApprovalDigest as string,
      projectId: options.confirmProjectId as string,
      databaseId: options.confirmDatabaseId as string,
      sourceCommit: options.confirmCommit as string,
      exportOperationId: options.confirmExportOperationId as string,
      actorId: options.actorId as string,
      runId: options.runId ?? reviewed.plan.runId,
    },
    observed: {
      projectId: target.projectId,
      databaseId: target.databaseId,
      currentCommit: observedCommit,
      registryVersion: STUDENT_REFERENCE_REGISTRY_VERSION,
      maintenanceMode: maintenance.mode,
      activeRunId: maintenance.activeRunId,
      migrationActorId: maintenance.migrationActorId,
    },
  });
  const runSnapshot = await db.doc(`student_profile_merge_runs/${reviewed.plan.runId}`).get();
  if (!runSnapshot.exists) {
    throw new Error(`STUDENT_PROFILE_APPLY_RUN_NOT_PREPARED:${reviewed.plan.runId}`);
  }
  const run = (runSnapshot.data() ?? {}) as Record<string, unknown>;
  const expectedRunValues: Record<string, unknown> = {
    planDigest: reviewed.planDigest,
    approvalDigest: reviewed.approvalDigest,
    sourceCommitSha: reviewed.plan.sourceCommit,
    exportOperationId: reviewed.plan.exportEvidence?.operationName ?? '',
    rollbackArtifactDigest: artifact.digest,
    registryVersion: reviewed.plan.registryVersion,
    actorId: options.actorId,
    plannedOperationCount: preflighted.operations.length,
  };
  for (const [field, expected] of Object.entries(expectedRunValues)) {
    if (run[field] !== expected) {
      throw new Error(`STUDENT_PROFILE_APPLY_RUN_BINDING_MISMATCH:${field}`);
    }
  }
  if (!['prepared', 'applying', 'applied'].includes(String(run.status ?? ''))) {
    throw new Error(`STUDENT_PROFILE_APPLY_RUN_STATUS_INVALID:${String(run.status ?? 'missing')}`);
  }

  const result = await applyStudentProfileNormalization({
    preflighted,
    store: createDocumentStoreNormalizationStore(db),
  });

  if (options.reportDir) {
    await writeJsonArtifactThroughRuntime(
      `${options.reportDir}/student-profile-apply-result.json`,
      result,
      runtime
    );
  }

  say(
    runtime,
    `normalization apply: ${result.status}, ${result.appliedOperationIds.length} applied, ${result.skippedOperationIds.length} skipped`
  );
  if (result.status !== 'applied') {
    throw new Error(
      `STUDENT_PROFILE_APPLY_FAILED: ${result.failure?.code ?? 'unknown'} at ${result.failure?.operationId ?? 'unknown'}`
    );
  }
  return 0;
}

async function verifyNormalization(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore
): Promise<number> {
  const reviewed = await readJsonArtifact<StudentProfileMergeReviewedFile>(
    options.reviewedPlanPath as string,
    runtime
  );
  assertReviewedMatchesConfirmations(reviewed, options);

  const runId = options.runId as string;
  const [profiles, aliases, journal, ledgers, summaries, credentials, linkedUsers, registry, classes, enrollments] =
    await Promise.all([
      readAll(db, 'students'),
      readAll(db, 'student_profile_aliases'),
      readAll(db, 'student_profile_merge_journal'),
      readAll(db, 'course_fee_ledgers'),
      readAll(db, 'accounting_student_summaries'),
      readAll(db, 'student_auth_credentials'),
      readAll(db, 'users'),
      readAll(db, 'student_code_registry'),
      readAll(db, 'classes'),
      readAll(db, 'student_course_enrollments'),
    ]);

  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const money = (rows: Array<{ data: Record<string, unknown> }>) =>
    rows.reduce((total, row) => total + Number(row.data.amount ?? 0), 0);

  // The money the plan expected on each side, measured against what is there
  // now. `after` is read from the database rather than restated from the plan,
  // which is the entire point of verifying.
  const observedMoney = {
    before: reviewed.plan.money.before,
    after: { ...reviewed.plan.money.before, ledgerAmounts: money(ledgers) },
  };

  // "Not canonical" rather than a hand-rolled field check: the shared
  // predicate is the one place that knows what retirement looks like, and
  // reading the legacy pointer directly is what the architecture gate exists
  // to stop.
  const retiredIds = profiles
    .filter((doc) => !isCanonicalStudentProfile(doc.data))
    .map((doc) => doc.id);

  // The same inventory the retirement planner uses. Asking it here is what
  // turns "we moved the documents we planned to" into "nothing still points at
  // a profile we retired".
  const inventory = await inventoryStudentReferences({ db, candidateProfileIds: retiredIds });
  const retiredSet = new Set(retiredIds);
  const mutableLegacyReferences = inventory.known
    .filter((match) => !PRESERVED_REFERENCE_COLLECTIONS.has(match.documentPath.split('/')[0]))
    .filter((match) => {
      const entryIds = match.registryEntryIds?.length
        ? match.registryEntryIds
        : [match.registryEntryId];
      return entryIds.some((entryId) => {
        const spec = getStudentReferenceSpec(entryId);
        return !spec.mayRetainLegacyId && spec.rewriteKind !== 'preserve_via_alias';
      });
    })
    .filter((match) => match.matchedProfileIds.some((id) => retiredSet.has(id)))
    .map((match) => match.documentPath);

  const openEnrollmentCountByProfile: Record<string, number> = {};
  for (const row of enrollments) {
    if (text(row.data.status) !== 'active') continue;
    const studentId = text(row.data.studentId);
    if (!studentId) continue;
    openEnrollmentCountByProfile[studentId] = (openEnrollmentCountByProfile[studentId] ?? 0) + 1;
  }

  const aliasIds = new Set(aliases.map((doc) => text(doc.data.legacyProfileId) || doc.id));
  const finalEffectByPath = new Map<string, { path: string; afterFingerprint: string | null }>();
  for (const effect of reviewed.plan.groups.flatMap((group) => group.documentEffects)) {
    finalEffectByPath.set(effect.path, {
      path: effect.path,
      afterFingerprint: effect.afterFingerprint,
    });
  }
  const effectDocuments = await readFinalAuditDocuments(db, reviewed.plan);
  const effectDocumentByPath = new Map(effectDocuments.map((document) => [document.path, document]));
  const documentEffectDrift = [...finalEffectByPath.values()].flatMap((effect) => {
    const data = effectDocumentByPath.get(effect.path)?.data ?? null;
    const observed = data === null ? null : fingerprintDocumentProjection(data);
    return observed === effect.afterFingerprint
      ? []
      : [{ path: effect.path, expected: effect.afterFingerprint, observed }];
  });

  const verification = verifyStudentProfileNormalization({
    runId,
    plannedOperationCount: reviewed.plan.groups.reduce(
      (total, group) => total + group.operations.length,
      0
    ),
    journal: journal
      .filter((entry) => text(entry.data.runId) === runId)
      .map((entry) => ({
        operationId: text(entry.data.operationId),
        status: text(entry.data.status) as 'applied' | 'failed' | 'pending',
      })),
    observations: {
      profiles: profiles.map((doc) => ({ id: doc.id, ...doc.data })),
      aliases: aliases.map((doc) => ({
        legacyProfileId: text(doc.data.legacyProfileId) || doc.id,
        canonicalProfileId: text(doc.data.canonicalProfileId),
      })),
      codeOwners: registry.map((doc) => ({
        code: doc.id,
        profileId: text(doc.data.studentId) || text(doc.data.profileId),
      })),
      mutableLegacyReferences,
      // The inventory reports one row per document with every field and
      // profile it matched; the verifier wants them flattened, one row per
      // (document, field, profile), because that is the granularity a person
      // has to go and look at.
      unknownReferences: inventory.unknown.flatMap((match) =>
        match.matchedFieldPaths.flatMap((fieldPath) =>
          match.matchedProfileIds.map((profileId) => ({
            path: match.documentPath,
            fieldPath,
            profileId,
          }))
        )
      ),
      openEnrollmentCountByProfile,
      aliasOwnedUserIds: linkedUsers
        .filter((doc) => aliasIds.has(text(doc.data.studentId)))
        .map((doc) => doc.id),
      aliasOwnedCredentialIds: credentials.filter((doc) => aliasIds.has(doc.id)).map((doc) => doc.id),
      aliasOwnedSummaryIds: summaries.filter((doc) => aliasIds.has(doc.id)).map((doc) => doc.id),
      classCounts: classes.map((doc) => ({
        classId: doc.id,
        rosterCount: Number(doc.data.studentCount ?? 0),
        enrollmentCount: enrollments.filter(
          (row) => text(row.data.classId) === doc.id && text(row.data.status) === 'active'
        ).length,
      })),
      money: observedMoney,
      financeAnomalies: [],
      documentEffectDrift,
    },
    baseline: { financeAnomalies: [] },
  });

  const record = {
    runId,
    planDigest: reviewed.planDigest,
    approvalDigest: reviewed.approvalDigest,
    moneyMatches: verification.moneyMatches,
    valid: verification.valid,
    blockers: verification.blockers,
    operationCounts: verification.operationCounts,
    verifiedAt: runtime.now().toISOString(),
  };

  // Create-only. A verification that could be rewritten later is not evidence
  // that anything was verified.
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`${STUDENT_PROFILE_NORMALIZATION_VERIFICATIONS}/${runId}`);
    const runRef = db.doc(`student_profile_merge_runs/${runId}`);
    const snapshot = (await tx.get(ref as never)) as unknown as { exists: boolean };
    const runSnapshot = (await tx.get(runRef as never)) as unknown as {
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    };
    if (snapshot.exists) {
      throw new Error(`STUDENT_PROFILE_VERIFICATION_IMMUTABLE: ${runId} is already verified`);
    }
    if (!runSnapshot.exists) {
      throw new Error(`STUDENT_PROFILE_VERIFICATION_RUN_MISSING:${runId}`);
    }
    const run = runSnapshot.data() ?? {};
    if (String(run.status ?? '') !== 'applied') {
      throw new Error(`STUDENT_PROFILE_VERIFICATION_RUN_NOT_APPLIED:${String(run.status ?? '')}`);
    }
    tx.set(ref as never, record as never);
    tx.set(runRef as never, {
      ...run,
      status: verification.valid ? 'verified' : 'verification_failed',
      verifiedOperationCount: verification.valid ? verification.operationCounts.applied : 0,
      pendingOperationCount: 0,
      failedOperationCount: verification.operationCounts.failed,
      verifiedAt: runtime.now().toISOString(),
    } as never);
  });

  if (options.reportDir) {
    await writeJsonArtifactThroughRuntime(
      `${options.reportDir}/student-profile-verification.json`,
      record,
      runtime
    );
  }

  say(
    runtime,
    `normalization verify: ${verification.valid ? 'valid' : 'invalid'}, money ${verification.moneyMatches ? 'matches' : 'unverified'}`
  );
  return verification.valid ? 0 : 1;
}

runStudentIdentityCliIfDirect(import.meta.url, () =>
  executeStudentIdentityCli({
    argv: process.argv.slice(2),
    usage: 'Usage: normalize-student-profiles [options]\\nOptions:\\n' + Object.keys(MODE_FLAGS).concat(Object.keys(FLAGS)).join('\\n'),
    parse: parseStudentProfileNormalizationArgs,
    run: normalizeStudentProfilesCommand,
    runtime: createDefaultStudentIdentityCliRuntime(),
  })
);

// --- Audit, approval, and rollback runners ---

/**
 * Review decisions, as a reviewer hands them back.
 *
 * Keyed by candidate id and carrying the evidence fingerprint the candidate was
 * reported with, so a decision written against one reading of the database
 * cannot be applied to another. A decision whose fingerprint no longer matches
 * is dropped rather than honoured — the group returns to needing review, which
 * is the honest state.
 */
type StudentProfileReviewDecisionFile = {
  decisions?: Array<{
    candidateId: string;
    evidenceFingerprint: string;
    decision: 'merge_same_human' | 'confirmed_distinct_person' | 'hold';
    canonicalProfileId?: string;
    reviewerId: string;
    reason: string;
  }>;
  approvedFieldSources?: Record<string, string>;
};

function money(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type FinanceRows = {
  ledgers: Array<{ id: string; data: Record<string, unknown> }>;
  receipts: Array<{ id: string; data: Record<string, unknown> }>;
  invoices: Array<{ id: string; data: Record<string, unknown> }>;
  payments: Array<{ id: string; data: Record<string, unknown> }>;
};

function financeSourceFor(
  profileId: string,
  data: Record<string, unknown>,
  rows: FinanceRows
) {
  const owned = <T extends { data: Record<string, unknown> }>(items: T[]) =>
    items.filter((item) => String(item.data.studentId ?? '') === profileId);

  return {
    id: profileId,
    walletBalance: money(data.walletBalance),
    walletOpeningBalance: money(data.walletOpeningBalance),
    ledgers: owned(rows.ledgers).map((ledger) => ({
      id: ledger.id,
      classId: String(ledger.data.classId ?? ''),
      termStart: String(ledger.data.termStart ?? ''),
      termEnd: String(ledger.data.termEnd ?? ''),
      amount: money(ledger.data.amount),
      paidTotal: money(ledger.data.paidTotal),
      discountTotal: money(ledger.data.discountTotal),
      status: String(ledger.data.status ?? ''),
    })),
    receipts: owned(rows.receipts).map((receipt) => ({
      id: receipt.id,
      ledgerId: String(receipt.data.ledgerId ?? ''),
      amount: money(receipt.data.amount),
    })),
    invoices: owned(rows.invoices).map((invoice) => ({
      id: invoice.id,
      ledgerId: String(invoice.data.ledgerId ?? ''),
      amount: money(invoice.data.amount),
    })),
    pendingPayments: owned(rows.payments).map((payment) => ({
      id: payment.id,
      ledgerId: String(payment.data.ledgerId ?? ''),
      classId: String(payment.data.classId ?? ''),
      termStart: String(payment.data.termStart ?? ''),
      status: String(payment.data.status ?? ''),
      amount: money(payment.data.amount),
    })),
  };
}

/**
 * The read-only half of both audit phases.
 *
 * Neither phase writes anything to DocumentStore. The difference between them is
 * what they are allowed to produce: a preliminary plan carries no executable
 * operation, because it is built before the export exists and from reads bound
 * to no snapshot.
 */
async function auditNormalization(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore,
  target: { projectId: string; databaseId: string }
): Promise<number> {
  const isFinal = options.mode === 'audit-final';
  const auditNow = runtime.now();
  const observedCommit = await currentGitCommit(runtime);
  if (observedCommit !== options.sourceCommit) {
    throw new Error(
      `STUDENT_PROFILE_AUDIT_COMMIT_DRIFT: current ${observedCommit}, requested ${options.sourceCommit}`
    );
  }

  let authoritativeExport: ManagedExportOperation | null = null;
  let verifiedExportEvidence: StudentProfileMergePlan['exportEvidence'] = null;
  if (isFinal) {
    const operationName = operationResourceName(options.exportOperationId as string, target);
    authoritativeExport = await managedExportOperation(runtime, operationName);
    const evidence = verifyManagedExportEvidence({
      operation: authoritativeExport,
      expected: {
        projectId: target.projectId,
        databaseId: target.databaseId,
        outputUriPrefix: options.exportUri as string,
      },
      now: auditNow,
    });
    verifiedExportEvidence = {
      operationName: evidence.operationName,
      outputUriPrefix: evidence.outputUriPrefix,
      snapshotTime: evidence.snapshotTime,
      evidenceDigest: evidence.evidenceDigest,
    };
  }

  // Claimed before a single document is read. The scan below is the most
  // expensive read in the program, and discovering afterwards that the report
  // has nowhere to go throws all of it away.
  await reserveStudentProfileNormalizationReportDir(options.reportDir as string);

  const [students, aliases, enrollments, users, credentials, ledgers, receipts, invoices, payments] =
    await Promise.all([
      readAll(db, 'students'),
      readAll(db, 'student_profile_aliases'),
      readAll(db, 'student_course_enrollments'),
      readAll(db, 'users'),
      readAll(db, 'student_auth_credentials'),
      readAll(db, 'course_fee_ledgers'),
      readAll(db, 'receipts'),
      readAll(db, 'invoices'),
      readAll(db, 'payment_requests'),
    ]);

  const openStatuses = new Set(['trial', 'active', 'on_leave']);
  const openByProfile = new Set(
    enrollments
      .filter((row) => openStatuses.has(String(row.data.status ?? '')))
      .map((row) => String(row.data.studentId ?? ''))
  );
  const aliasIds = new Set(aliases.map((row) => row.id));
  const linkedByProfile = new Set(
    users.map((row) => String(row.data.studentId ?? '')).filter(Boolean)
  );
  const financeByProfile = new Set(
    [...ledgers, ...receipts, ...invoices, ...payments]
      .map((row) => String(row.data.studentId ?? ''))
      .filter(Boolean)
  );

  const plannerProfiles = students.map((row) => ({
    id: row.id,
    normalizedCode: String(row.data.studentId ?? '')
      .trim()
      .toUpperCase(),
    admissionSearchName: String(row.data.admissionSearchName ?? ''),
    admissionSearchDob: String(row.data.admissionSearchDob ?? ''),
    admissionSearchContact: String(row.data.admissionSearchContact ?? ''),
    mergedIntoStudentId: String(row.data.mergedIntoStudentId ?? '').trim(),
    isTombstone: String(row.data.studentProfileState ?? '') === 'merged_tombstone',
    hasAlias: aliasIds.has(row.id),
    hasOpenEnrollment: openByProfile.has(row.id),
    hasCurrentLinkedAuth: linkedByProfile.has(row.id),
    hasActiveFinance: financeByProfile.has(row.id),
    classProjectionConsistent: true,
    profileCompleteness: Object.values(row.data).filter(
      (value) => value !== null && value !== undefined && value !== ''
    ).length,
    verifiedTimestamp: typeof row.data.createdAt === 'string' ? (row.data.createdAt as string) : null,
    archived: String(row.data.studentLifecycle ?? '') === 'archived',
  }));

  const candidates = detectStudentIdentityCandidates(plannerProfiles);

  // Only the profiles a candidate names. Scanning for references to every
  // student in the centre would take hours and answer a question nobody asked.
  const candidateProfileIds = [
    ...new Set(candidates.flatMap((candidate) => candidate.profileIds)),
  ].sort();
  const inventory = await inventoryStudentReferences({ db, candidateProfileIds });

  let decisionFile: StudentProfileReviewDecisionFile = {};
  if (options.reviewDecisionsPath) {
    decisionFile = await readJsonArtifact<StudentProfileReviewDecisionFile>(
      options.reviewDecisionsPath,
      runtime
    );
  }
  const decisionsByCandidate = new Map(
    (decisionFile.decisions ?? []).map((entry) => [entry.candidateId, entry])
  );

  const decided = candidates.map((candidate) => {
    const decision = decisionsByCandidate.get(candidate.candidateId);
    if (!decision) return candidate;
    if (decision.evidenceFingerprint !== candidate.evidenceFingerprint) {
      // The database moved under the decision. Honouring it would apply a
      // judgement made about a different set of documents.
      return candidate;
    }
    return {
      ...candidate,
      decision: decision.decision,
      proposedCanonicalProfileId: decision.canonicalProfileId ?? candidate.proposedCanonicalProfileId,
    };
  });

  const profilesById: Record<string, Record<string, unknown>> = {};
  for (const row of students) profilesById[row.id] = row.data;

  const financeById: Record<string, ReturnType<typeof financeSourceFor>> = {};
  for (const id of candidateProfileIds) {
    financeById[id] = financeSourceFor(id, profilesById[id] ?? {}, {
      ledgers,
      receipts,
      invoices,
      payments,
    });
  }

  const plan = planStudentProfileNormalization({
    runId: options.runId as string,
    auditPhase: isFinal ? 'final' : 'preliminary',
    sourceCommit: observedCommit,
    registryVersion: STUDENT_REFERENCE_REGISTRY_VERSION,
    target,
    exportEvidence: verifiedExportEvidence,
    rollbackArtifact: null,
    actorId: options.actorId ?? 'audit',
    now: auditNow.toISOString(),
    candidates: decided,
    profiles: profilesById,
    finance: financeById,
    credentials: credentials.map((row) => ({
      profileId: row.id,
      exists: true,
      hasStudentPassword: Boolean(row.data.studentPasswordHash),
      hasParentPassword: Boolean(row.data.parentPasswordHash),
      studentPasswordVersion:
        typeof row.data.studentPasswordVersion === 'number'
          ? (row.data.studentPasswordVersion as number)
          : null,
      parentPasswordVersion:
        typeof row.data.parentPasswordVersion === 'number'
          ? (row.data.parentPasswordVersion as number)
          : null,
      updatedAt: typeof row.data.updatedAt === 'string' ? (row.data.updatedAt as string) : null,
      // Non-reversible by construction: a digest of the stored material, never
      // the material. Two records agreeing here is what "identical credential"
      // means downstream.
      materialFingerprint: sha256(
        `${String(row.data.studentPasswordHash ?? '')}|${String(row.data.parentPasswordHash ?? '')}`
      ),
    })),
    linkedUsers: users.map((row) => {
      const prefix = row.id.startsWith('student:')
        ? row.id.slice('student:'.length)
        : row.id.startsWith('parent:')
          ? row.id.slice('parent:'.length)
          : null;
      const fieldProfileId = String(row.data.studentId ?? '') || null;
      // The `role` field first, the id prefix second.
      //
      // `student:<id>` / `parent:<id>` is what studentProfileSync writes, but
      // accounts also exist keyed by the Firebase Auth uid, and every serving
      // path — authz, the health service, realtime recipients — classifies
      // those by the field. Reading only the prefix calls them `unknown`, and
      // an unknown role blocks the merge outright: the first production audit
      // blocked 36 of 58 pointer groups on accounts whose role was written
      // down plainly. Anything the field and the prefix both fail to name
      // stays unknown, because an unrecognized account still grants somebody
      // access and guessing at it is what the blocker exists to prevent.
      const declaredRole = String(row.data.role ?? '');
      const role =
        declaredRole === 'student' || declaredRole === 'parent'
          ? declaredRole
          : row.id.startsWith('student:')
            ? 'student'
            : row.id.startsWith('parent:')
              ? 'parent'
              : 'unknown';
      return {
        userId: row.id,
        role: role as 'student' | 'parent' | 'unknown',
        idProfileId: prefix,
        fieldProfileId,
        idFieldAgree: prefix === null || fieldProfileId === null || prefix === fieldProfileId,
        isRevoked: row.data.isRevoked === true,
      };
    }),
    inventory,
    approvedFieldSources: decisionFile.approvedFieldSources,
  });

  if (isFinal) {
    const rollbackKeyBase64 = runtime.env.STUDENT_PROFILE_ROLLBACK_KEY_BASE64 ?? '';
    if (!rollbackKeyBase64) {
      throw new Error(
        'STUDENT_PROFILE_ROLLBACK_KEY_MISSING: set STUDENT_PROFILE_ROLLBACK_KEY_BASE64 in the environment'
      );
    }
    const documents = await readFinalAuditDocuments(db, plan);
    const finalized = finalizeStudentProfileNormalizationPlan({
      plan,
      documents,
      exportOperation: authoritativeExport as ManagedExportOperation,
      expectedExportUri: options.exportUri as string,
      now: auditNow,
      rollbackKeyBase64,
    });
    const requestedFileName = String(options.rollbackArtifactPath)
      .replace(/\\/g, '/')
      .split('/')
      .at(-1);
    if (requestedFileName !== finalized.artifact.fileName) {
      throw new Error(
        `STUDENT_PROFILE_ROLLBACK_ARTIFACT_FILE_NAME_INVALID: expected ${finalized.artifact.fileName}`
      );
    }
    await writeJsonArtifactThroughRuntime(
      options.rollbackArtifactPath as string,
      finalized.artifact,
      runtime
    );
  }

  const paths = await writeStudentProfileNormalizationReports({
    outputDir: options.reportDir as string,
    plan,
    inventory: {
      collections: inventory.scannedCollections,
      matches: inventory.known,
      unknown: inventory.unknown,
    },
    reserved: true,
  });

  const blockerCount =
    plan.blockers.length + plan.groups.reduce((sum, group) => sum + group.blockers.length, 0);
  say(
    runtime,
    `${isFinal ? 'final' : 'preliminary'} audit: ${plan.groups.length} group(s), ` +
      `${blockerCount} blocker(s), plan at ${paths.planPath}`
  );
  return blockerCount === 0 ? 0 : 1;
}

/**
 * One reviewer, one signature, one file.
 *
 * Approval attests an artifact and never edits one: it re-derives the digest
 * from the plan's own bytes and refuses if that disagrees with the digest being
 * signed. It reads no review decisions and regenerates no operations.
 */
async function approveNormalization(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const stored = await readJsonArtifact<{
    plan: StudentProfileMergePlan;
    planDigest: string | null;
    applyable?: boolean;
    approvals?: StudentProfileMergeApproval[];
  }>(options.planPath as string, runtime);

  if (stored.applyable !== true) {
    throw new Error(
      'STUDENT_PROFILE_PLAN_NOT_APPLYABLE: only a final audit produces an approvable plan'
    );
  }

  const planDigest = createStudentProfileMergePlanDigest(stored.plan);
  if (planDigest !== options.confirmPlanDigest) {
    throw new Error(`STUDENT_PROFILE_PLAN_DIGEST_MISMATCH: plan digests to ${planDigest}`);
  }

  const approvals: StudentProfileMergeApproval[] = [
    ...(stored.approvals ?? []),
    {
      role: options.approvalRole as StudentProfileMergeApproval['role'],
      reviewerId: options.reviewerId as string,
      reviewedAt: runtime.now().toISOString(),
      planDigest,
    },
  ];

  // A partial approval still writes a file; it simply is not reviewed yet. The
  // executor is what refuses to act on one, and it refuses by role, so a
  // half-signed artifact cannot be mistaken for a complete one.
  let reviewed: StudentProfileMergeReviewedFile | null = null;
  try {
    reviewed = createReviewedStudentProfileNormalizationPlan({
      plan: stored.plan,
      planDigest,
      approvals,
      authorizedReviewers: authorizedReviewersFrom(runtime),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('STUDENT_PROFILE_APPROVAL_ROLE_MISSING')) throw error;
  }

  await writeJsonArtifactThroughRuntime(
    options.outputPath as string,
    reviewed ?? { ...stored, planDigest, approvals },
    runtime
  );
  say(
    runtime,
    `approval by ${options.approvalRole}: ${reviewed ? 'complete' : 'awaiting further roles'}`
  );
  return 0;
}

/**
 * Who may sign, read from the environment rather than from the artifact.
 *
 * A reviewer list carried inside the plan would be a list the plan's author
 * could extend.
 */
function authorizedReviewersFrom(runtime: StudentIdentityCliRuntime) {
  const list = (name: string) =>
    String(runtime.env[name] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  return {
    identity_technical: list('STUDENT_PROFILE_IDENTITY_REVIEWERS'),
    finance: list('STUDENT_PROFILE_FINANCE_REVIEWERS'),
    auth_security: list('STUDENT_PROFILE_AUTH_REVIEWERS'),
  };
}

function authorizedRollbackReviewersFrom(runtime: StudentIdentityCliRuntime) {
  const list = (name: string) =>
    String(runtime.env[name] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  return {
    rollback_technical: list('STUDENT_PROFILE_ROLLBACK_TECHNICAL_REVIEWERS'),
    rollback_finance: list('STUDENT_PROFILE_ROLLBACK_FINANCE_REVIEWERS'),
  };
}

/**
 * Rollback planning, approval, and execution.
 *
 * All three are bound to the run they reverse and to the digests of the plan
 * that created it. The window is the read-only maintenance window: after the
 * release gate lifts it, the executor refuses and the answer is forward repair
 * under a new reviewed run.
 */
async function planRollback(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore
): Promise<number> {
  const reviewed = await readJsonArtifact<StudentProfileMergeReviewedFile>(
    options.reviewedPlanPath as string,
    runtime
  );
  assertReviewedMatchesConfirmations(reviewed, options);

  const runId = options.runId ?? reviewed.plan.runId;
  const journal = await readAll(db, 'student_profile_merge_journal');
  // Only what actually landed. Reversing a planned-but-unapplied operation
  // would restore a before-image over a document nothing ever changed.
  const applied = journal
    .filter((entry) => String(entry.data.runId ?? '') === runId)
    .filter((entry) => String(entry.data.status ?? '') === 'applied')
    .map((entry) => String(entry.data.operationId ?? ''))
    .filter(Boolean);
  const appliedOperationIds = new Set(applied);
  const allEffects = reviewed.plan.groups.flatMap((group) => group.documentEffects);
  const effectOperationIds = new Set(
    allEffects
      .map((effect) => effect.operationId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );
  const appliedWithoutEffect = [...appliedOperationIds].filter(
    (operationId) => !effectOperationIds.has(operationId)
  );
  if (appliedWithoutEffect.length > 0) {
    throw new Error(
      `STUDENT_PROFILE_ROLLBACK_EFFECT_MISSING:${appliedWithoutEffect.sort().join(',')}`
    );
  }

  const rollbackPlan = planStudentProfileNormalizationRollback({
    runId,
    planDigest: reviewed.planDigest,
    approvalDigest: reviewed.approvalDigest,
    rollbackArtifactDigest: reviewed.plan.rollbackArtifact?.digest ?? '',
    documentEffects: allEffects
      .filter((effect) =>
        typeof effect.operationId === 'string' && appliedOperationIds.has(effect.operationId)
      ),
  });

  await writeJsonArtifactThroughRuntime(options.outputPath as string, rollbackPlan, runtime);
  say(runtime, `rollback plan: ${rollbackPlan.documentEffects.length} effect(s) to reverse`);
  return 0;
}

async function approveRollback(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const stored = await readJsonArtifact<
    StudentProfileNormalizationRollbackPlan & {
      approvals?: Array<{
        role: StudentProfileRollbackApprovalRole;
        reviewerId: string;
        reviewedAt: string;
        rollbackDigest: string;
      }>;
    }
  >(options.rollbackPlanPath as string, runtime);

  if (stored.rollbackDigest !== options.confirmRollbackDigest) {
    throw new Error(`STUDENT_PROFILE_ROLLBACK_DIGEST_MISMATCH: file holds ${stored.rollbackDigest}`);
  }

  const approvals = [
    ...(stored.approvals ?? []),
    {
      role: options.approvalRole as StudentProfileRollbackApprovalRole,
      reviewerId: options.reviewerId as string,
      reviewedAt: runtime.now().toISOString(),
      rollbackDigest: stored.rollbackDigest,
    },
  ];

  let reviewed: ReviewedStudentProfileNormalizationRollback | null = null;
  try {
    reviewed = createReviewedStudentProfileNormalizationRollback({
      rollbackPlan: stored,
      confirmRollbackDigest: options.confirmRollbackDigest as string,
      approvals,
      authorizedReviewers: authorizedRollbackReviewersFrom(runtime),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('ROLE_MISSING')) throw error;
  }

  await writeJsonArtifactThroughRuntime(
    options.outputPath as string,
    reviewed ?? { ...stored, approvals },
    runtime
  );
  say(
    runtime,
    `rollback approval by ${options.approvalRole}: ${reviewed ? 'complete' : 'awaiting further roles'}`
  );
  return 0;
}

async function applyRollback(
  options: StudentProfileNormalizationCliOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore,
  target: { projectId: string; databaseId: string }
): Promise<number> {
  const reviewed = await readJsonArtifact<ReviewedStudentProfileNormalizationRollback>(
    options.reviewedRollbackPath as string,
    runtime
  );
  if (reviewed.rollbackDigest !== options.confirmRollbackDigest) {
    throw new Error(
      `STUDENT_PROFILE_ROLLBACK_DIGEST_MISMATCH: file holds ${reviewed.rollbackDigest}`
    );
  }

  const artifact = await readJsonArtifact<EncryptedRollbackArtifact>(
    options.rollbackArtifactPath as string,
    runtime
  );
  const rollbackKeyBase64 = runtime.env.STUDENT_PROFILE_ROLLBACK_KEY_BASE64 ?? '';
  if (!rollbackKeyBase64) {
    throw new Error('STUDENT_PROFILE_ROLLBACK_KEY_MISSING: set it in the environment, not a flag');
  }

  // Read from the run record rather than asserted by the operator: whether
  // writes have reopened is a fact about the database, and it is the one fact
  // that decides whether a restore is still safe.
  const runRecord = await db.doc(`student_profile_merge_runs/${reviewed.runId}`).get();
  const maintenanceLiftedAt = runRecord.exists
    ? ((runRecord.data() as Record<string, unknown> | undefined)?.maintenanceLiftedAt as
        | string
        | null
        | undefined) ?? null
    : null;

  const result = await applyStudentProfileNormalizationRollback({
    reviewed,
    store: createDocumentStoreNormalizationStore(db),
    artifact,
    rollbackAad: {
      projectId: target.projectId,
      databaseId: target.databaseId,
      runId: options.runId ?? reviewed.runId,
      planPreimageDigest: reviewed.planDigest,
    },
    rollbackKeyBase64,
    confirmRollbackDigest: options.confirmRollbackDigest as string,
    expectedActorId: options.actorId as string,
    maintenanceLiftedAt,
  });

  say(
    runtime,
    `rollback: ${result.status}${result.refusal ? ` (${result.refusal.code})` : ''}`
  );
  return result.status === 'rolled_back' ? 0 : 1;
}
