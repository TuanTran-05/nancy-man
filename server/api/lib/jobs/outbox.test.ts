import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutboxJob, processOutboxJobs, registerOutboxHandler } from './outbox.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../maintenance/studentIdentityMaintenance.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

describe('outbox queue', () => {
  it('creates a job with idempotency key or skips if duplicate exists', async () => {
    const transactionEvents: string[] = [];
    const maintenanceRef = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ mode: 'normal' }) }),
    };
    const existingJob = { exists: true, id: 'job-existing' };

    const docRef = {
      id: 'zalo:unique-1',
      get: vi.fn().mockResolvedValue(existingJob),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const db = {
      doc: vi.fn(() => maintenanceRef),
      collection: vi.fn(() => ({
        doc: vi.fn(() => docRef),
      })),
      runTransaction: vi.fn(async (callback: any) => {
        const tx = {
          get: vi.fn(async (ref: any) => {
            if (ref === maintenanceRef) {
              transactionEvents.push('get:maintenance');
            } else {
              transactionEvents.push('get:outbox-job');
            }
            return await ref.get();
          }),
          set: vi.fn(async (ref: any, data: any) => await ref.set(data)),
        };
        return await callback(tx);
      }),
    };

    const jobId = await createOutboxJob(
      db as any,
      {
        type: 'send_zalo',
        payload: { phone: '0900000000', message: 'Hello' },
        idempotencyKey: 'zalo:unique-1',
      },
      {
        actorId: 'staff-1',
        operation: 'finance:receipts:create-and-post',
      }
    );

    expect(jobId).toBe('zalo:unique-1');
    expect(transactionEvents.slice(0, 2)).toEqual(['get:maintenance', 'get:outbox-job']);
    expect(docRef.get).toHaveBeenCalled();
    // set should NOT be called because the doc already exists
    expect(docRef.set).not.toHaveBeenCalled();
  });

  it('runs transaction to claim and processes outbox job successfully', async () => {
    const transactionEvents: string[] = [];
    const leaseStore = new Map<string, Record<string, unknown>>();
    const maintenanceRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
    };
    const jobData = {
      type: 'send_zalo',
      payload: { phone: '0901234567' },
      status: 'pending',
      attempts: 0,
      nextRunAt: '2026-05-21T01:00:00.000Z',
    };

    const jobDocSnap = {
      exists: true,
      id: 'job-1',
      data: () => jobData,
      ref: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    };

    const makeQuery = (docs: any[]) => ({
      limit: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ docs }),
      })),
    });

    const db = {
      collection: vi.fn(() => ({
        where: vi.fn((_field: string, _op: string, val: string) => {
          if (val === 'processing' || Array.isArray(val)) {
            // For 'in' queries (candidates) or 'processing' (stale)
            return makeQuery(val === 'processing' ? [] : [jobDocSnap]);
          }
          return makeQuery([]);
        }),
      })),
      runTransaction: vi.fn(async (callback: any) => {
        const tx = {
          get: vi.fn(async (target: any) => {
            if (target === maintenanceRef) {
              transactionEvents.push('get:maintenance');
              return { exists: false };
            }
            // The pass runs under a mutation lease so the drain check can see
            // it. A fake whose every document answers with the outbox job
            // would make the lease look lost the moment it was renewed.
            if (target?.path?.startsWith('_maintenance/student_identity/active_mutations/')) {
              return {
                exists: leaseStore.has(target.path),
                data: () => leaseStore.get(target.path),
              };
            }
            transactionEvents.push('get:outbox-job');
            return jobDocSnap;
          }),
          set: vi.fn((target: any, value: unknown) => {
            if (target?.path) leaseStore.set(target.path, value as Record<string, unknown>);
          }),
          update: vi.fn((target: any, value: Record<string, unknown>) => {
            if (target?.path && leaseStore.has(target.path)) {
              leaseStore.set(target.path, { ...leaseStore.get(target.path), ...value });
            }
          }),
          delete: vi.fn((target: any) => {
            if (target?.path) leaseStore.delete(target.path);
          }),
        };
        return await callback(tx);
      }),
      // The pass checks the identity maintenance window before claiming
      // anything: it writes student-linked records on a schedule, with nobody
      // watching. Absent here, which reads as `normal`.
      doc: vi.fn((docPath?: string) =>
        docPath?.startsWith('_maintenance/student_identity/active_mutations/')
          ? { path: docPath }
          : maintenanceRef
      ),
    };

    const mockHandler = vi.fn().mockResolvedValue(undefined);
    registerOutboxHandler('send_zalo', mockHandler);

    const stats = await processOutboxJobs(db as any, 'test-worker');

    expect(stats).toMatchObject({
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    // Maintenance twice before the job: once to take the lease that makes
    // this pass visible to the drain check, once inside the claim itself.
    expect(transactionEvents.slice(0, 3)).toEqual([
      'get:maintenance',
      'get:maintenance',
      'get:outbox-job',
    ]);
    expect(mockHandler).toHaveBeenCalledWith({ phone: '0901234567' });
    expect(jobDocSnap.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('marks an outbox job done with completeOutboxJob', async () => {
    const setFn = vi.fn().mockResolvedValue(undefined);
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          set: setFn,
        })),
      })),
    };

    const { completeOutboxJob } = await import('./outbox.js');
    await completeOutboxJob(db as any, 'job-123');

    expect(db.collection).toHaveBeenCalledWith('outbox_jobs');
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'done',
        processingStartedAt: null,
      }),
      { merge: true }
    );
  });
});

