import type { DocumentReference, DocumentStore } from '@/server/db/documentStore.js';

export type LightweightJobKind =
  | 'export'
  | 'notification_digest'
  | 'reconciliation'
  | 'finance_aggregate'
  | 'dashboard_aggregate'
  | 'cleanup'
  | 'zalo_bot_daily_digest'
  | 'daily_maintenance';

export type LightweightJobStatus = 'running' | 'completed' | 'failed';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JobRequester = {
  uid: string;
  role: string;
  name?: string;
};

export type LightweightJobRun = {
  id: string;
  ref: DocumentReference;
  statusRef?: DocumentReference;
  name?: string;
  startedAt: string;
};

export type StartJobRunInput = {
  kind: LightweightJobKind;
  name: string;
  requestedBy?: JobRequester;
  params?: Record<string, unknown>;
};

const JOB_SCHEMA_VERSION = 1;

function sanitizeJobValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeJobValue(item))
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (typeof value === 'object') {
    const output: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeJobValue(child);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    return output;
  }
  return String(value);
}

function sanitizeJobRecord(value: Record<string, unknown> | undefined): Record<string, JsonValue> {
  const sanitized = sanitizeJobValue(value || {});
  return sanitized && !Array.isArray(sanitized) && typeof sanitized === 'object' ? sanitized : {};
}

function durationMs(startedAt: string, finishedAt: string): number {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  return Number.isFinite(start) && Number.isFinite(finish) ? Math.max(0, finish - start) : 0;
}

export async function startJobRun(
  db: DocumentStore,
  input: StartJobRunInput
): Promise<LightweightJobRun> {
  const now = new Date().toISOString();
  const ref = db.collection('jobs').doc();
  const statusRef = db.collection('job_runs').doc(input.name);
  await ref.set({
    kind: input.kind,
    name: input.name,
    status: 'running' satisfies LightweightJobStatus,
    attempts: 1,
    ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
    params: sanitizeJobRecord(input.params),
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    schemaVersion: JOB_SCHEMA_VERSION,
  });
  if (typeof (statusRef as { set?: unknown }).set === 'function') {
    await statusRef.set(
      {
        jobName: input.name,
        status: 'running',
        startedAt: now,
        finishedAt: null,
        cursor: null,
        checked: 0,
        changed: 0,
        errorCode: '',
        errorMessage: '',
        updatedAt: now,
      },
      { merge: true }
    );
  }
  return { id: ref.id, ref, statusRef, name: input.name, startedAt: now };
}

export async function completeJobRun(
  _db: DocumentStore,
  job: LightweightJobRun,
  result?: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  await job.ref.update({
    status: 'completed' satisfies LightweightJobStatus,
    result: sanitizeJobRecord(result),
    completedAt: now,
    durationMs: durationMs(job.startedAt, now),
    updatedAt: now,
  });
  if (job.statusRef && job.name && typeof (job.statusRef as { set?: unknown }).set === 'function') {
    await job.statusRef.set(
      {
        jobName: job.name,
        status: 'success',
        finishedAt: now,
        ...(result?.cursor !== undefined ? { cursor: result.cursor } : {}),
        ...(result?.checked !== undefined ? { checked: result.checked } : {}),
        ...(result?.changed !== undefined ? { changed: result.changed } : {}),
        errorCode: '',
        errorMessage: '',
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

export async function failJobRun(
  _db: DocumentStore,
  job: LightweightJobRun,
  err: unknown
): Promise<void> {
  const now = new Date().toISOString();
  await job.ref.update({
    status: 'failed' satisfies LightweightJobStatus,
    error: {
      message: err instanceof Error ? err.message : 'Unknown error',
    },
    completedAt: now,
    durationMs: durationMs(job.startedAt, now),
    updatedAt: now,
  });
  if (job.statusRef && job.name && typeof (job.statusRef as { set?: unknown }).set === 'function') {
    await job.statusRef.set(
      {
        jobName: job.name,
        status: 'failed',
        finishedAt: now,
        errorCode: 'job_failed',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

export async function runTrackedJob<T>(
  db: DocumentStore,
  input: StartJobRunInput,
  runner: (job: LightweightJobRun) => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>
): Promise<T> {
  const job = await startJobRun(db, input);
  try {
    const result = await runner(job);
    await completeJobRun(db, job, summarize ? summarize(result) : undefined);
    return result;
  } catch (err) {
    await failJobRun(db, job, err);
    throw err;
  }
}
