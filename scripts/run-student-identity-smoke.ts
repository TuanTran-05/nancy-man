import { createHash } from 'node:crypto';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  executeStudentIdentityCli,
  assertConfirmedTarget,
  runStudentIdentityCliIfDirect,
  type StudentIdentityCliRuntime,
  createDefaultStudentIdentityCliRuntime,
} from './student-identity-cli/runtime.js';
import { writeJsonArtifactAtomic } from './student-identity-cli/artifacts.ts';
import {
  runStudentIdentitySmokeProbes,
  type SmokeFixture,
  type SmokeProbeAdapter,
} from './student-identity-smoke/probes.ts';

export const CUTOVER_SMOKE_SURFACES = [
  'auth',
  'profile',
  'class_roster',
  'attendance',
  'wallet',
  'receipt',
  'invoice',
  'payment',
  'reporting',
  'realtime_recipients',
] as const;

export type CutoverSmokeSurface = (typeof CUTOVER_SMOKE_SURFACES)[number];

export type CutoverSmokeResult = {
  status: 'pass' | 'fail';
  statusCode: number;
  reasonCode: string;
  responseShapeDigest: string;
};

export type StudentIdentitySmokeEvidence = {
  schemaVersion: 2;
  evidenceId: string;
  runId: string;
  target: { projectId: string; databaseId: string };
  planDigest: string;
  approvalDigest: string;
  sourceCommitSha: string;
  exportOperationId: string;
  canonicalReadMode: 'canonical_required';
  projectionHealthId: string;
  operationCounts: { planned: number; applied: number; verified: number; failed: number };
  pendingJobCounts: Record<string, number>;
  startedAt: string;
  executedAt: string;
  runnerVersion: string;
  results: Record<CutoverSmokeSurface, CutoverSmokeResult>;
  mutationGuardProbes: Array<{
    surface: string;
    statusCode: 503;
    reasonCode: 'STUDENT_IDENTITY_MAINTENANCE';
  }>;
  digest: string;
  status: 'green' | 'red';
  blockers: string[];
};

export const SMOKE_EVIDENCE_MAX_AGE_MS = 60 * 60 * 1000;

const SECRET_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /bearer\s+/i,
  /api[-_]?key/i,
];

