/**
 * Read-only by default; every write path restates its target.
 *
 * This CLI is the one an operator reaches for at 2am, so its defaults are
 * chosen for that moment. It reports and writes nothing unless told to. It
 * refuses to invent an output path, because a report silently written
 * somewhere is a report nobody reads. And `--write` requires the project and
 * database to be restated on the command line, because "I ran the right script
 * in the wrong terminal" is the failure this whole program exists to prevent.
 *
 * Parsing lives here on its own so it can be tested exhaustively without a
 * database, and follows the same three rules as the normalization CLI: an
 * unknown flag is an error, a misplaced flag is an error, and a repeated flag
 * is an error rather than last-one-wins — a scrolled shell history carries
 * stale values ahead of intended ones more often than anyone expects.
 */

import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  executeStudentIdentityCli,
  runStudentIdentityCliIfDirect,
  createDefaultStudentIdentityCliRuntime,
  assertConfirmedTarget,
  type StudentIdentityCliRuntime,
} from './student-identity-cli/runtime.js';
import { writeJsonArtifactThroughRuntime } from './student-identity-cli/artifacts.js';
import { writeStudentIdentityHealthReport } from '../server/api/lib/student/studentIdentityHealthRepository.js';
import { recordStudentIdentityDrainEvidence } from '../server/api/lib/maintenance/studentIdentityCutoverGate.js';
import { collectStudentIdentityHealth } from '../server/api/lib/student/studentIdentityHealthService.js';
import type { StudentIdentityHealthMode } from '../server/api/lib/student/studentIdentityHealthTypes.js';

export type CheckStudentIdentityHealthOptions = {
  mode: StudentIdentityHealthMode;
  outputPath?: string;
  write: boolean;
  assertGreen: boolean;
  runId?: string;
  planDigest?: string;
  approvalDigest?: string;
  exportOperationId?: string;
  sourceCommit?: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
};

export class CheckStudentIdentityHealthUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckStudentIdentityHealthUsageError';
  }
}

const VALUE_FLAGS = new Set([
  '--mode',
  '--output',
  '--run-id',
  '--plan-digest',
  '--approval-digest',
  '--export-operation-id',
  '--source-commit',
  '--confirm-project-id',
  '--confirm-database-id',
]);

const BOOLEAN_FLAGS = new Set(['--write', '--assert-green']);

const MODES: readonly StudentIdentityHealthMode[] = ['daily', 'cutover', 'retirement'];

