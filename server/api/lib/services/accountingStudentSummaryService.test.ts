import { describe, expect, it, vi } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { refreshAccountingStudentSummariesAfterCommit } from './accountingStudentSummaryService.js';

describe('refreshAccountingStudentSummariesAfterCommit', () => {
  it('rebuilds each unique student and invalidates snapshot health once', async () => {
    const context = { actorId: 'admin-1', operation: 'students:update' };
    const rebuild = vi.fn().mockResolvedValue({ studentId: 'student-1' });
    const invalidateSnapshotHealth = vi.fn().mockResolvedValue(undefined);
    const db = {
      collection: () => ({
        where: () => ({}),
        doc: () => ({ get: async () => ({ exists: true }) }),
      }),
    } as unknown as DocumentStore;

    const result = await refreshAccountingStudentSummariesAfterCommit(
      db,
      ['student-1', 'student-1', ''],
      'status-changed',
      context,
      { rebuild, invalidateSnapshotHealth }
    );

    expect(result).toEqual({ rebuilt: ['student-1'], queued: [], failed: [] });
    expect(rebuild).toHaveBeenCalledOnce();
    expect(rebuild).toHaveBeenCalledWith(db, 'student-1');
    expect(invalidateSnapshotHealth).toHaveBeenCalledOnce();
    expect(invalidateSnapshotHealth).toHaveBeenCalledWith(db, 'accounting:status-changed');
  });

  it('reports a student explicitly when both rebuild and retry queue fail', async () => {
    const context = { actorId: 'admin-1', operation: 'students:update' };
    const queue = vi.fn().mockRejectedValue(new Error('queue failed'));
    const db = {
      collection: () => ({
        where: () => ({}),
        doc: () => ({ get: async () => ({ exists: true }) }),
      }),
    } as unknown as DocumentStore;
    const result = await refreshAccountingStudentSummariesAfterCommit(
      db,
      ['student-1'],
      'test',
      context,
      {
        rebuild: vi.fn().mockRejectedValue(new Error('rebuild failed')),
        queue,
        invalidateSnapshotHealth: vi.fn().mockResolvedValue(undefined),
      }
    );
    expect(result).toEqual({ rebuilt: [], queued: [], failed: ['student-1'] });
    expect(queue).toHaveBeenCalledWith(db, 'student-1', 'test', context);
  });
});