export function assertNoSmokeSecrets(value: unknown, path = 'evidence'): void {
  if (typeof value === 'string') {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(`STUDENT_IDENTITY_SMOKE_SECRET_FORBIDDEN: ${path}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSmokeSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(key)) {
        throw new Error(`STUDENT_IDENTITY_SMOKE_SECRET_FORBIDDEN: ${path}.${key}`);
      }
    }
    assertNoSmokeSecrets(child, `${path}.${key}`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return Object.fromEntries(entries.map(([key, child]) => [key, canonicalize(child)]));
}

export function digestSmokeEvidence(evidence: Omit<StudentIdentitySmokeEvidence, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(evidence))).digest('hex');
}

export type SmokeValidationInput = {
  evidence: Omit<StudentIdentitySmokeEvidence, 'digest' | 'status' | 'blockers'>;
  expected: {
    runId: string;
    projectId: string;
    databaseId: string;
    planDigest: string;
    approvalDigest: string;
    sourceCommitSha: string;
    exportOperationId: string;
    projectionHealthId: string;
  };
  now: Date;
};

export function validateStudentIdentitySmokeEvidence(input: SmokeValidationInput): {
  status: 'green' | 'red';
  blockers: string[];
} {
  const blockers: string[] = [];
  const { evidence, expected } = input;

  for (const surface of CUTOVER_SMOKE_SURFACES) {
    const result = evidence.results[surface];
    if (!result) {
      blockers.push(`STUDENT_IDENTITY_SMOKE_SURFACE_MISSING: ${surface}`);
      continue;
    }
    if (result.status !== 'pass') {
      blockers.push(`STUDENT_IDENTITY_SMOKE_SURFACE_FAILED: ${surface} (${result.reasonCode})`);
    }
  }

  if (evidence.mutationGuardProbes.length === 0) {
    blockers.push('STUDENT_IDENTITY_SMOKE_NO_MUTATION_PROBES');
  }
  for (const probe of evidence.mutationGuardProbes) {
    if (probe.statusCode !== 503 || probe.reasonCode !== 'STUDENT_IDENTITY_MAINTENANCE') {
      blockers.push(`STUDENT_IDENTITY_SMOKE_MUTATION_NOT_BLOCKED: ${probe.surface}`);
    }
  }

  const executedAt = Date.parse(evidence.executedAt);
  if (!Number.isFinite(executedAt)) {
    blockers.push('STUDENT_IDENTITY_SMOKE_TIMESTAMP_INVALID');
  } else if (input.now.getTime() - executedAt > SMOKE_EVIDENCE_MAX_AGE_MS) {
    blockers.push('STUDENT_IDENTITY_SMOKE_EVIDENCE_STALE');
  }

  const bindings: Array<[string, unknown, unknown]> = [
    ['runId', evidence.runId, expected.runId],
    ['projectId', evidence.target.projectId, expected.projectId],
    ['databaseId', evidence.target.databaseId, expected.databaseId],
    ['planDigest', evidence.planDigest, expected.planDigest],
    ['approvalDigest', evidence.approvalDigest, expected.approvalDigest],
    ['sourceCommitSha', evidence.sourceCommitSha, expected.sourceCommitSha],
    ['exportOperationId', evidence.exportOperationId, expected.exportOperationId],
    ['projectionHealthId', evidence.projectionHealthId, expected.projectionHealthId],
  ];
  for (const [name, actual, want] of bindings) {
    if (actual !== want) {
      blockers.push(`STUDENT_IDENTITY_SMOKE_BINDING_MISMATCH: ${name}`);
    }
  }

  if (evidence.canonicalReadMode !== 'canonical_required') {
    blockers.push('STUDENT_IDENTITY_SMOKE_READ_MODE_NOT_REQUIRED');
  }
  if (evidence.operationCounts.failed !== 0) {
    blockers.push('STUDENT_IDENTITY_SMOKE_OPERATIONS_FAILED');
  }
  for (const [queue, count] of Object.entries(evidence.pendingJobCounts)) {
    if (count !== 0) {
      blockers.push(`STUDENT_IDENTITY_SMOKE_QUEUE_NOT_DRAINED: ${queue}`);
    }
  }

  assertNoSmokeSecrets(evidence);

  return { status: blockers.length === 0 ? 'green' : 'red', blockers };
}

export function sealStudentIdentitySmokeEvidence(
  input: SmokeValidationInput
): StudentIdentitySmokeEvidence {
  const { status, blockers } = validateStudentIdentitySmokeEvidence(input);
  const body = { ...input.evidence, status, blockers };
  return { ...body, digest: digestSmokeEvidence(body as never) };
}

export class RunStudentIdentitySmokeUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStudentIdentitySmokeUsageError';
    (this as any).usageError = true;
  }
}

export type RunStudentIdentitySmokeOptions = {
  mode: 'cutover';
  runId: string;
  planDigest: string;
  approvalDigest: string;
  exportOperationId: string;
  projectionHealthId: string;
  sourceCommit: string;
  outputPath?: string;
  write: boolean;
  assertGreen: boolean;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
};

const VALUE_FLAGS = new Set([
  '--mode',
  '--run-id',
  '--plan-digest',
  '--approval-digest',
  '--export-operation-id',
  '--projection-health-id',
  '--projection-evidence',
  '--source-commit',
  '--output',
  '--confirm-project-id',
  '--confirm-database-id',
  '--results',
]);

const BOOLEAN_FLAGS = new Set(['--write', '--assert-green']);

export function parseRunStudentIdentitySmokeArgs(argv: readonly string[]): RunStudentIdentitySmokeOptions {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  let write = false;
  let assertGreen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new RunStudentIdentitySmokeUsageError(`Unexpected argument: ${token}`);
    }
    if (seen.has(token)) {
      throw new RunStudentIdentitySmokeUsageError(`Repeated flag: ${token}`);
    }
    seen.add(token);

    if (token === '--results') {
      throw new RunStudentIdentitySmokeUsageError('Caller-supplied --results are forbidden');
    }

    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--write') write = true;
      if (token === '--assert-green') assertGreen = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new RunStudentIdentitySmokeUsageError(`Unknown flag: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new RunStudentIdentitySmokeUsageError(`Missing value for ${token}`);
    }
    values.set(token, value);
    index += 1;
  }

  const runId = values.get('--run-id');
  if (!runId) throw new RunStudentIdentitySmokeUsageError('--run-id is required');

  const planDigest = values.get('--plan-digest');
  if (!planDigest) throw new RunStudentIdentitySmokeUsageError('--plan-digest is required');

  const approvalDigest = values.get('--approval-digest');
  if (!approvalDigest) throw new RunStudentIdentitySmokeUsageError('--approval-digest is required');

  const exportOperationId = values.get('--export-operation-id');
  if (!exportOperationId) throw new RunStudentIdentitySmokeUsageError('--export-operation-id is required');

  const projectionHealthId = values.get('--projection-health-id');
  if (!projectionHealthId) throw new RunStudentIdentitySmokeUsageError('--projection-health-id is required');

  const outputPath = values.get('--output');
  if (!write && !outputPath) {
    throw new RunStudentIdentitySmokeUsageError('--output FILE is required for a read-only smoke run');
  }

  if (write) {
    const projectId = values.get('--confirm-project-id');
    const databaseId = values.get('--confirm-database-id');
    if (!projectId || !databaseId) {
      throw new RunStudentIdentitySmokeUsageError('--write requires --confirm-project-id and --confirm-database-id');
    }
  }

  return {
    mode: 'cutover',
    runId,
    planDigest,
    approvalDigest,
    exportOperationId,
    projectionHealthId,
    sourceCommit: values.get('--source-commit') ?? 'head',
    outputPath,
    write,
    assertGreen,
    confirmProjectId: values.get('--confirm-project-id'),
    confirmDatabaseId: values.get('--confirm-database-id'),
  };
}

