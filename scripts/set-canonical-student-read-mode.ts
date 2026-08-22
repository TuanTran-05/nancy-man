/**
 * The read-mode command line.
 *
 * CLI values are kebab and persisted values are snake, kept apart on purpose:
 * the persisted string is compared by the cutover gate and by every read
 * handler, so it must not change because somebody preferred a different flag
 * spelling.
 *
 * `--from` is not decoration. It is the compare-and-set: an operator who
 * believes the center is on `canonical_preferred` and is wrong should have
 * their command refused rather than silently applied to a different starting
 * point.
 */

import type { CanonicalStudentReadMode } from '../shared/canonicalStudentReadModel.js';
import {
  executeStudentIdentityCli,
  runStudentIdentityCliIfDirect,
  createDefaultStudentIdentityCliRuntime,
  assertConfirmedTarget,
  type StudentIdentityCliRuntime,
} from './student-identity-cli/runtime.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { writeJsonArtifactThroughRuntime } from './student-identity-cli/artifacts.js';
import {
  readCanonicalStudentReadControl,
  transitionCanonicalStudentReadMode,
  type CanonicalRequiredModeReadiness,
} from '../server/api/lib/student/canonicalStudentReadControl.js';

export type CanonicalStudentReadModeCliValue =
  | 'legacy-compare'
  | 'canonical-preferred'
  | 'canonical-required';

export const READ_MODE_CLI_TO_PERSISTED: Record<
  CanonicalStudentReadModeCliValue,
  CanonicalStudentReadMode
> = {
  'legacy-compare': 'legacy_compare',
  'canonical-preferred': 'canonical_preferred',
  'canonical-required': 'canonical_required',
};

export type SetCanonicalStudentReadModeOptions = {
  mode: 'show' | 'transition';
  from?: CanonicalStudentReadMode;
  to?: CanonicalStudentReadMode;
  expectedGeneration?: number;
  runId?: string;
  actorId?: string;
  planDigest?: string;
  approvalDigest?: string;
  /**
   * The stored health run this activation stands on.
   *
   * canonical_required is the point after which every read must resolve
   * canonically, so the counts that gate it come from an immutable audit
   * rather than from numbers typed on the command line.
   */
  healthAuditId?: string;
  outputPath?: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
};

export class SetCanonicalStudentReadModeUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetCanonicalStudentReadModeUsageError';
  }
}

const VALUE_FLAGS = new Set([
  '--from',
  '--to',
  '--health-audit-id',
  '--expected-generation',
  '--run-id',
  '--actor-id',
  '--plan-digest',
  '--approval-digest',
  '--output',
  '--confirm-project-id',
  '--confirm-database-id',
]);

function toPersisted(value: string, flag: string): CanonicalStudentReadMode {
  const persisted = READ_MODE_CLI_TO_PERSISTED[value as CanonicalStudentReadModeCliValue];
  if (!persisted) {
    throw new SetCanonicalStudentReadModeUsageError(
      `Invalid ${flag}: ${value} (expected ${Object.keys(READ_MODE_CLI_TO_PERSISTED).join(', ')})`
    );
  }
  return persisted;
}

