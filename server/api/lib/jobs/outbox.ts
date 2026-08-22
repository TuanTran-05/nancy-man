import { FieldValue, type DocumentStore, type Transaction } from '@/server/db/documentStore.js';
import { assertStudentIdentityMutationAllowed } from '../maintenance/studentIdentityMaintenance.js';
import {
  runStudentIdentityMutationTransaction,
  type StudentIdentityMutationContext,
} from '../maintenance/studentIdentityMutationTransaction.js';
import { withStudentIdentityMutationLease } from '../maintenance/studentIdentityMutationLease.js';

export type OutboxJobStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead';

export class OutboxHandlerError extends Error {
  constructor(
    message: string,
    readonly options: {
      retryable: boolean;
      abortBatch: boolean;
      retryAfterMs?: number;
    }
  ) {
    super(message);
    this.name = 'OutboxHandlerError';
  }
}

export interface OutboxJob {
  id: string;
  type: string;
  payload: any;
  status: OutboxJobStatus;
  idempotencyKey?: string;
  maxAttempts?: number;
  processingStartedAt?: string;
  lockedBy?: string;
  attempts: number;
  nextRunAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: any;
}

export type OutboxJobHandler = (payload: any) => Promise<void>;

const jobHandlers = new Map<string, OutboxJobHandler>();

export function registerOutboxHandler(type: string, handler: OutboxJobHandler) {
  jobHandlers.set(type, handler);
}

const PROCESS_BATCH_LIMIT = 50;

export async function createOutboxJob(
  db: DocumentStore,
  input: {
    type: string;
    payload: any;
    idempotencyKey?: string;
    maxAttempts?: number;
  },
  context: StudentIdentityMutationContext
): Promise<string> {
  if (input.maxAttempts !== undefined) {
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10) {
      throw new Error(`maxAttempts must be an integer between 1 and 10, got ${input.maxAttempts}`);
    }
  }

  const now = new Date().toISOString();

  // Use idempotencyKey as document ID with a transaction to prevent TOCTOU race.
  // The transaction atomically checks existence and creates if absent, so a concurrent
  // request that already claimed/completed the job is never overwritten.
  if (input.idempotencyKey) {
    const ref = db.collection('outbox_jobs').doc(input.idempotencyKey);

    await runStudentIdentityMutationTransaction(db, context, async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        return; // already exists, do not overwrite
      }

      const jobData = {
        type: input.type,
        payload: input.payload,
        status: 'pending' as OutboxJobStatus,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts ?? null,
        processingStartedAt: null,
        lockedBy: null,
        attempts: 0,
        nextRunAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      };

      tx.set(ref, jobData);
    });

    return ref.id;
  }

  const ref = db.collection('outbox_jobs').doc();
  const jobData = {
    type: input.type,
    payload: input.payload,
    status: 'pending' as OutboxJobStatus,
    idempotencyKey: null,
    maxAttempts: input.maxAttempts ?? null,
    processingStartedAt: null,
    lockedBy: null,
    attempts: 0,
    nextRunAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await ref.set(jobData);
  return ref.id;
}

export async function processOutboxJobs(
  db: DocumentStore,
  lockerId: string = 'worker'
): Promise<{ processed: number; succeeded: number; failed: number }> {
  // Nobody is watching this one. It runs on a schedule and writes
  // student-linked records — receipts, notifications, ledger effects — so a
  // pass that starts mid-window applies to records the merge has already
  // fingerprinted, and the only trace is a balance that no longer adds up.
  //
  // Blocked rather than queued: the jobs stay `pending` and run on the next
  // tick once the window closes, which is the behavior they already have for
  // every other transient failure.
  const mutationContext: StudentIdentityMutationContext = {
    actorId: `job:outbox:${lockerId}`,
    operation: 'audit_jobs:outbox-process',
  };
  await assertStudentIdentityMutationAllowed(db, mutationContext);

  // The check above is a single moment; this pass is not. It claims jobs one
  // transaction at a time, and the window can close between the first and the
  // last. The lease makes the pass visible to the drain check, so a release
  // cannot be proven while a worker is still mid-batch, and the abort signal
  // stops the loop rather than the run.
  return withStudentIdentityMutationLease(
    db,
    { operation: 'audit_jobs:outbox-process', actorId: mutationContext.actorId },
    ({ signal }) => processEligibleOutboxJobs(db, lockerId, mutationContext, signal)
  );
}