export function parseCheckStudentIdentityHealthArgs(
  argv: readonly string[]
): CheckStudentIdentityHealthOptions {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  let write = false;
  let assertGreen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new CheckStudentIdentityHealthUsageError(`Unexpected argument: ${token}`);
    }
    if (seen.has(token)) {
      // Last-one-wins would let a stale value scrolled up from shell history
      // quietly take precedence over the one just typed.
      throw new CheckStudentIdentityHealthUsageError(`Repeated flag: ${token}`);
    }
    seen.add(token);

    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--write') write = true;
      if (token === '--assert-green') assertGreen = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new CheckStudentIdentityHealthUsageError(`Unknown flag: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CheckStudentIdentityHealthUsageError(`Missing value for ${token}`);
    }
    values.set(token, value);
    index += 1;
  }

  const mode = (values.get('--mode') ?? 'daily') as StudentIdentityHealthMode;
  if (!MODES.includes(mode)) {
    throw new CheckStudentIdentityHealthUsageError(
      `Invalid --mode: ${mode} (expected ${MODES.join(', ')})`
    );
  }

  const outputPath = values.get('--output');
  if (!write && !outputPath) {
    // Never invent a path. A report written somewhere the operator did not
    // name is a report nobody reads, and its absence is mistaken for success.
    throw new CheckStudentIdentityHealthUsageError(
      '--output FILE is required for a read-only report; this command never chooses a path for you'
    );
  }

  if (write) {
    const projectId = values.get('--confirm-project-id');
    const databaseId = values.get('--confirm-database-id');
    if (!projectId || !databaseId) {
      throw new CheckStudentIdentityHealthUsageError(
        '--write requires --confirm-project-id and --confirm-database-id'
      );
    }
  }

  if (mode === 'cutover') {
    for (const [flag, key] of [
      ['--run-id', 'runId'],
      ['--plan-digest', 'planDigest'],
      ['--approval-digest', 'approvalDigest'],
      ['--export-operation-id', 'exportOperationId'],
    ] as const) {
      if (!values.get(flag)) {
        throw new CheckStudentIdentityHealthUsageError(
          `--mode cutover requires ${flag} (missing ${key})`
        );
      }
    }
  }

  return {
    mode,
    outputPath,
    write,
    assertGreen,
    runId: values.get('--run-id'),
    planDigest: values.get('--plan-digest'),
    approvalDigest: values.get('--approval-digest'),
    exportOperationId: values.get('--export-operation-id'),
    sourceCommit: values.get('--source-commit'),
    confirmProjectId: values.get('--confirm-project-id'),
    confirmDatabaseId: values.get('--confirm-database-id'),
  };
}

/**
 * The exit code an operator's shell sees.
 *
 * `--assert-green` is what turns this into a gate: without it a red report is
 * still a successful *run*, which is the right default for a scheduled audit
 * that should keep collecting evidence rather than failing a cron job.
 */
export function exitCodeForHealth(
  status: 'green' | 'red',
  options: Pick<CheckStudentIdentityHealthOptions, 'assertGreen'>
): number {
  if (!options.assertGreen) return 0;
  return status === 'green' ? 0 : 1;
}

export const CHECK_STUDENT_IDENTITY_HEALTH_USAGE = `
Usage: npx tsx scripts/check-student-identity-health.ts [options]

Options:
  --mode <mode>                  daily, cutover, retirement (default: daily)
  --output <path>                Path to write the report
  --write                        Write the report to DocumentStore
  --assert-green                 Exit 1 if health is red
  --run-id <id>                  Run ID
  --plan-digest <digest>         Plan digest
  --approval-digest <digest>     Approval digest
  --export-operation-id <id>     Export operation ID
  --source-commit <sha>          Source commit SHA
  --confirm-project-id <id>      Project ID for write
  --confirm-database-id <id>     Database ID for write
`;

/**
 * The command an operator actually runs.
 *
 * It opens its own connection so the target is confirmed before anything is
 * read, and reports the database it truly reached rather than the one the
 * flags asked for.
 */
export async function checkStudentIdentityHealthCommand(
  options: CheckStudentIdentityHealthOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const opened = await runtime.openDocumentStore();
  if (options.confirmProjectId || options.confirmDatabaseId) {
    assertConfirmedTarget(opened.target, {
      projectId: options.confirmProjectId,
      databaseId: options.confirmDatabaseId,
    });
  }
  return runCheckStudentIdentityHealth(options, runtime, opened.db, opened.target);
}

export async function runCheckStudentIdentityHealth(
  options: CheckStudentIdentityHealthOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore,
  target: { projectId: string; databaseId: string }
): Promise<number> {
  const report = await collectStudentIdentityHealth({
    db: db as never,
    // The target is where the data came from, not where the operator meant to
    // point. A report labelled with the intent would survive a wrong-terminal
    // run looking correct.
    projectId: target.projectId,
    databaseId: target.databaseId,
    mode: options.mode,
    sourceCommitSha: options.sourceCommit ?? '',
    now: runtime.now(),
    runId: options.runId,
    planDigest: options.planDigest,
    approvalDigest: options.approvalDigest,
    exportOperationId: options.exportOperationId,
  });

  if (options.outputPath) {
    await writeJsonArtifactThroughRuntime(options.outputPath, report, runtime);
  }

  if (options.write) {
    // Through the repository, never straight to the collection: the
    // repository is what refuses to rewrite a stored day.
    const outcome = await writeStudentIdentityHealthReport(db, report);
    if (outcome.runOutcome === 'conflict') {
      throw new Error(
        `STUDENT_IDENTITY_HEALTH_EVIDENCE_IMMUTABLE: ${report.auditId} already holds different evidence`
      );
    }
    if (options.runId) {
      await recordStudentIdentityDrainEvidence(db, {
        runId: options.runId,
        observedAt: report.checkedAt,
        recordedBy: runtime.env.USER || 'operator',
        queueCounts: report.pendingJobs,
        activeLeases: report.counts.activeMutationLeases,
        staleLeases: report.counts.staleMutationLeases,
        planDigest: options.planDigest ?? '',
        approvalDigest: options.approvalDigest ?? '',
      });
    }
  }

  if (runtime.stdout instanceof Function) {
    runtime.stdout(`student identity health: ${report.status} (${report.auditId})`);
  } else {
    runtime.stdout.write(`student identity health: ${report.status} (${report.auditId})`);
  }

  return exitCodeForHealth(report.status, options);
}

runStudentIdentityCliIfDirect(import.meta.url, () =>
  executeStudentIdentityCli({
    argv: process.argv.slice(2),
    usage: CHECK_STUDENT_IDENTITY_HEALTH_USAGE,
    parse: parseCheckStudentIdentityHealthArgs,
    run: checkStudentIdentityHealthCommand,
    runtime: createDefaultStudentIdentityCliRuntime(),
  })
);