describe('outbox processing during the identity maintenance window', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  it('refuses to claim a job while student identity maintenance is read_only', async () => {
    // This pass runs on a schedule with nobody watching and writes
    // student-linked records. Starting one mid-window applies work to records
    // the merge has already fingerprinted, and the only trace is a balance
    // that stops adding up.
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'run-1',
        migrationActorId: 'migration',
        updatedAt: '2026-08-09T09:00:00.000Z',
        updatedBy: 'operator',
      },
      'outbox_jobs/job-1': {
        type: 'send_zalo',
        payload: { phone: '0901234567' },
        status: 'pending',
        attempts: 0,
        nextRunAt: '2026-05-21T01:00:00.000Z',
      },
    });

    await expect(processOutboxJobs(db, 'test-worker')).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
    // Left `pending` rather than failed: it runs on the next tick once the
    // window closes, which is what it already does for any transient failure.
    expect(String(store.get('outbox_jobs/job-1')?.status || '')).toBe('pending');
  });
});

describe('processOutboxJobs holds a mutation lease', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  it('is visible as an active lease while it runs, and releases it after', async () => {
    // The drain check counts active leases. A scheduled batch that writes
    // student-linked records without one is invisible to it, so the window can
    // lift over a worker that is still mid-pass.
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'outbox_jobs/job-1': {
        type: 'observe_leases',
        payload: {},
        status: 'pending',
        attempts: 0,
        createdAt: '2026-08-09T09:00:00.000Z',
      },
    });

    const leasesDuringRun: number[] = [];
    registerOutboxHandler('observe_leases', async () => {
      leasesDuringRun.push(
        [...store.keys()].filter((key) =>
          key.startsWith('_maintenance/student_identity/active_mutations/')
        ).length
      );
    });

    const stats = await processOutboxJobs(db, 'test-worker');

    expect(stats).toMatchObject({ processed: 1, succeeded: 1 });
    expect(leasesDuringRun).toEqual([1]);
    // Released once the pass is over, so the next drain check sees zero.
    const remaining = [...store.entries()].filter(
      ([key, value]) =>
        key.startsWith('_maintenance/student_identity/active_mutations/') &&
        (value as { state?: string }).state === 'active'
    );
    expect(remaining).toEqual([]);
  });
});

