import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';
import {
  readStudentIdentityMaintenanceInTransaction,
  StudentIdentityMaintenanceError,
} from './studentIdentityMaintenance.js';

/**
 * Leases cover the writers the transactional guard cannot see.
 *
 * `assertStudentIdentityMutationAllowed` works because every DocumentStore
 * business transaction re-reads maintenance before its first write. That is
 * enough for a request that starts and finishes inside one transaction. It is
 * not enough for a Zalo bulk job halfway through its recipients, a PayOS
 * reconcile that has read the provider's ledger and not yet written ours, or
 * any other work that spans many transactions and an external system.
 *
 * Such work takes a lease first. Entering the maintenance window waits until
 * no lease is held, so the merge never applies underneath something that is
 * still running.
 *
 * **An expired lease is not garbage.** Expiry means the heartbeat stopped, not
 * that the work stopped — the process may have been killed mid-send, or simply
 * be slow. Deleting the record would enter the window with an external writer
 * possibly still running and no evidence it ever existed, so a stale lease is
 * reported as a blocker for a human to resolve.
 */

export const STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH =
  '_maintenance/student_identity/active_mutations';

/**
 * How long a lease survives without a heartbeat.
 *
 * Long enough that an ordinary slow batch does not trip it, short enough that
 * a dead process does not hold the cutover window open for an hour.
 */
export const STUDENT_IDENTITY_LEASE_TTL_MS = 5 * 60 * 1000;

export type StudentIdentityMutationLease = {
  leaseId: string;
  operation: string;
  actorId: string;
  state: 'active' | 'released';
  createdAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export class StudentIdentityLeaseError extends Error {
  readonly status = 409;
  readonly statusCode = 409;

  constructor(
    readonly code:
      | 'STUDENT_IDENTITY_LEASE_NOT_FOUND'
      | 'STUDENT_IDENTITY_LEASE_ACTOR_MISMATCH'
      | 'STUDENT_IDENTITY_LEASE_ACTIVE'
      | 'STUDENT_IDENTITY_LEASE_STALE',
    detail: string
  ) {
    super(`${code}: ${detail}`);
    this.name = 'StudentIdentityLeaseError';
  }
}

function leaseRef(db: DocumentStore, leaseId: string) {
  return db.doc(`${STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH}/${leaseId}`);
}

function parseLease(raw: unknown): StudentIdentityMutationLease | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.leaseId !== 'string' || !value.leaseId) return null;
  if (value.state !== 'active' && value.state !== 'released') return null;
  return {
    leaseId: value.leaseId,
    operation: String(value.operation || ''),
    actorId: String(value.actorId || ''),
    state: value.state,
    createdAt: String(value.createdAt || ''),
    heartbeatAt: String(value.heartbeatAt || ''),
    expiresAt: String(value.expiresAt || ''),
  };
}