async function processEligibleOutboxJobs(
  db: DocumentStore,
  lockerId: string,
  mutationContext: StudentIdentityMutationContext,
  signal: AbortSignal
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const now = new Date().toISOString();

  // Find candidates that are eligible to run (bounded batch to prevent OOM)
  const candidatesSnap = await db
    .collection('outbox_jobs')
    .where('status', 'in', ['pending', 'failed'])
    .limit(PROCESS_BATCH_LIMIT)
    .get();

  const staleSnap = await db
    .collection('outbox_jobs')
    .where('status', '==', 'processing')
    .limit(PROCESS_BATCH_LIMIT)
    .get();

  const allCandidateDocs = [...candidatesSnap.docs, ...staleSnap.docs];

  const eligibleDocs = allCandidateDocs.filter((docSnap) => {
    const data = docSnap.data();
    if (data.status === 'processing') {
      if (!data.processingStartedAt) return true;
      const started = Date.parse(data.processingStartedAt);
      const ageMs = Date.now() - started;
      return ageMs > 5 * 60 * 1000; // lock timeout 5 minutes
    }
    const nextRun = data.nextRunAt ? Date.parse(data.nextRunAt) : 0;
    return nextRun <= Date.now();
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const docSnap of eligibleDocs) {
    // The window closed, or the lease was lost. Remaining jobs stay pending
    // and run on the next tick, which is what they already do for every other
    // transient failure.
    if (signal.aborted) break;

    const jobRef = docSnap.ref;

    // Claim the job inside a transaction
    const claimedJob = await runStudentIdentityMutationTransaction(
      db,
      mutationContext,
      async (tx: Transaction) => {
        const snap = await tx.get(jobRef);
        if (!snap.exists) return null;
        const data = snap.data()!;

        // Double check status/stale condition in tx
        if (data.status === 'processing') {
          if (data.processingStartedAt) {
            const started = Date.parse(data.processingStartedAt);
            const ageMs = Date.now() - started;
            if (ageMs <= 5 * 60 * 1000) return null; // claimed by someone else in the meantime
          }
        } else if (data.status === 'done' || data.status === 'dead') {
          return null; // completed or permanently failed in the meantime
        } else if (data.nextRunAt) {
          const nextRun = Date.parse(data.nextRunAt);
          if (nextRun > Date.now()) return null;
        }

        tx.update(jobRef, {
          status: 'processing' as OutboxJobStatus,
          processingStartedAt: new Date().toISOString(),
          lockedBy: lockerId,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { id: snap.id, ...data } as OutboxJob;
      }
    );

    if (!claimedJob) continue;
    processed++;

    const handler = jobHandlers.get(claimedJob.type);
    if (!handler) {
      const errMessage = `No handler registered for job type ${claimedJob.type}`;
      console.error(errMessage);

      await jobRef.update({
        status: 'dead' as OutboxJobStatus,
        attempts: claimedJob.attempts + 1,
        lastError: errMessage,
        processingStartedAt: null,
        lockedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      failed++;
      continue;
    }

    try {
      await handler(claimedJob.payload);

      await jobRef.update({
        status: 'done' as OutboxJobStatus,
        processingStartedAt: null,
        lockedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      succeeded++;
    } catch (err: any) {
      console.error(`Failed to execute outbox job ${claimedJob.id}:`, err);
      const policyError = err instanceof OutboxHandlerError ? err : null;
      const nextAttempts = claimedJob.attempts + 1;
      const maxAttempts = claimedJob.maxAttempts ?? 5;
      const terminal = policyError?.options.retryable === false || nextAttempts >= maxAttempts;
      const boundedRetryAfterMs = policyError?.options.retryAfterMs
        ? Math.min(300_000, Math.max(5_000, policyError.options.retryAfterMs))
        : null;

      // Exponential backoff retry: 30s * 2^attempts (unless retryAfterMs provided)
      const backoffSec = 30 * Math.pow(2, claimedJob.attempts);
      const nextRun = boundedRetryAfterMs
        ? new Date(Date.now() + boundedRetryAfterMs).toISOString()
        : new Date(Date.now() + backoffSec * 1000).toISOString();

      await jobRef.update({
        status: (terminal ? 'dead' : 'failed') as OutboxJobStatus,
        attempts: nextAttempts,
        lastError: err instanceof Error ? err.message : String(err),
        nextRunAt: terminal ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() : nextRun,
        processingStartedAt: null,
        lockedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      failed++;

      // Stop processing batch on auth abort
      if (policyError?.options.abortBatch === true) break;
    }
  }

  return { processed, succeeded, failed };
}

export async function completeOutboxJob(db: DocumentStore, jobId: string): Promise<void> {
  await db.collection('outbox_jobs').doc(jobId).set(
    {
      status: 'done',
      processingStartedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