describe('outbox retry policy', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  it('Existing jobs without maxAttempts still use 5 attempts (existing behavior protected)', async () => {
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'outbox_jobs/job-1': {
        type: 'fail_job',
        payload: {},
        status: 'pending',
        attempts: 4, // Next is 5
        nextRunAt: '2020-01-01T00:00:00.000Z',
      },
    });

    const { registerOutboxHandler, processOutboxJobs } = await import('./outbox.js');
    registerOutboxHandler('fail_job', async () => {
      throw new Error('Normal failure');
    });

    await processOutboxJobs(db, 'worker-1');

    const job = store.get('outbox_jobs/job-1') as any;
    expect(job.status).toBe('dead');
    expect(job.attempts).toBe(5);
  });

  it('A job created with maxAttempts:3 becomes dead on its 3rd failed execution', async () => {
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'outbox_jobs/job-2': {
        type: 'fail_job_3',
        payload: {},
        status: 'pending',
        attempts: 2, // Next is 3
        maxAttempts: 3,
        nextRunAt: '2020-01-01T00:00:00.000Z',
      },
    });

    const { registerOutboxHandler, processOutboxJobs } = await import('./outbox.js');
    registerOutboxHandler('fail_job_3', async () => {
      throw new Error('Normal failure');
    });

    await processOutboxJobs(db, 'worker-1');

    const job = store.get('outbox_jobs/job-2') as any;
    expect(job.status).toBe('dead');
    expect(job.attempts).toBe(3);
  });

  it('A non-retryable OutboxHandlerError becomes dead immediately', async () => {
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'outbox_jobs/job-3': {
        type: 'fatal_job',
        payload: {},
        status: 'pending',
        attempts: 0,
        nextRunAt: '2020-01-01T00:00:00.000Z',
      },
    });

    const { registerOutboxHandler, processOutboxJobs, OutboxHandlerError } =
      await import('./outbox.js');
    registerOutboxHandler('fatal_job', async () => {
      throw new OutboxHandlerError('Fatal', { retryable: false, abortBatch: false });
    });

    await processOutboxJobs(db, 'worker-1');

    const job = store.get('outbox_jobs/job-3') as any;
    expect(job.status).toBe('dead');
    expect(job.attempts).toBe(1);
  });

  it('An abortBatch OutboxHandlerError updates current job then stops processing', async () => {
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'outbox_jobs/job-4': {
        type: 'abort_job',
        payload: {},
        status: 'pending',
        attempts: 0,
        nextRunAt: '2020-01-01T00:00:00.000Z',
      },
      'outbox_jobs/job-5': {
        type: 'abort_job',
        payload: {},
        status: 'pending',
        attempts: 0,
        nextRunAt: '2020-01-01T00:00:00.000Z',
      },
    });

    const { registerOutboxHandler, processOutboxJobs, OutboxHandlerError } =
      await import('./outbox.js');

    let calls = 0;
    registerOutboxHandler('abort_job', async () => {
      calls++;
      throw new OutboxHandlerError('Auth fail', { retryable: true, abortBatch: true });
    });

    const stats = await processOutboxJobs(db, 'worker-1');

    expect(calls).toBe(1);
    expect(stats.processed).toBe(1);

    const job4 = store.get('outbox_jobs/job-4') as any;
    expect(job4.status).toBe('failed');

    const job5 = store.get('outbox_jobs/job-5') as any;
    expect(job5.status).toBe('pending');
  });

  it('A handler error with retryAfterMs schedules nextRunAt from bounded delay', async () => {
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'outbox_jobs/job-6': {
        type: 'delay_job',
        payload: {},
        status: 'pending',
        attempts: 0,
        nextRunAt: '2020-01-01T00:00:00.000Z',
      },
    });

    const { registerOutboxHandler, processOutboxJobs, OutboxHandlerError } =
      await import('./outbox.js');
    registerOutboxHandler('delay_job', async () => {
      throw new OutboxHandlerError('Rate limit', {
        retryable: true,
        abortBatch: false,
        retryAfterMs: 60000,
      });
    });

    const now = Date.now();
    await processOutboxJobs(db, 'worker-1');

    const job = store.get('outbox_jobs/job-6') as any;
    expect(job.status).toBe('failed');

    const nextRunMs = Date.parse(job.nextRunAt);
    const delay = nextRunMs - now;

    // Bounded between 5000 and 300000 ms. 60000 should be used.
    expect(delay).toBeGreaterThan(50000);
    expect(delay).toBeLessThan(70000);
  });

  it('createOutboxJob rejects invalid maxAttempts and accepts valid ones, retaining the 3rd argument', async () => {
    const { db } = createInMemoryDocumentStore({
      '_maintenance/student_identity': { mode: 'normal' },
    });
    const { createOutboxJob } = await import('./outbox.js');

    const context = { actorId: '1', operation: 'test' };

    await expect(
      createOutboxJob(db as any, { type: 'test', payload: {}, maxAttempts: 0 }, context)
    ).rejects.toThrow('maxAttempts must be an integer between 1 and 10');

    await expect(
      createOutboxJob(db as any, { type: 'test', payload: {}, maxAttempts: 11 }, context)
    ).rejects.toThrow('maxAttempts must be an integer between 1 and 10');

    const id = await createOutboxJob(
      db as any,
      { type: 'test', payload: {}, maxAttempts: 5 },
      context
    );
    expect(id).toBeTruthy();
  });
});
