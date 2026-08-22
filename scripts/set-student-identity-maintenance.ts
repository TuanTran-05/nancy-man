/**
 * The maintenance window's command line, and its confirmation layer.
 *
 * Everything here is parsing and restatement. All policy lives in
 * `studentIdentityCutoverGate`, so an operator cannot reach a state the server
 * would refuse by finding a friendlier command — and there is no second copy
 * of the rules to drift from the first.
 *
 * The same three parsing rules as the normalization CLI, for the same reasons:
 * an unknown flag is an error rather than ignored, a repeated flag is an error
 * rather than last-one-wins, and a flag missing its value is an error rather
 * than a silent empty string. Each friendlier alternative is a way an operator
 * comes to believe a safety option is in effect when it is not.
 */

import {
  executeStudentIdentityCli,
  runStudentIdentityCliIfDirect,
  createDefaultStudentIdentityCliRuntime,
  assertConfirmedTarget,
  type StudentIdentityCliRuntime,
} from './student-identity-cli/runtime.js';
import { writeJsonArtifactThroughRuntime } from './student-identity-cli/artifacts.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  transitionStudentIdentityMaintenance,
  recordStudentIdentityDrainEvidence,
  type StudentIdentityMaintenanceTransition,
} from '../server/api/lib/maintenance/studentIdentityCutoverGate.js';
import { readStudentIdentityMaintenanceInTransaction } from '../server/api/lib/maintenance/studentIdentityMaintenance.js';
import { STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH } from '../server/api/lib/maintenance/studentIdentityMutationLease.js';

export type StudentIdentityMaintenanceCliMode = 'show' | 'enter' | 'verify-drain' | 'exit';

/**
 * Kebab on the command line, snake in the document.
 *
 * Kept apart deliberately: the persisted value is part of the release proof
 * and is read by the retirement gate months later, so it must not change
 * because somebody preferred a different flag spelling.
 */
export const EXIT_REASON_CLI_TO_PERSISTED = {
  'verified-cutover': 'verified_cutover',
  'aborted-before-apply': 'aborted_before_apply',
  'verified-rollback': 'verified_rollback',
  'verified-retirement': 'verified_retirement',
} as const;

export type StudentIdentityMaintenanceExitReasonCli = keyof typeof EXIT_REASON_CLI_TO_PERSISTED;

export type SetStudentIdentityMaintenanceOptions = {
  mode: StudentIdentityMaintenanceCliMode;
  expectedGeneration?: number;
  runId?: string;
  actorId?: string;
  reason?: (typeof EXIT_REASON_CLI_TO_PERSISTED)[StudentIdentityMaintenanceExitReasonCli];
  planDigest?: string;
  approvalDigest?: string;
  sourceCommit?: string;
  exportOperationId?: string;
  healthAuditId?: string;
  healthDigest?: string;
  smokeEvidenceId?: string;
  rollbackVerificationId?: string;
  retirementVerificationId?: string;
  projectionRebuildEvidenceId?: string;
  outputPath?: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
};

export class SetStudentIdentityMaintenanceUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetStudentIdentityMaintenanceUsageError';
  }
}

const MODE_FLAGS: Record<string, StudentIdentityMaintenanceCliMode> = {
  '--show': 'show',
  '--enter': 'enter',
  '--verify-drain': 'verify-drain',
  '--exit': 'exit',
};

const VALUE_FLAGS = new Set([
  '--expected-generation',
  '--run-id',
  '--actor-id',
  '--reason',
  '--plan-digest',
  '--approval-digest',
  '--source-commit',
  '--export-operation-id',
  '--health-audit-id',
  '--health-digest',
  '--smoke-evidence-id',
  '--projection-rebuild-evidence-id',
  '--rollback-verification-id',
  '--retirement-verification-id',
  '--output',
  '--confirm-project-id',
  '--confirm-database-id',
]);

function requireAll(values: Map<string, string>, flags: readonly string[], context: string): void {
  const missing = flags.filter((flag) => !values.get(flag));
  if (missing.length > 0) {
    throw new SetStudentIdentityMaintenanceUsageError(`${context} requires ${missing.join(', ')}`);
  }
}