/**
 * What the runner needs that it cannot invent.
 *
 * Every field here used to have a default, and every default produced
 * evidence about nothing that the release gate could not distinguish from a
 * real run: a localhost base URL, a "mock-token" bearer, an adapter that
 * answered 200 and 503 without leaving the process, and operation counts
 * typed in as 1/1/1/0.
 */
export type StudentIdentitySmokeDependencies = {
  adapter: SmokeProbeAdapter;
  target: { projectId: string; databaseId: string };
  operationCounts: { planned: number; applied: number; verified: number; failed: number };
  pendingJobCounts: Record<string, number>;
};

function requireSmokeFixture(runtime: StudentIdentityCliRuntime): SmokeFixture {
  const baseUrl = runtime.env.STUDENT_IDENTITY_SMOKE_BASE_URL ?? '';
  const bearerToken = runtime.env.STUDENT_IDENTITY_SMOKE_BEARER_TOKEN ?? '';
  const studentId = runtime.env.STUDENT_IDENTITY_SMOKE_STUDENT_ID ?? '';
  const classId = runtime.env.STUDENT_IDENTITY_SMOKE_CLASS_ID ?? '';
  const missing = [
    baseUrl ? '' : 'STUDENT_IDENTITY_SMOKE_BASE_URL',
    bearerToken ? '' : 'STUDENT_IDENTITY_SMOKE_BEARER_TOKEN',
    studentId ? '' : 'STUDENT_IDENTITY_SMOKE_STUDENT_ID',
    classId ? '' : 'STUDENT_IDENTITY_SMOKE_CLASS_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`STUDENT_IDENTITY_SMOKE_TARGET_NOT_CONFIGURED: ${missing.join(', ')}`);
  }
  return { baseUrl, bearerToken, studentId, classId };
}

