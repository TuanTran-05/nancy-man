import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireStudentIdentityMutationLease,
  assertNoBlockingStudentIdentityLeases,
  heartbeatStudentIdentityMutationLease,
  listStudentIdentityMutationLeases,
  releaseStudentIdentityMutationLease,
  StudentIdentityLeaseError,
  STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH,
  STUDENT_IDENTITY_LEASE_TTL_MS,
  type StudentIdentityLeaseRunnerDependencies,
  type StudentIdentityMutationLease,
  withStudentIdentityMutationLease,
} from './studentIdentityMutationLease.js';
import { resetStudentIdentityMaintenanceCacheForTests } from './studentIdentityMaintenance.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

const NOW = new Date('2026-08-09T10:00:00.000Z');
const INPUT = { operation: 'payments:reconcile', actorId: 'job:payos' };

function maintenance(mode: 'normal' | 'read_only') {
  return {
    '_maintenance/student_identity': {
      mode,
      activeRunId: mode === 'read_only' ? 'run-1' : null,
      migrationActorId: mode === 'read_only' ? 'migration' : null,
      updatedAt: '2026-08-09T09:00:00.000Z',
      updatedBy: 'operator',
    },
  };
}

function lease(): StudentIdentityMutationLease {
  return {
    leaseId: 'lease-1',
    operation: INPUT.operation,
    actorId: INPUT.actorId,
    state: 'active',
    createdAt: NOW.toISOString(),
    heartbeatAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + STUDENT_IDENTITY_LEASE_TTL_MS).toISOString(),
  };
}

function runnerDependencies(overrides: Partial<StudentIdentityLeaseRunnerDependencies> = {}) {
  return {
    acquire: vi.fn().mockResolvedValue(lease()),
    startHeartbeat: vi.fn().mockReturnValue({ stop: vi.fn(), throwIfFailed: vi.fn() }),
    release: vi.fn().mockResolvedValue({ ...lease(), state: 'released' }),
    ...overrides,
  } satisfies StudentIdentityLeaseRunnerDependencies;
}