export function parseSetStudentIdentityMaintenanceArgs(
  argv: readonly string[]
): SetStudentIdentityMaintenanceOptions {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  const modes: StudentIdentityMaintenanceCliMode[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new SetStudentIdentityMaintenanceUsageError(`Unexpected argument: ${token}`);
    }
    if (seen.has(token)) {
      throw new SetStudentIdentityMaintenanceUsageError(`Repeated flag: ${token}`);
    }
    seen.add(token);

    if (MODE_FLAGS[token]) {
      modes.push(MODE_FLAGS[token]);
      continue;
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new SetStudentIdentityMaintenanceUsageError(`Unknown flag: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new SetStudentIdentityMaintenanceUsageError(`Missing value for ${token}`);
    }
    values.set(token, value);
    index += 1;
  }

  if (modes.length === 0) {
    throw new SetStudentIdentityMaintenanceUsageError(
      'One of --show, --enter, --verify-drain, or --exit is required'
    );
  }
  if (modes.length > 1) {
    // Two modes in one command is an operator who is not sure what they are
    // doing, and this is not the moment to guess on their behalf.
    throw new SetStudentIdentityMaintenanceUsageError(
      `Exactly one mode is allowed; received ${modes.join(', ')}`
    );
  }

  const mode = modes[0];
  const options: SetStudentIdentityMaintenanceOptions = {
    mode,
    expectedGeneration: values.get('--expected-generation') ? Number(values.get('--expected-generation')) : undefined,
    runId: values.get('--run-id'),
    actorId: values.get('--actor-id'),
    planDigest: values.get('--plan-digest'),
    approvalDigest: values.get('--approval-digest'),
    sourceCommit: values.get('--source-commit'),
    exportOperationId: values.get('--export-operation-id'),
    healthAuditId: values.get('--health-audit-id'),
    healthDigest: values.get('--health-digest'),
    smokeEvidenceId: values.get('--smoke-evidence-id'),
    projectionRebuildEvidenceId: values.get('--projection-rebuild-evidence-id'),
    rollbackVerificationId: values.get('--rollback-verification-id'),
    retirementVerificationId: values.get('--retirement-verification-id'),
    outputPath: values.get('--output'),
    confirmProjectId: values.get('--confirm-project-id'),
    confirmDatabaseId: values.get('--confirm-database-id'),
  };

  if (mode === 'show') return options;

  if (mode === 'verify-drain') {
    // Drain evidence is written to a file *and* to DocumentStore, and both are
    // read again at exit. A path the operator did not name is evidence nobody
    // looks at.
    requireAll(
      values,
      [
        '--run-id',
        '--actor-id',
        '--expected-generation',
        '--plan-digest',
        '--approval-digest',
        '--output',
      ],
      '--verify-drain'
    );
    return options;
  }

  // Both writing modes restate the target: "I ran the right script in the
  // wrong terminal" is the failure this whole program exists to prevent.
  requireAll(values, ['--confirm-project-id', '--confirm-database-id'], `--${mode}`);

  if (mode === 'enter') {
    requireAll(
      values,
      [
        '--expected-generation',
        '--run-id',
        '--actor-id',
        '--plan-digest',
        '--approval-digest',
        '--source-commit',
        '--export-operation-id',
      ],
      '--enter'
    );
    return options;
  }

  requireAll(values, ['--expected-generation', '--run-id', '--actor-id', '--reason'], '--exit');
  const reason = values.get('--reason') as StudentIdentityMaintenanceExitReasonCli;
  if (!EXIT_REASON_CLI_TO_PERSISTED[reason]) {
    throw new SetStudentIdentityMaintenanceUsageError(
      `Invalid --reason: ${reason} (expected ${Object.keys(EXIT_REASON_CLI_TO_PERSISTED).join(', ')})`
    );
  }
  options.reason = EXIT_REASON_CLI_TO_PERSISTED[reason];

  if (reason === 'verified-cutover') {
    requireAll(
      values,
      [
        '--health-audit-id',
        '--health-digest',
        '--smoke-evidence-id',
        // The gate binds the smoke evidence to the rebuild it was run
        // against; without this the exit cannot name that rebuild at all.
        '--projection-rebuild-evidence-id',
      ],
      '--reason verified-cutover'
    );
  }
  if (reason === 'verified-retirement') {
    requireAll(
      values,
      [
        '--health-audit-id',
        '--health-digest',
        '--smoke-evidence-id',
        '--retirement-verification-id',
      ],
      '--reason verified-retirement'
    );
  }
  if (reason === 'verified-rollback') {
    requireAll(values, ['--rollback-verification-id'], '--reason verified-rollback');
  }

  return options;
}

/** Consistent read of the window through a transaction. */
async function readState(db: DocumentStore) {
  return db.runTransaction((tx) => readStudentIdentityMaintenanceInTransaction(tx as never, db));
}

/**
 * The queues the exit gate requires a measurement for.
 *
 * Every one is named even when it is empty: evidence that skipped a queue is
 * not evidence that the queue was drained.
 */
const DRAIN_QUEUE_COLLECTIONS = {
  outboxJobs: 'outbox_jobs',
  accountingFinanceOutbox: 'accounting_finance_outbox',
  receiptNotificationOutbox: 'receipt_notification_outbox',
  zaloBulkJobs: 'zalo_bulk_jobs',
  payosProcessors: 'payos_processors',
  passwordResetWork: 'passwordResetRequests',
} as const;

const PENDING_STATUSES = new Set(['', 'pending', 'processing', 'failed']);

async function countPendingQueues(db: DocumentStore): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [key, collection] of Object.entries(DRAIN_QUEUE_COLLECTIONS)) {
    const snapshot = await db.collection(collection).get();
    counts[key] = snapshot.docs.filter((doc) =>
      PENDING_STATUSES.has(String((doc.data() || {}).status ?? ''))
    ).length;
  }
  return counts;
}

async function countLeases(db: DocumentStore, now: Date): Promise<{ active: number; stale: number }> {
  const snapshot = await db.collection(STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH).get();
  let active = 0;
  let stale = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    if (String(data.state ?? '') !== 'active') continue;
    const expiresAt = Date.parse(String(data.expiresAt ?? ''));
    if (Number.isFinite(expiresAt) && expiresAt < now.getTime()) stale += 1;
    else active += 1;
  }
  return { active, stale };
}

function say(runtime: StudentIdentityCliRuntime, line: string): void {
  if (typeof runtime.stdout === 'function') runtime.stdout(line);
  else runtime.stdout.write(line);
}

/**
 * Builds the transition the gate will evaluate.
 *
 * The parser has already refused anything missing, so the non-null assertions
 * here are reading a contract rather than hoping. Nothing is defaulted: a
 * transition assembled from blanks is exactly how an exit reason ends up
 * bound to evidence nobody produced.
 */
function transitionFor(
  options: SetStudentIdentityMaintenanceOptions
): StudentIdentityMaintenanceTransition {
  const base = {
    runId: options.runId as string,
    actorId: options.actorId as string,
    expectedGeneration: options.expectedGeneration as number,
  };

  if (options.mode === 'enter') {
    return {
      action: 'enter',
      ...base,
      expectedMode: 'normal',
      planDigest: options.planDigest as string,
      approvalDigest: options.approvalDigest as string,
      sourceCommitSha: options.sourceCommit as string,
      exportOperationId: options.exportOperationId as string,
    };
  }

  switch (options.reason) {
    case 'verified_cutover':
      return {
        action: 'exit',
        ...base,
        reason: 'verified_cutover',
        healthAuditId: options.healthAuditId as string,
        healthDigest: options.healthDigest as string,
        smokeEvidenceId: options.smokeEvidenceId as string,
        projectionRebuildEvidenceId: options.projectionRebuildEvidenceId as string,
      };
    case 'verified_retirement':
      return {
        action: 'exit',
        ...base,
        reason: 'verified_retirement',
        retirementVerificationId: options.retirementVerificationId as string,
        healthAuditId: options.healthAuditId as string,
        healthDigest: options.healthDigest as string,
        smokeEvidenceId: options.smokeEvidenceId as string,
      };
    case 'verified_rollback':
      return {
        action: 'exit',
        ...base,
        reason: 'verified_rollback',
        rollbackVerificationId: options.rollbackVerificationId as string,
      };
    default:
      return { action: 'exit', ...base, reason: 'aborted_before_apply' };
  }
}

export async function setStudentIdentityMaintenanceCommand(
  options: SetStudentIdentityMaintenanceOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const opened = await runtime.openDocumentStore();
  if (options.confirmProjectId || options.confirmDatabaseId) {
    assertConfirmedTarget(opened.target, {
      projectId: options.confirmProjectId,
      databaseId: options.confirmDatabaseId,
    });
  }
  return runSetStudentIdentityMaintenance(options, runtime, opened.db);
}

export async function runSetStudentIdentityMaintenance(
  options: SetStudentIdentityMaintenanceOptions,
  runtime: StudentIdentityCliRuntime,
  injectedDb?: DocumentStore
): Promise<number> {
  const db = injectedDb ?? (await runtime.openDocumentStore()).db;

  if (options.mode === 'show') {
    const state = await readState(db);
    say(
      runtime,
      `maintenance mode=${state.mode} generation=${state.generation} run=${state.activeRunId ?? '-'} actor=${state.migrationActorId ?? '-'}`
    );
    if (options.outputPath) {
      await writeJsonArtifactThroughRuntime(options.outputPath, state, runtime);
    }
    return 0;
  }

  if (options.mode === 'verify-drain') {
    const state = await readState(db);
    if (state.generation !== options.expectedGeneration) {
      throw new Error(
        `STUDENT_IDENTITY_GENERATION_MISMATCH: at ${state.generation}, expected ${options.expectedGeneration}`
      );
    }
    if (state.activeRunId !== options.runId) {
      throw new Error(
        `STUDENT_IDENTITY_RUN_MISMATCH: window holds ${state.activeRunId ?? 'no run'}, not ${options.runId}`
      );
    }
    if (state.migrationActorId !== options.actorId) {
      throw new Error('STUDENT_IDENTITY_ACTOR_MISMATCH: a different actor owns the window');
    }

    // Measured once and written once. The exit gate re-reads this rather than
    // re-measuring, so a second measurement taken minutes later must not be
    // able to replace it — `recordStudentIdentityDrainEvidence` refuses.
    const queueCounts = await countPendingQueues(db);
    const leases = await countLeases(db, runtime.now());
    const evidence = {
      runId: options.runId as string,
      observedAt: runtime.now().toISOString(),
      recordedBy: options.actorId as string,
      queueCounts,
      activeLeases: leases.active,
      staleLeases: leases.stale,
      planDigest: options.planDigest ?? '',
      approvalDigest: options.approvalDigest ?? '',
    };
    await recordStudentIdentityDrainEvidence(db, evidence);

    await writeJsonArtifactThroughRuntime(
      options.outputPath as string,
      { generation: state.generation, evidence },
      runtime
    );
    say(runtime, `drain evidence recorded for ${options.runId}`);
    return 0;
  }

  const state = await transitionStudentIdentityMaintenance(
    db,
    transitionFor(options),
    runtime.now()
  );
  if (options.outputPath) {
    await writeJsonArtifactThroughRuntime(options.outputPath, state, runtime);
  }
  say(runtime, `maintenance mode=${state.mode} generation=${state.generation}`);
  return 0;
}

runStudentIdentityCliIfDirect(import.meta.url, () =>
  executeStudentIdentityCli({
    argv: process.argv.slice(2),
    usage: 'Usage: set-student-identity-maintenance [options]\nOptions:\n  --enter\n  --verify-drain\n  --exit\n  --run-id\n  --plan-digest\n  --approval-digest\n  --source-commit\n  --export-operation-id\n  --actor-id\n  --confirm-project-id\n  --confirm-database-id\n  --reason\n  --health-audit-id\n  --health-digest\n  --smoke-evidence-id\n  --output',
    parse: parseSetStudentIdentityMaintenanceArgs,
    run: setStudentIdentityMaintenanceCommand,
    runtime: createDefaultStudentIdentityCliRuntime(),
  })
);
