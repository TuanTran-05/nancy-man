import {
  executeStudentIdentityCli,
  createDefaultStudentIdentityCliRuntime,
  runStudentIdentityCliIfDirect,
  assertConfirmedTarget,
  type StudentIdentityCliRuntime,
} from './student-identity-cli/runtime.js';
import {
  readJsonArtifact,
  writeJsonArtifactThroughRuntime,
} from './student-identity-cli/artifacts.js';
import {
  applyLegacyStudentRetirementOperation,
  operationId,
} from './student-profile-retirement/writer.js';
import { planLegacyStudentRetirement } from './student-profile-retirement/planner.js';
import {
  assertLegacyStudentRetirementApproved,
  buildLegacyStudentRetirementReport,
  digestLegacyStudentRetirementPlan,
} from './student-profile-retirement/reporter.js';
import { assertRollbackReversible } from './student-profile-retirement/rollback.js';
import { readCanonicalStudentReadControl } from '../server/api/lib/student/canonicalStudentReadControl.js';
import { readStudentIdentityMaintenanceInTransaction } from '../server/api/lib/maintenance/studentIdentityMaintenance.js';
import { readConsecutiveGreenStudentIdentityAudits } from '../server/api/lib/student/studentIdentityHealthRepository.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  RETIREMENT_PRESERVED_COLLECTIONS,
  type LegacyStudentRetirementPlan,
} from './student-profile-retirement/types.js';
import { inventoryStudentReferences } from './student-profile-normalization/inventory.js';
import { runStudentIdentityArchitectureCheck } from './check-student-identity-architecture.js';
import type {
  LegacyStudentRetirementOperation,
  LegacyStudentRetirementReviewedFile,
} from './student-profile-retirement/types.js';

export type RetireLegacyStudentProfilesMode =
  | 'audit-preliminary'
  | 'audit-final'
  /** Deprecated spelling of `audit-final`, kept so existing muscle memory still lands. */
  | 'plan'
  | 'approve'
  | 'apply'
  | 'verify'
  | 'rollback-plan'
  | 'rollback-approve'
  | 'rollback-apply'
  | 'rollback-verify';

export type RetireLegacyStudentProfilesOptions = {
  mode: RetireLegacyStudentProfilesMode;
  runId?: string;
  actorId?: string;
  approvalRole?: string;
  reviewerId?: string;
  planPath?: string;
  outputPath?: string;
  sourceCommit?: string;
  exportOperationId?: string;
  confirmPlanDigest?: string;
  confirmApprovalDigest?: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
};

export class RetireLegacyStudentProfilesUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetireLegacyStudentProfilesUsageError';
  }
}

const MODE_FLAGS: Record<string, RetireLegacyStudentProfilesMode> = {
  '--audit-preliminary': 'audit-preliminary',
  '--audit-final': 'audit-final',
  '--plan': 'plan',
  '--approve': 'approve',
  '--apply': 'apply',
  '--verify': 'verify',
  '--rollback-plan': 'rollback-plan',
  '--rollback-approve': 'rollback-approve',
  '--rollback-apply': 'rollback-apply',
  '--rollback-verify': 'rollback-verify',
};

const VALUE_FLAGS = new Set([
  '--run-id',
  '--actor-id',
  '--approval-role',
  '--reviewer-id',
  '--plan',
  '--output',
  '--source-commit',
  '--export-operation-id',
  '--confirm-plan-digest',
  '--confirm-approval-digest',
  '--confirm-project-id',
  '--confirm-database-id',
]);