describe('student identity mutation leases', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());
  afterEach(() => vi.useRealTimers());

  it('refuses a lease once maintenance is read_only', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('read_only'));

    await expect(acquireStudentIdentityMutationLease(db, { ...INPUT, now: NOW })).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
  });

  it('issues an active lease while maintenance is normal', async () => {
    const { db, store } = createInMemoryDocumentStore(maintenance('normal'));

    const acquired = await acquireStudentIdentityMutationLease(db, { ...INPUT, now: NOW });

    expect(acquired).toMatchObject({ state: 'active', actorId: INPUT.actorId });
    expect(store.has(`${STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH}/${acquired.leaseId}`)).toBe(true);
  });

  it('keeps concurrent maintenance entry and lease acquisition fail closed', async () => {
    const events: string[] = [];
    const states = [
      maintenance('normal')['_maintenance/student_identity'],
      maintenance('read_only')['_maintenance/student_identity'],
    ];
    const db = {
      doc: (path: string) => ({ path }),
      async runTransaction<T>(callback: (tx: never) => Promise<T>): Promise<T> {
        let value!: T;
        for (const state of states) {
          const staged: string[] = [];
          value = await callback({
            get: async (ref: { path: string }) => {
              events.push(`get:${ref.path}`);
              return { exists: true, data: () => state };
            },
            set: (ref: { path: string }) => staged.push(ref.path),
          } as never);
          if (state.mode === 'normal') events.push(`discarded:${staged.join(',')}`);
        }
        return value;
      },
    } as never;

    await expect(acquireStudentIdentityMutationLease(db, { ...INPUT, now: NOW })).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
    expect(events).toEqual([
      'get:_maintenance/student_identity',
      expect.stringMatching(/^discarded:_maintenance\/student_identity\/active_mutations\//),
      'get:_maintenance/student_identity',
    ]);
  });

  it('heartbeats every third of the lease TTL and leaves a released lease visible', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { db, writeLog } = createInMemoryDocumentStore(maintenance('normal'));
    let finish!: () => void;

    const running = withStudentIdentityMutationLease(
      db,
      INPUT,
      async () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('done');
        })
    );

    await vi.advanceTimersByTimeAsync(STUDENT_IDENTITY_LEASE_TTL_MS / 3);
    finish();
    await expect(running).resolves.toBe('done');

    expect(writeLog).toHaveLength(3);
    expect(writeLog.every((path) => path.startsWith(STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH))).toBe(
      true
    );
    await expect(assertNoBlockingStudentIdentityLeases(db, NOW)).resolves.toEqual({
      active: [],
      stale: [],
    });
  });

  it('treats an expired lease as a visible blocker instead of deleting it', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('normal'));
    await acquireStudentIdentityMutationLease(db, { ...INPUT, now: NOW });
    const afterExpiry = new Date(NOW.getTime() + STUDENT_IDENTITY_LEASE_TTL_MS + 1);

    await expect(assertNoBlockingStudentIdentityLeases(db, afterExpiry)).rejects.toThrow(
      'STUDENT_IDENTITY_LEASE_STALE'
    );
    await expect(listStudentIdentityMutationLeases(db)).resolves.toHaveLength(1);
  });

  it('unrefs the heartbeat timer when the runtime supports it', async () => {
    const unref = vi.fn();
    const timer = { unref } as unknown as ReturnType<typeof setInterval>;
    const interval = vi.spyOn(globalThis, 'setInterval').mockReturnValue(timer);

    await withStudentIdentityMutationLease(
      createInMemoryDocumentStore(maintenance('normal')).db,
      INPUT,
      async () => 'done'
    );

    expect(interval).toHaveBeenCalledWith(expect.any(Function), STUDENT_IDENTITY_LEASE_TTL_MS / 3);
    expect(unref).toHaveBeenCalledOnce();
  });

  it('aborts the work and rejects when renewal loses ownership', async () => {
    const ownershipLoss = new StudentIdentityLeaseError(
      'STUDENT_IDENTITY_LEASE_ACTOR_MISMATCH',
      'lease-1 is held by another actor'
    );
    const deps = runnerDependencies({
      startHeartbeat: vi.fn((_, __, onFailure) => {
        onFailure(ownershipLoss);
        return {
          stop: vi.fn(),
          throwIfFailed: () => {
            throw ownershipLoss;
          },
        };
      }),
    });
    let sawAbort = false;

    await expect(
      withStudentIdentityMutationLease(
        createInMemoryDocumentStore(maintenance('normal')).db,
        INPUT,
        async ({ signal }) => {
          sawAbort = signal.aborted;
          return 'must not escape';
        },
        deps
      )
    ).rejects.toBe(ownershipLoss);

    expect(sawAbort).toBe(true);
  });

  it('drains an in-flight renewal failure before releasing a successful work lease', async () => {
    const ownershipLoss = new StudentIdentityLeaseError(
      'STUDENT_IDENTITY_LEASE_ACTOR_MISMATCH',
      'lease-1 is held by another actor'
    );
    let rejectRenewal!: (error: unknown) => void;
    let stopStarted!: () => void;
    let heartbeatFailure: unknown;
    const renewal = new Promise<void>((_, reject) => {
      rejectRenewal = reject;
    });
    const stopHasStarted = new Promise<void>((resolve) => {
      stopStarted = resolve;
    });
    const release = vi.fn().mockResolvedValue({ ...lease(), state: 'released' as const });
    const deps = runnerDependencies({
      startHeartbeat: vi.fn((_, __, onFailure) => {
        const drained = renewal.catch((error) => {
          heartbeatFailure = error;
          onFailure(error);
        });
        return {
          stop: async () => {
            stopStarted();
            await drained;
          },
          throwIfFailed: () => {
            if (heartbeatFailure) throw heartbeatFailure;
          },
        };
      }),
      release,
    });

    const running = withStudentIdentityMutationLease(
      createInMemoryDocumentStore(maintenance('normal')).db,
      INPUT,
      async () => 'completed',
      deps
    );

    await stopHasStarted;
    expect(release).not.toHaveBeenCalled();
    rejectRenewal(ownershipLoss);

    await expect(running).rejects.toBe(ownershipLoss);
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases an actor-bound lease when external work throws', async () => {
    const deps = runnerDependencies();
    const providerFailure = new Error('provider failed');

    await expect(
      withStudentIdentityMutationLease(
        createInMemoryDocumentStore(maintenance('normal')).db,
        INPUT,
        async () => {
          throw providerFailure;
        },
        deps
      )
    ).rejects.toBe(providerFailure);

    expect(deps.release).toHaveBeenCalledWith(expect.anything(), {
      leaseId: 'lease-1',
      actorId: INPUT.actorId,
    });
  });

  it('surfaces release ownership failures and leaves the stale lease visible', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('normal'));
    const releaseFailure = new StudentIdentityLeaseError(
      'STUDENT_IDENTITY_LEASE_ACTOR_MISMATCH',
      'lease is held by another actor'
    );
    const deps = runnerDependencies({
      acquire: (database, input) =>
        acquireStudentIdentityMutationLease(database, { ...input, now: NOW }),
      release: vi.fn().mockRejectedValue(releaseFailure),
    });

    await expect(
      withStudentIdentityMutationLease(db, INPUT, async () => 'done', deps)
    ).rejects.toBe(releaseFailure);

    await expect(listStudentIdentityMutationLeases(db)).resolves.toMatchObject([
      { state: 'active', actorId: INPUT.actorId },
    ]);
  });

  it('preserves both work and release failures', async () => {
    const workFailure = new Error('provider failed');
    const releaseFailure = new StudentIdentityLeaseError(
      'STUDENT_IDENTITY_LEASE_ACTOR_MISMATCH',
      'lease is held by another actor'
    );
    const deps = runnerDependencies({ release: vi.fn().mockRejectedValue(releaseFailure) });

    const error = await withStudentIdentityMutationLease(
      createInMemoryDocumentStore(maintenance('normal')).db,
      INPUT,
      async () => {
        throw workFailure;
      },
      deps
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([workFailure, releaseFailure]);
  });

  it('extends and actor-binds direct heartbeats', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('normal'));
    const acquired = await acquireStudentIdentityMutationLease(db, { ...INPUT, now: NOW });
    const later = new Date(NOW.getTime() + 60_000);

    await expect(
      heartbeatStudentIdentityMutationLease(db, {
        leaseId: acquired.leaseId,
        actorId: INPUT.actorId,
        now: later,
      })
    ).resolves.toMatchObject({ heartbeatAt: later.toISOString() });
    await expect(
      releaseStudentIdentityMutationLease(db, {
        leaseId: acquired.leaseId,
        actorId: 'another-job',
        now: later,
      })
    ).rejects.toThrow('STUDENT_IDENTITY_LEASE_ACTOR_MISMATCH');
  });
});