export function parseSetCanonicalStudentReadModeArgs(
  argv: readonly string[]
): SetCanonicalStudentReadModeOptions {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  let show = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new SetCanonicalStudentReadModeUsageError(`Unexpected argument: ${token}`);
    }
    if (seen.has(token)) {
      throw new SetCanonicalStudentReadModeUsageError(`Repeated flag: ${token}`);
    }
    seen.add(token);

    if (token === '--show') {
      show = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new SetCanonicalStudentReadModeUsageError(`Unknown flag: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new SetCanonicalStudentReadModeUsageError(`Missing value for ${token}`);
    }
    values.set(token, value);
    index += 1;
  }

  if (show) {
    if (!values.get('--output')) {
      throw new SetCanonicalStudentReadModeUsageError(
        '--show requires --output FILE; this command never chooses a path for you'
      );
    }
    // Confirmation is optional for a read but never discarded: an operator
    // who restated the target expects it checked, and dropping it here would
    // make a wrong-terminal read look like the right one.
    return {
      mode: 'show',
      outputPath: values.get('--output'),
      confirmProjectId: values.get('--confirm-project-id'),
      confirmDatabaseId: values.get('--confirm-database-id'),
    };
  }

  const missing = [
    '--from',
    '--to',
    '--expected-generation',
    '--run-id',
    '--actor-id',
    '--plan-digest',
    '--approval-digest',
    '--confirm-project-id',
    '--confirm-database-id',
  ].filter((flag) => !values.get(flag));
  if (missing.length > 0) {
    throw new SetCanonicalStudentReadModeUsageError(`A transition requires ${missing.join(', ')}`);
  }

  const expectedGeneration = Number(values.get('--expected-generation'));
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
    throw new SetCanonicalStudentReadModeUsageError(
      `Invalid --expected-generation: ${values.get('--expected-generation')}`
    );
  }

  const from = toPersisted(values.get('--from')!, '--from');
  const to = toPersisted(values.get('--to')!, '--to');
  if (from === to) {
    throw new SetCanonicalStudentReadModeUsageError(
      `--from and --to are both ${values.get('--from')}; nothing to transition`
    );
  }

  return {
    mode: 'transition',
    from,
    to,
    expectedGeneration,
    runId: values.get('--run-id'),
    actorId: values.get('--actor-id'),
    planDigest: values.get('--plan-digest'),
    approvalDigest: values.get('--approval-digest'),
    healthAuditId: values.get('--health-audit-id'),
    confirmProjectId: values.get('--confirm-project-id'),
    confirmDatabaseId: values.get('--confirm-database-id'),
  };
}

/**
 * Readiness, read from a stored audit rather than asserted.
 *
 * The four counts the control module gates on all exist in a health report.
 * Deriving them here means the activation is bound to a run somebody can look
 * up afterwards, and a center that has not audited itself cannot argue its way
 * into canonical_required.
 */
async function readinessFromStoredAudit(
  db: DocumentStore,
  healthAuditId: string | undefined,
  now: Date
): Promise<CanonicalRequiredModeReadiness> {
  if (!healthAuditId) {
    throw Object.assign(
      new Error(
        'CANONICAL_READ_READINESS_AUDIT_REQUIRED: --health-audit-id names the audit this activation stands on'
      ),
      { statusCode: 409 }
    );
  }

  const snapshot = (await db
    .doc(`student_identity_health_runs/${healthAuditId}`)
    .get()) as unknown as { exists: boolean; data: () => Record<string, unknown> | undefined };
  if (!snapshot.exists) {
    throw Object.assign(
      new Error(`CANONICAL_READ_READINESS_AUDIT_NOT_FOUND: ${healthAuditId}`),
      { statusCode: 409 }
    );
  }

  const counts = ((snapshot.data() ?? {}).counts ?? {}) as Record<string, unknown>;
  // A count the audit did not record is not a zero. Missing means the report
  // predates the counter, and an activation must not read that as clean.
  const required = (name: string): number => {
    const value = counts[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw Object.assign(
        new Error(`CANONICAL_READ_READINESS_COUNT_MISSING: ${healthAuditId} has no ${name}`),
        { statusCode: 409 }
      );
    }
    return value;
  };

  return {
    requiredModeBlockerCount: required('requiredModeBlockerCount'),
    sameHumanHoldCount: required('confirmedSameHumanUnmergedGroups'),
    unresolvedDifferentCodeCandidateCount: required('unresolvedDifferentCodeCandidates'),
    quarantinedProfileCount: required('quarantinedManualHoldGroups'),
    evaluatedAt: now.toISOString(),
  };
}

function say(runtime: StudentIdentityCliRuntime, line: string): void {
  if (typeof runtime.stdout === 'function') runtime.stdout(line);
  else runtime.stdout.write(line);
}

export async function setCanonicalStudentReadModeCommand(
  options: SetCanonicalStudentReadModeOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const opened = await runtime.openDocumentStore();
  if (options.confirmProjectId || options.confirmDatabaseId) {
    assertConfirmedTarget(opened.target, {
      projectId: options.confirmProjectId,
      databaseId: options.confirmDatabaseId,
    });
  }
  return runSetCanonicalStudentReadMode(options, runtime, opened.db);
}

export async function runSetCanonicalStudentReadMode(
  options: SetCanonicalStudentReadModeOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore
): Promise<number> {
  if (options.mode === 'show') {
    const control = await readCanonicalStudentReadControl(db);
    say(
      runtime,
      `canonical read mode=${control.mode} generation=${control.generation} activatedBy=${control.activatedBy || "-"}`
    );
    if (options.outputPath) {
      await writeJsonArtifactThroughRuntime(options.outputPath, control, runtime);
    }
    return 0;
  }

  // Every rule about which transitions are legal lives in the control module,
  // so the CLI cannot offer a friendlier route to a state the server refuses.
  const record = await transitionCanonicalStudentReadMode(
    db,
    {
      expectedMode: options.from as CanonicalStudentReadMode,
      targetMode: options.to as CanonicalStudentReadMode,
      expectedGeneration: options.expectedGeneration as number,
      runId: options.runId as string,
      actorId: options.actorId as string,
      planDigest: options.planDigest as string,
      approvalDigest: options.approvalDigest as string,
      // Only canonical_required is gated on readiness; the weaker modes are
      // how blockers get discovered in the first place.
      ...(options.to === 'canonical_required'
        ? {
            readiness: await readinessFromStoredAudit(
              db,
              options.healthAuditId,
              runtime.now()
            ),
          }
        : {}),
    },
    runtime.now()
  );

  if (options.outputPath) {
    await writeJsonArtifactThroughRuntime(options.outputPath, record, runtime);
  }
  say(runtime, `canonical read mode=${record.mode} generation=${record.generation}`);
  return 0;
}

runStudentIdentityCliIfDirect(import.meta.url, () =>
  executeStudentIdentityCli({
    argv: process.argv.slice(2),
    usage: 'Usage: set-canonical-student-read-mode [options]\nOptions:\n  --show\n  --from\n  --to\n  --expected-generation\n  --run-id\n  --actor-id\n  --plan-digest\n  --approval-digest\n  --health-audit-id\n  --output\n  --confirm-project-id\n  --confirm-database-id',
    parse: parseSetCanonicalStudentReadModeArgs,
    run: setCanonicalStudentReadModeCommand,
    runtime: createDefaultStudentIdentityCliRuntime(),
  })
);
