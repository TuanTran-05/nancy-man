import { describe, expect, it, vi } from 'vitest';
import { completeJobRun, failJobRun, startJobRun, type LightweightJobKind } from './jobStore.js';

function makeJobDb() {
  const ref = {
    id: 'job-1',
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const statusRef = {
    id: 'full-export-sql',
    set: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    collection: vi.fn((name: string) => {
      expect(['jobs', 'job_runs']).toContain(name);
      return {
        doc: vi.fn(() => (name === 'job_runs' ? statusRef : ref)),
      };
    }),
  };
  return { db, ref, statusRef };
}

describe('jobStore', () => {
  it('starts a lightweight job run in the jobs collection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T01:00:00.000Z'));
    const { db, ref, statusRef } = makeJobDb();

    const job = await startJobRun(db as any, {
      kind: 'export',
      name: 'full-export-sql',
      requestedBy: { uid: 'admin-1', role: 'admin', name: 'Admin One' },
      params: { format: 'sql', reason: 'monthly backup' },
    });

    expect(job).toMatchObject({ id: 'job-1', startedAt: '2026-05-21T01:00:00.000Z' });
    expect(ref.set).toHaveBeenCalledWith({
      kind: 'export' satisfies LightweightJobKind,
      name: 'full-export-sql',
      status: 'running',
      attempts: 1,
      requestedBy: { uid: 'admin-1', role: 'admin', name: 'Admin One' },
      params: { format: 'sql', reason: 'monthly backup' },
      createdAt: '2026-05-21T01:00:00.000Z',
      startedAt: '2026-05-21T01:00:00.000Z',
      updatedAt: '2026-05-21T01:00:00.000Z',
      schemaVersion: 1,
    });
    expect(statusRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'full-export-sql',
        status: 'running',
        startedAt: '2026-05-21T01:00:00.000Z',
      }),
      { merge: true }
    );
    vi.useRealTimers();
  });

  it('completes a job run with bounded result metadata and duration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T01:00:05.000Z'));
    const { db, ref } = makeJobDb();
    const job = { id: 'job-1', ref: ref as any, startedAt: '2026-05-21T01:00:00.000Z' };

    await completeJobRun(db as any, job, {
      rows: 1200,
      nested: { collection: 'students' },
      ignored: undefined,
    });

    expect(ref.update).toHaveBeenCalledWith({
      status: 'completed',
      result: { rows: 1200, nested: { collection: 'students' } },
      completedAt: '2026-05-21T01:00:05.000Z',
      durationMs: 5000,
      updatedAt: '2026-05-21T01:00:05.000Z',
    });
    vi.useRealTimers();
  });

  it('fails a job run without leaking stack traces into the job document', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T01:00:02.000Z'));
    const { db, ref } = makeJobDb();
    const err = new Error('Gateway timed out');
    err.stack = 'stack should not be persisted';

    await failJobRun(
      db as any,
      { id: 'job-1', ref: ref as any, startedAt: '2026-05-21T01:00:00.000Z' },
      err
    );

    expect(ref.update).toHaveBeenCalledWith({
      status: 'failed',
      error: { message: 'Gateway timed out' },
      completedAt: '2026-05-21T01:00:02.000Z',
      durationMs: 2000,
      updatedAt: '2026-05-21T01:00:02.000Z',
    });
    vi.useRealTimers();
  });
});