/** Probes the deployment over HTTP, which is the only thing worth proving. */
function httpSmokeAdapter(): SmokeProbeAdapter {
  const call = async (
    fixture: SmokeFixture,
    probe: { path: string; method?: string; body?: unknown }
  ) => {
    const response = await fetch(`${fixture.baseUrl}${probe.path}`, {
      method: probe.method ?? 'GET',
      headers: {
        authorization: `Bearer ${fixture.bearerToken}`,
        'content-type': 'application/json',
      },
      ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // A non-JSON body is itself part of the observed shape.
    }
    return { statusCode: response.status, body };
  };

  return {
    read: (probe, fixture) => call(fixture, probe as unknown as { path: string }),
    mutate: (probe, fixture) =>
      call(fixture, {
        ...(probe as unknown as { path: string; body?: unknown }),
        method: 'POST',
      }),
    realtimeRecipients: async () => {
      throw new Error('STUDENT_IDENTITY_SMOKE_REALTIME_PROBE_NOT_CONFIGURED');
    },
  };
}

export async function runStudentIdentitySmoke(
  options: RunStudentIdentitySmokeOptions,
  runtime: StudentIdentityCliRuntime,
  db?: DocumentStore,
  dependencies?: StudentIdentitySmokeDependencies
): Promise<StudentIdentitySmokeEvidence> {
  const fixture = requireSmokeFixture(runtime);

  if (!dependencies) {
    throw new Error(
      'STUDENT_IDENTITY_SMOKE_TARGET_NOT_CONFIGURED: no probe adapter or run evidence supplied'
    );
  }
  const { projectId, databaseId } = dependencies.target;

  if (options.write && db) {
    assertConfirmedTarget({ projectId, databaseId }, options.confirmProjectId!, options.confirmDatabaseId!);
  }

  const startedAt = runtime.now().toISOString();
  const probeResults = await runStudentIdentitySmokeProbes(fixture, dependencies.adapter);

  const evidenceId = `smoke_${options.runId}_${runtime.now().getTime()}`;

  const evidence = sealStudentIdentitySmokeEvidence({
    evidence: {
      schemaVersion: 2,
      evidenceId,
      runId: options.runId,
      target: { projectId, databaseId },
      planDigest: options.planDigest,
      approvalDigest: options.approvalDigest,
      sourceCommitSha: options.sourceCommit,
      exportOperationId: options.exportOperationId,
      canonicalReadMode: 'canonical_required',
      projectionHealthId: options.projectionHealthId,
      operationCounts: dependencies.operationCounts,
      pendingJobCounts: dependencies.pendingJobCounts,
      startedAt,
      executedAt: runtime.now().toISOString(),
      runnerVersion: '2.0.0',
      results: probeResults.results,
      mutationGuardProbes: probeResults.mutationGuardProbes,
    },
    expected: {
      runId: options.runId,
      projectId,
      databaseId,
      planDigest: options.planDigest,
      approvalDigest: options.approvalDigest,
      sourceCommitSha: options.sourceCommit,
      exportOperationId: options.exportOperationId,
      projectionHealthId: options.projectionHealthId,
    },
    now: runtime.now(),
  });

  if (options.outputPath) {
    await writeJsonArtifactAtomic(options.outputPath, evidence, { idempotent: true });
  }

  if (options.write && db) {
    // Create-only. Evidence the release gate reads must not be replaceable
    // after the fact by a second, friendlier run.
    await db.runTransaction(async (tx) => {
      const ref = db.collection('student_identity_smoke_runs').doc(evidence.evidenceId);
      const snapshot = (await tx.get(ref as never)) as unknown as { exists: boolean };
      if (snapshot.exists) {
        throw new Error(
          `STUDENT_IDENTITY_SMOKE_EVIDENCE_IMMUTABLE: ${evidence.evidenceId} already recorded`
        );
      }
      tx.set(ref as never, evidence as never);
    });
  }

  return evidence;
}

const SMOKE_QUEUE_COLLECTIONS = {
  outboxJobs: 'outbox_jobs',
  accountingFinanceOutbox: 'accounting_finance_outbox',
  receiptNotificationOutbox: 'receipt_notification_outbox',
  zaloBulkJobs: 'zalo_bulk_jobs',
  payosProcessors: 'payos_processors',
  passwordResetWork: 'passwordResetRequests',
} as const;

const PENDING_STATUSES = new Set(['', 'pending', 'processing', 'failed']);

async function readRunOperationCounts(
  db: DocumentStore,
  runId: string
): Promise<{ planned: number; applied: number; verified: number; failed: number }> {
  const snapshot = (await db.doc(`student_profile_merge_runs/${runId}`).get()) as unknown as {
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  };
  if (!snapshot.exists) {
    throw new Error(`STUDENT_IDENTITY_SMOKE_RUN_NOT_FOUND: ${runId}`);
  }
  const data = snapshot.data() ?? {};
  const count = (key: string) => Number(data[key] ?? 0);
  return {
    planned: count('plannedOperationCount'),
    applied: count('appliedOperationCount'),
    verified: count('verifiedOperationCount'),
    failed: count('failedOperationCount'),
  };
}

async function readPendingJobCounts(db: DocumentStore): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [key, collection] of Object.entries(SMOKE_QUEUE_COLLECTIONS)) {
    const snapshot = await db.collection(collection).get();
    counts[key] = snapshot.docs.filter((doc) =>
      PENDING_STATUSES.has(String((doc.data() || {}).status ?? ''))
    ).length;
  }
  return counts;
}