export function parseRetireLegacyStudentProfilesArgs(
  argv: readonly string[]
): RetireLegacyStudentProfilesOptions {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  const modes: RetireLegacyStudentProfilesMode[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new RetireLegacyStudentProfilesUsageError(`Unexpected argument: ${token}`);
    }
    if (seen.has(token)) {
      throw new RetireLegacyStudentProfilesUsageError(`Repeated flag: ${token}`);
    }
    seen.add(token);

    if (MODE_FLAGS[token]) {
      if (token === '--plan' && modes.length > 0) {
        // Fall through to VALUE_FLAGS handling
      } else {
        modes.push(MODE_FLAGS[token]);
        continue;
      }
    }
    if (token === '--force') {
      throw new RetireLegacyStudentProfilesUsageError(
        '--force does not exist; every refusal here is one somebody should read'
      );
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new RetireLegacyStudentProfilesUsageError(`Unknown flag: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new RetireLegacyStudentProfilesUsageError(`Missing value for ${token}`);
    }
    values.set(token, value);
    index += 1;
  }

  if (modes.length !== 1) {
    throw new RetireLegacyStudentProfilesUsageError(
      modes.length === 0
        ? `One of ${Object.keys(MODE_FLAGS).join(', ')} is required`
        : `Exactly one mode is allowed; received ${modes.join(', ')}`
    );
  }

  const mode = modes[0];
  const options: RetireLegacyStudentProfilesOptions = {
    mode,
    runId: values.get('--run-id'),
    actorId: values.get('--actor-id'),
    approvalRole: values.get('--approval-role'),
    reviewerId: values.get('--reviewer-id'),
    planPath: values.get('--plan'),
    outputPath: values.get('--output'),
    sourceCommit: values.get('--source-commit'),
    exportOperationId: values.get('--export-operation-id'),
    confirmPlanDigest: values.get('--confirm-plan-digest'),
    confirmApprovalDigest: values.get('--confirm-approval-digest'),
    confirmProjectId: values.get('--confirm-project-id'),
    confirmDatabaseId: values.get('--confirm-database-id'),
  };

  // The final audit is the artifact approval binds to, so it may not be
  // produced without the export and commit that bind it. The preliminary audit
  // deliberately runs before the export exists — that separation is the whole
  // reason there are two phases rather than one.
  if (mode === 'audit-final' || mode === 'plan') {
    const missing = ['--source-commit', '--export-operation-id'].filter(
      (flag) => !values.get(flag)
    );
    if (missing.length > 0) {
      throw new RetireLegacyStudentProfilesUsageError(
        `${mode === 'plan' ? '--plan' : '--audit-final'} requires ${missing.join(', ')}`
      );
    }
  }

  return options;
}

const USAGE = `Usage:
  npx tsx scripts/retire-legacy-student-profiles.ts --audit-preliminary ...
  npx tsx scripts/retire-legacy-student-profiles.ts --audit-final ...
  npx tsx scripts/retire-legacy-student-profiles.ts --plan ...
  npx tsx scripts/retire-legacy-student-profiles.ts --approve ...
  npx tsx scripts/retire-legacy-student-profiles.ts --apply ...
  npx tsx scripts/retire-legacy-student-profiles.ts --verify ...
`;

/**
 * The reviewed file as it reaches the writer.
 *
 * `operations` is what the run will attempt; `operationIds` is what the
 * reviewers approved. They are stored separately on purpose — the writer
 * compares them, so a file that grew an extra operation after review is
 * refused rather than trusted.
 */
type ReviewedRetirementFile = LegacyStudentRetirementReviewedFile & {
  operations?: readonly LegacyStudentRetirementOperation[];
};

export async function retireLegacyStudentProfilesCommand(
  options: RetireLegacyStudentProfilesOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const opened = await runtime.openDocumentStore();
  if (options.confirmProjectId || options.confirmDatabaseId) {
    assertConfirmedTarget(opened.target, {
      projectId: options.confirmProjectId,
      databaseId: options.confirmDatabaseId,
    });
  }

  // Every rollback mode stops at the boundary before it reads anything else.
  // Past it the credentials and tombstones a restore would need are gone, and
  // the honest answer is forward repair under a new reviewed run.
  if (
    options.mode === 'rollback-plan' ||
    options.mode === 'rollback-approve' ||
    options.mode === 'rollback-apply' ||
    options.mode === 'rollback-verify'
  ) {
    await assertRollbackReversible(opened.db, options.runId as string);
    // Before the boundary, the run is still reversible — but not by this tool.
    // Retirement has no automated rollback: the field removals could be
    // restored from before-images, the tombstone and credential deletions
    // could not, and a half-reversing rollback is worse than none. Whoever
    // types this is in an incident, so the refusal names what will actually
    // work instead of reading as a feature that is merely missing today.
    throw new Error(
      'STUDENT_RETIREMENT_ROLLBACK_NOT_AUTOMATED: retirement has no automated rollback. ' +
        'While maintenance is read-only and no deletion has begun, recover by restoring the ' +
        'managed export this run is bound to. Once any tombstone or credential is deleted, ' +
        'the only path is forward repair under a new reviewed run.'
    );
  }

  if (options.mode === 'audit-preliminary') {
    return planRetirement(options, runtime, opened.db, opened.target, 'preliminary');
  }
  if (options.mode === 'audit-final' || options.mode === 'plan') {
    return planRetirement(options, runtime, opened.db, opened.target, 'final');
  }
  if (options.mode === 'approve') {
    return approveRetirement(options, runtime);
  }
  if (options.mode === 'verify') {
    return verifyRetirement(options, runtime, opened.db);
  }
  if (options.mode !== 'apply') {
    // Unreachable: the rollback modes refuse above and every other mode is
    // dispatched. The rollback branch is spelled as an explicit union rather
    // than a `startsWith` so this narrowing is real — with a cast here the
    // compiler proves nothing and the comment above it would be a claim
    // nobody checks.
    const unreachable: never = options.mode;
    throw new Error(`STUDENT_RETIREMENT_MODE_UNKNOWN: ${String(unreachable)}`);
  }

  const reviewed = await readJsonArtifact<ReviewedRetirementFile>(
    options.planPath as string,
    runtime
  );

  // Restatement, not decoration: the operator has to type the digests they
  // reviewed, and a file that does not match them is the wrong file.
  if (reviewed.planDigest !== options.confirmPlanDigest) {
    throw new Error(
      `STUDENT_RETIREMENT_PLAN_DIGEST_MISMATCH: file holds ${reviewed.planDigest}`
    );
  }
  if (reviewed.approvalDigest !== options.confirmApprovalDigest) {
    throw new Error(
      `STUDENT_RETIREMENT_APPROVAL_DIGEST_MISMATCH: file holds ${reviewed.approvalDigest}`
    );
  }

  const operations = reviewed.operations ?? [];
  const outcomes = [];
  for (const operation of operations) {
    // One transaction each, so an interrupt stops the next operation rather
    // than the next run.
    outcomes.push(
      await applyLegacyStudentRetirementOperation(opened.db, {
        operation,
        runId: options.runId as string,
        actorId: options.actorId as string,
        reviewedPlan: reviewed,
        now: runtime.now(),
      })
    );
  }

  if (options.outputPath) {
    await writeJsonArtifactThroughRuntime(
      options.outputPath,
      {
        mode: options.mode,
        runId: options.runId,
        planDigest: reviewed.planDigest,
        approvalDigest: reviewed.approvalDigest,
        appliedAt: runtime.now().toISOString(),
        outcomes,
      },
      runtime
    );
  }

  const line = `retirement apply: ${outcomes.filter((o) => o.status === 'applied').length} applied of ${operations.length}`;
  if (typeof runtime.stdout === 'function') runtime.stdout(line);
  else runtime.stdout.write(line);
  return 0;
}

function say(runtime: StudentIdentityCliRuntime, line: string): void {
  if (typeof runtime.stdout === 'function') runtime.stdout(line);
  else runtime.stdout.write(line);
}

async function readAll(db: DocumentStore, name: string) {
  const snapshot = await db.collection(name).get();
  return (snapshot.docs || []).map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function vietnamDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

/**
 * References that would still name a deleted id, per legacy profile.
 *
 * Two kinds are excluded and neither is an oversight. The alias, the code
 * reservation, the run, the journal and the audit evidence are what retirement
 * exists to preserve — they are how an old receipt still resolves to the right
 * child years later, and counting them would make every candidate permanently
 * ineligible. The tombstone document itself is excluded because it is the
 * thing being deleted, not a survivor of it.
 *
 * Everything else counts. A reference the registry recognises is still a
 * reference: recognised means "we know what this field is for", not "it is
 * safe to orphan it".
 */
function countSurvivingReferences(
  inventory: { known: Array<{ documentPath: string; matchedProfileIds: string[] }> },
  retiringIds: readonly string[]
): Map<string, number> {
  const preserved = new Set<string>(RETIREMENT_PRESERVED_COLLECTIONS);
  const deletedByThisRun = new Set(retiringIds.map((id) => `students/${id}`));
  const counts = new Map<string, number>();

  for (const match of inventory.known) {
    const collection = match.documentPath.split('/')[0];
    if (preserved.has(collection)) continue;
    if (deletedByThisRun.has(match.documentPath)) continue;

    for (const profileId of match.matchedProfileIds) {
      counts.set(profileId, (counts.get(profileId) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * Builds the plan from the center as it is right now.
 *
 * Everything the planner refuses on - the green streak, the read mode, who
 * holds the window - is read here rather than passed in, so a plan cannot be
 * generated against a description of the center that somebody typed.
 */
/**
 * Which architecture violations mean "a query still reads a field this run
 * deletes".
 *
 * Only the two class-projection reads qualify. Presentation dedupe and legacy
 * writes are post-retirement debt, but they do not stop resolving when the
 * field disappears, and treating them as retirement blockers would make the
 * window unreachable for reasons that have nothing to do with it.
 *
 * `users.classId` is the dangerous member: its readers return an empty set
 * rather than an error, so a missed conversion is silent.
 */
/**
 * The scan, computed once per process.
 *
 * A whole-repository AST pass takes a second and a half and answers the same
 * question every time: the source tree cannot change while one CLI process
 * runs. Re-scanning per plan made an audit pay for it repeatedly, and in the
 * test suite it put a single case within reach of the timeout.
 */
let cachedUnconvertedReaders: string[] | null = null;

function scanUnconvertedLegacyFieldReaders(): string[] {
  if (cachedUnconvertedReaders === null) {
    cachedUnconvertedReaders = collectUnconvertedLegacyFieldReaders(
      runStudentIdentityArchitectureCheck(['--policy', 'post-retirement']).violations
    );
  }
  return cachedUnconvertedReaders;
}

export function collectUnconvertedLegacyFieldReaders(
  violations: readonly { code: string; path: string; line: number }[]
): string[] {
  return violations
    .filter(
      (violation) =>
        violation.code === 'AUTHORITATIVE_PROFILE_CLASS_QUERY' ||
        violation.code === 'AUTHORITATIVE_LINKED_USER_CLASS_QUERY'
    )
    .map((violation) => `${violation.path}:${violation.line}`);
}

/**
 * The two audit phases, as they appear in the artifact.
 *
 * A preliminary plan is a reading of the database, produced before the export
 * exists so reviewers have something to argue with. A final plan is the one an
 * approval can bind to. Carrying the distinction in the file — and in its
 * digest — is what stops the second command in the chain from quietly
 * promoting the first one's output.
 */
type RetirementAuditPhase = 'preliminary' | 'final';

type RetirementPlanArtifact = LegacyStudentRetirementPlan & {
  auditPhase: RetirementAuditPhase;
  applyable: boolean;
};

async function planRetirement(
  options: RetireLegacyStudentProfilesOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore,
  target: { projectId: string; databaseId: string },
  auditPhase: RetirementAuditPhase
): Promise<number> {
  const now = runtime.now();
  const [students, aliases, credentials, linkedUsers, journal] = await Promise.all([
    readAll(db, 'students'),
    readAll(db, 'student_profile_aliases'),
    readAll(db, 'student_auth_credentials'),
    readAll(db, 'users'),
    readAll(db, 'student_profile_merge_journal'),
  ]);

  const control = await readCanonicalStudentReadControl(db);
  const maintenance = await db.runTransaction((tx) =>
    readStudentIdentityMaintenanceInTransaction(tx as never, db)
  );
  const streak = await readConsecutiveGreenStudentIdentityAudits({
    db,
    endingVietnamDate: vietnamDate(now),
    requiredDays: 7,
  });

  const statusOf = (doc: { data: Record<string, unknown> }) =>
    String(doc.data.status ?? '').trim();

  // Which ids this run would delete. The inventory is asked about exactly
  // those, because a reference is only dangerous if it names something about
  // to stop existing.
  const retiringIds = [
    ...students
      .filter((doc) => String(doc.data.studentProfileState ?? '') === 'merged_tombstone')
      .map((doc) => doc.id),
    ...aliases.map((doc) => doc.id),
  ];
  const uniqueRetiringIds = [...new Set(retiringIds)].sort();

  const inventory = await inventoryStudentReferences({
    db,
    candidateProfileIds: uniqueRetiringIds,
  });

  const remainingReferences = countSurvivingReferences(inventory, uniqueRetiringIds);

  const plan = planLegacyStudentRetirement({
    runId: options.runId as string,
    generatedAt: now.toISOString(),
    target,
    sourceCommitSha: options.sourceCommit ?? '',
    exportOperationId: options.exportOperationId ?? '',
    latestHealthAuditId: streak.auditIds.at(-1) ?? '',
    dailyGreenAuditIds: streak.auditIds,
    dailyAuditMissingDates: streak.missingDates,
    students,
    aliases,
    credentials,
    linkedUsers,
    remainingReferences,
    unknownReferenceCount: inventory.unknown.length,
    journalPendingCount: journal.filter((doc) => statusOf(doc) === 'planned').length,
    journalFailedCount: journal.filter((doc) => statusOf(doc) === 'failed').length,
    openRollbackInvestigations: 0,
    maintenanceMode: maintenance.mode,
    maintenanceRunId: maintenance.activeRunId,
    maintenanceActorId: maintenance.migrationActorId,
    actorId: options.actorId as string,
    canonicalReadMode: control.mode,
    // Measured, not assumed. An empty literal here is an assertion that
    // nothing reads the fields this run removes, made without looking — and
    // the reader it would miss is the one that fails silently.
    unconvertedLegacyFieldReaders: scanUnconvertedLegacyFieldReaders(),
    now,
  });

  // A preliminary artifact is never applyable, whatever the database says. The
  // export it would have to bind to does not exist yet, so "no blockers" here
  // is an observation, not a permission.
  const artifact: RetirementPlanArtifact = {
    ...plan,
    auditPhase,
    applyable: auditPhase === 'final' && plan.blockers.length === 0,
  };

  // Digested with those two fields in it, so an approval cannot be lifted off
  // a preliminary plan and presented against a final one.
  const report = buildLegacyStudentRetirementReport(artifact);
  await writeJsonArtifactThroughRuntime(
    options.outputPath as string,
    { ...artifact, planDigest: report.digest },
    runtime
  );
  say(
    runtime,
    `retirement ${auditPhase} plan: ${plan.operations.length} operation(s), ` +
      `${plan.blockers.length} blocker(s)`
  );
  return plan.blockers.length === 0 ? 0 : 1;
}

/**
 * One reviewer, one signature, one file.
 *
 * Approval accumulates across invocations so no single command produces a
 * fully approved plan; the writer will not act until the roles the reviewed
 * file names are distinct and cover what the plan does.
 */
async function approveRetirement(
  options: RetireLegacyStudentProfilesOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const stored = await readJsonArtifact<
    Partial<RetirementPlanArtifact> &
      LegacyStudentRetirementPlan & { planDigest?: string; approvals?: Record<string, string> }
  >(options.planPath as string, runtime);

  // Checked before the digest, because the answer does not depend on which
  // digest the operator remembered: a preliminary artifact is the wrong kind
  // of file for this command no matter how faithfully it was transcribed.
  if (stored.applyable !== true) {
    throw new Error(
      `STUDENT_RETIREMENT_PLAN_NOT_APPLYABLE: ${
        stored.auditPhase ?? 'unknown'
      } audit output cannot be approved; run --audit-final against a completed export`
    );
  }

  const { planDigest: _ignored, approvals: existingApprovals, ...plan } = stored;
  const planDigest = digestLegacyStudentRetirementPlan(plan as never);
  if (planDigest !== options.confirmPlanDigest) {
    throw new Error(`STUDENT_RETIREMENT_PLAN_DIGEST_MISMATCH: plan digests to ${planDigest}`);
  }

  const approvals = {
    ...(existingApprovals ?? {}),
    [options.approvalRole as string]: options.reviewerId as string,
  };
  const reviewed = {
    ...plan,
    planDigest,
    approvalDigest: digestLegacyStudentRetirementPlan({ ...plan, approvals } as never),
    auditPhase: 'final',
    approvals,
    // Named one by one, so a plan that grows an operation after review is
    // refused by the writer rather than inheriting this approval.
    operationIds: (plan.operations ?? []).map((operation) => operationId(operation)),
  };

  // A partial approval still writes the file; it just does not claim to be
  // complete. The writer is what refuses to act on an incomplete one.
  let complete = true;
  try {
    assertLegacyStudentRetirementApproved(plan as never, reviewed as never);
  } catch {
    complete = false;
  }

  await writeJsonArtifactThroughRuntime(options.outputPath as string, reviewed, runtime);
  say(
    runtime,
    `retirement approval by ${options.approvalRole}: ${complete ? 'complete' : 'awaiting further roles'}`
  );
  return 0;
}

/**
 * The record the release gate reads before it will lift the window.
 *
 * Written create-only: a verification that could be rewritten later is not
 * evidence that anything was verified.
 */
async function verifyRetirement(
  options: RetireLegacyStudentProfilesOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore
): Promise<number> {
  const reviewed = await readJsonArtifact<ReviewedRetirementFile>(
    options.planPath as string,
    runtime
  );
  if (reviewed.planDigest !== options.confirmPlanDigest) {
    throw new Error(`STUDENT_RETIREMENT_PLAN_DIGEST_MISMATCH: file holds ${reviewed.planDigest}`);
  }
  if (reviewed.approvalDigest !== options.confirmApprovalDigest) {
    throw new Error(
      `STUDENT_RETIREMENT_APPROVAL_DIGEST_MISMATCH: file holds ${reviewed.approvalDigest}`
    );
  }

  const journal = await readAll(db, 'student_profile_merge_journal');
  const applied = new Set(
    journal
      .filter((doc) => String(doc.data.runId ?? '') === options.runId)
      .map((doc) => String(doc.data.operationId ?? ''))
  );
  const outstanding = (reviewed.operationIds ?? []).filter((id) => !applied.has(id));
  if (outstanding.length > 0) {
    throw new Error(
      `STUDENT_RETIREMENT_OPERATIONS_OUTSTANDING: ${outstanding.length} reviewed operation(s) have no journal entry`
    );
  }

  const verification = {
    runId: options.runId,
    status: 'verified' as const,
    planDigest: reviewed.planDigest,
    approvalDigest: reviewed.approvalDigest,
    verifiedOperationCount: (reviewed.operationIds ?? []).length,
    verifiedAt: runtime.now().toISOString(),
    verifiedBy: options.actorId ?? '',
  };

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`student_profile_retirement_verifications/${options.runId}`);
    const snapshot = (await tx.get(ref as never)) as unknown as { exists: boolean };
    if (snapshot.exists) {
      throw new Error(
        `STUDENT_RETIREMENT_VERIFICATION_IMMUTABLE: ${options.runId} is already verified`
      );
    }
    tx.set(ref as never, verification as never);
  });

  if (options.outputPath) {
    await writeJsonArtifactThroughRuntime(options.outputPath, verification, runtime);
  }
  say(runtime, `retirement verified: ${verification.verifiedOperationCount} operation(s)`);
  return 0;
}

export async function main(): Promise<number> {
  return executeStudentIdentityCli({
    argv: process.argv.slice(2),
    usage: USAGE,
    parse: parseRetireLegacyStudentProfilesArgs,
    runtime: createDefaultStudentIdentityCliRuntime(),
    run: retireLegacyStudentProfilesCommand,
  });
}

runStudentIdentityCliIfDirect(import.meta.url, main);