function newLeaseId(operation: string, now: Date): string {
  // Time-ordered and readable, so a stale lease in the console says what it
  // was and roughly when it started without opening the document.
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${now.toISOString().replace(/[:.]/g, '-')}_${operation}_${suffix}`;
}

export async function acquireStudentIdentityMutationLease(
  db: DocumentStore,
  input: { operation: string; actorId: string; now?: Date }
): Promise<StudentIdentityMutationLease> {
  const now = input.now ?? new Date();
  const leaseId = newLeaseId(input.operation, now);

  return db.runTransaction(async (tx: Transaction) => {
    // Read inside the transaction. Reading outside leaves a gap in which
    // maintenance could close and the lease would be admitted into a shut
    // window; through the transaction the same flip is a retry.
    const state = await readStudentIdentityMaintenanceInTransaction(tx, db);
    if (state.mode !== 'normal') {
      throw new StudentIdentityMaintenanceError(
        `${input.operation} cannot take a mutation lease while maintenance is ${state.mode}`
      );
    }

    const lease: StudentIdentityMutationLease = {
      leaseId,
      operation: input.operation,
      actorId: input.actorId,
      state: 'active',
      createdAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + STUDENT_IDENTITY_LEASE_TTL_MS).toISOString(),
    };
    tx.set(leaseRef(db, leaseId) as never, lease);
    return lease;
  });
}

async function updateLease(
  db: DocumentStore,
  input: { leaseId: string; actorId: string; now?: Date },
  apply: (lease: StudentIdentityMutationLease, now: Date) => StudentIdentityMutationLease
): Promise<StudentIdentityMutationLease> {
  const now = input.now ?? new Date();
  return db.runTransaction(async (tx: Transaction) => {
    const ref = leaseRef(db, input.leaseId);
    const snapshot = (await tx.get(ref as never)) as unknown as {
      exists: boolean;
      data: () => unknown;
    };
    if (!snapshot.exists) {
      throw new StudentIdentityLeaseError('STUDENT_IDENTITY_LEASE_NOT_FOUND', input.leaseId);
    }
    const lease = parseLease(snapshot.data());
    if (!lease) {
      throw new StudentIdentityLeaseError('STUDENT_IDENTITY_LEASE_NOT_FOUND', input.leaseId);
    }
    // Actor-bound: a lease is a claim by one worker, and letting any caller
    // extend or drop somebody else's claim would make it worthless as a gate.
    if (lease.actorId !== input.actorId) {
      throw new StudentIdentityLeaseError(
        'STUDENT_IDENTITY_LEASE_ACTOR_MISMATCH',
        `${input.leaseId} is held by another actor`
      );
    }

    const next = apply(lease, now);
    tx.set(ref as never, next);
    return next;
  });
}

export async function heartbeatStudentIdentityMutationLease(
  db: DocumentStore,
  input: { leaseId: string; actorId: string; now?: Date }
): Promise<StudentIdentityMutationLease> {
  return updateLease(db, input, (lease, now) => ({
    ...lease,
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + STUDENT_IDENTITY_LEASE_TTL_MS).toISOString(),
  }));
}

/**
 * Releasing does not require `normal`.
 *
 * Entry waits for leases to drain, so demanding `normal` to release would
 * deadlock the window against the very job it is waiting for. Idempotent for
 * the same reason jobs retry: a second release must not fail the caller.
 */
export async function releaseStudentIdentityMutationLease(
  db: DocumentStore,
  input: { leaseId: string; actorId: string; now?: Date }
): Promise<StudentIdentityMutationLease> {
  return updateLease(db, input, (lease, now) => ({
    ...lease,
    state: 'released',
    heartbeatAt: now.toISOString(),
  }));
}

export async function listStudentIdentityMutationLeases(
  db: DocumentStore
): Promise<StudentIdentityMutationLease[]> {
  const snapshot = await db.collection(STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH).get();
  return (snapshot.docs || [])
    .map((doc) => parseLease(doc.data()))
    .filter((lease): lease is StudentIdentityMutationLease => lease !== null);
}

export type StudentIdentityLeaseSurvey = {
  active: StudentIdentityMutationLease[];
  stale: StudentIdentityMutationLease[];
};

/**
 * The gate maintenance entry waits on.
 *
 * Reports operation names and actor ids and nothing else — these messages
 * travel into cutover evidence, where a student name would be a leak no later
 * redaction takes back.
 */
export async function assertNoBlockingStudentIdentityLeases(
  db: DocumentStore,
  now: Date = new Date()
): Promise<StudentIdentityLeaseSurvey> {
  const leases = await listStudentIdentityMutationLeases(db);
  const held = leases.filter((lease) => lease.state === 'active');
  const stale = held.filter((lease) => Date.parse(lease.expiresAt) <= now.getTime());
  const active = held.filter((lease) => Date.parse(lease.expiresAt) > now.getTime());

  if (stale.length > 0) {
    throw new StudentIdentityLeaseError(
      'STUDENT_IDENTITY_LEASE_STALE',
      `${stale.length} lease(s) expired without release and may still be running: ${stale
        .map((lease) => `${lease.operation}@${lease.actorId}`)
        .join(', ')}`
    );
  }
  if (active.length > 0) {
    throw new StudentIdentityLeaseError(
      'STUDENT_IDENTITY_LEASE_ACTIVE',
      `${active.length} lease(s) still held: ${active
        .map((lease) => `${lease.operation}@${lease.actorId}`)
        .join(', ')}`
    );
  }

  return { active, stale };
}

export type StudentIdentityLeaseHeartbeat = {
  stop: () => Promise<void>;
  throwIfFailed: () => void;
};

export type StudentIdentityLeaseRunnerDependencies = {
  acquire: (
    db: DocumentStore,
    input: { operation: string; actorId: string; now?: Date }
  ) => Promise<StudentIdentityMutationLease>;
  startHeartbeat: (
    db: DocumentStore,
    lease: StudentIdentityMutationLease,
    onFailure: (error: unknown) => void
  ) => StudentIdentityLeaseHeartbeat;
  release: (
    db: DocumentStore,
    input: { leaseId: string; actorId: string; now?: Date }
  ) => Promise<StudentIdentityMutationLease>;
};

export function startStudentIdentityMutationLeaseHeartbeat(
  db: DocumentStore,
  lease: StudentIdentityMutationLease,
  onFailure: (error: unknown) => void
): StudentIdentityLeaseHeartbeat {
  let stopped = false;
  let heartbeatInFlight = false;
  let renewal: Promise<void> | undefined;
  let failed = false;
  let failure: unknown;

  const reportFailure = (error: unknown) => {
    if (failed) return;
    failed = true;
    failure = error;
    onFailure(error);
  };

  const renew = () => {
    if (stopped || heartbeatInFlight) return;
    heartbeatInFlight = true;
    renewal = heartbeatStudentIdentityMutationLease(db, {
      leaseId: lease.leaseId,
      actorId: lease.actorId,
    })
      .then(() => undefined)
      .catch(reportFailure)
      .finally(() => {
        heartbeatInFlight = false;
      });
  };

  const timer = setInterval(renew, STUDENT_IDENTITY_LEASE_TTL_MS / 3);
  const timerWithUnref = timer as unknown as { unref?: () => void };
  timerWithUnref.unref?.();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await renewal;
    },
    throwIfFailed: () => {
      if (failed) throw failure;
    },
  };
}

export const defaultStudentIdentityLeaseRunnerDependencies: StudentIdentityLeaseRunnerDependencies =
  {
    acquire: acquireStudentIdentityMutationLease,
    startHeartbeat: startStudentIdentityMutationLeaseHeartbeat,
    release: releaseStudentIdentityMutationLease,
  };

export async function withStudentIdentityMutationLease<T>(
  db: DocumentStore,
  input: { operation: string; actorId: string; now?: Date },
  work: (ctx: { lease: StudentIdentityMutationLease; signal: AbortSignal }) => Promise<T>,
  deps: StudentIdentityLeaseRunnerDependencies = defaultStudentIdentityLeaseRunnerDependencies
): Promise<T> {
  const lease = await deps.acquire(db, input);
  const controller = new AbortController();
  let heartbeat: StudentIdentityLeaseHeartbeat | undefined;
  let result!: T;
  let primaryFailure: unknown;
  let hasPrimaryFailure = false;
  let releaseFailure: unknown;
  let hasReleaseFailure = false;

  try {
    heartbeat = deps.startHeartbeat(db, lease, (error) => controller.abort(error));
    result = await work({ lease, signal: controller.signal });
    heartbeat.throwIfFailed();
  } catch (error) {
    primaryFailure = error;
    hasPrimaryFailure = true;
  } finally {
    try {
      await heartbeat?.stop();
      heartbeat?.throwIfFailed();
    } catch (error) {
      primaryFailure ??= error;
      hasPrimaryFailure = true;
    }
    try {
      await deps.release(db, {
        leaseId: lease.leaseId,
        actorId: input.actorId,
      });
    } catch (error) {
      releaseFailure = error;
      hasReleaseFailure = true;
    }
  }

  if (hasPrimaryFailure && hasReleaseFailure) {
    throw new AggregateError(
      [primaryFailure, releaseFailure],
      'Student identity mutation work failed and its lease could not be released'
    );
  }
  if (hasReleaseFailure) throw releaseFailure;
  if (hasPrimaryFailure) throw primaryFailure;
  return result;
}