export async function main(argv = process.argv.slice(2), runtime: StudentIdentityCliRuntime = createDefaultStudentIdentityCliRuntime()): Promise<number> {
  return executeStudentIdentityCli({
    argv,
    usage: 'Usage: run-student-identity-smoke [options]\nOptions:\n  --mode\n  --run-id\n  --plan-digest\n  --approval-digest\n  --export-operation-id\n  --projection-health-id\n  --projection-evidence\n  --source-commit\n  --output\n  --confirm-project-id\n  --confirm-database-id\n  --results\n  --write\n  --assert-green',
    parse: parseRunStudentIdentitySmokeArgs,
    runtime,
    run: async (options, rt): Promise<number> => {
      const opened = await rt.openDocumentStore();
      if (options.confirmProjectId || options.confirmDatabaseId) {
        assertConfirmedTarget(opened.target, {
          projectId: options.confirmProjectId,
          databaseId: options.confirmDatabaseId,
        });
      }

      const evidence = await runStudentIdentitySmoke(options, rt, opened.db, {
        adapter: httpSmokeAdapter(),
        target: opened.target,
        // Read from the run and the queues, never typed in: these are the
        // numbers the release gate compares against the run document.
        operationCounts: await readRunOperationCounts(opened.db, options.runId),
        pendingJobCounts: await readPendingJobCounts(opened.db),
      });

      const line = `student identity smoke: ${evidence.status} (${evidence.evidenceId})`;
      if (typeof rt.stdout === 'function') rt.stdout(line);
      else rt.stdout.write(line);

      if (options.assertGreen && evidence.status !== 'green') {
        throw new Error('STUDENT_IDENTITY_SMOKE_ASSERT_GREEN_FAILED');
      }
      return 0;
    },
  });
}

runStudentIdentityCliIfDirect(import.meta.url, main);
