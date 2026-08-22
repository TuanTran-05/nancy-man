import { describe, expect, it, vi } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { writeCourseFeeLedgers } from './courseLedgerWriter.js';

function planned(studentId: string) {
  return {
    ledgerId: `${studentId}_c1_2026-01-05_2026-06-05`,
    studentId,
    enrollmentId: `enr-${studentId}`,
    termStart: '2026-01-05',
    termEnd: '2026-06-05' as string | null,
    amount: 900_000,
  };
}

function makeDb(commitBehaviour: Array<'ok' | 'fail'>) {
  const batches: Array<{ create: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> }> = [];
  let index = 0;
  const db = {
    batch: () => {
      const outcome = commitBehaviour[index++] ?? 'ok';
      const batch = {
        create: vi.fn(),
        commit: vi.fn(() =>
          outcome === 'ok' ? Promise.resolve() : Promise.reject(new Error('already exists'))
        ),
      };
      batches.push(batch);
      return batch;
    },
    collection: () => ({ doc: (id: string) => ({ id }) }),
  } as unknown as DocumentStore;
  return { db, batches };
}

describe('writeCourseFeeLedgers', () => {
  it('creates one document per planned ledger with the full shape', async () => {
    const { db, batches } = makeDb(['ok']);

    const result = await writeCourseFeeLedgers(db, [{ classId: 'c1', ledger: planned('s1') }]);

    expect(result.createdCount).toBe(1);
    expect(result.affectedStudentIds).toEqual(['s1']);
    expect(batches[0].create).toHaveBeenCalledTimes(1);
    expect(batches[0].create.mock.calls[0][1]).toMatchObject({
      studentId: 's1',
      classId: 'c1',
      amount: 900_000,
      paidTotal: 0,
      discountTotal: 0,
      status: 'unpaid',
      termStart: '2026-01-05',
      termEnd: '2026-06-05',
      /** Two weeks after the course starts — the date the notice already promises parents. */
      dueDate: '2026-01-19',
      source: 'course',
      periodType: 'course',
      enrollmentId: 'enr-s1',
    });
  });

  it('splits work into chunks of the requested size', async () => {
    const { db, batches } = makeDb(['ok', 'ok']);

    await writeCourseFeeLedgers(
      db,
      [
        { classId: 'c1', ledger: planned('s1') },
        { classId: 'c1', ledger: planned('s2') },
        { classId: 'c1', ledger: planned('s3') },
      ],
      2
    );

    expect(batches).toHaveLength(2);
    expect(batches[0].create).toHaveBeenCalledTimes(2);
    expect(batches[1].create).toHaveBeenCalledTimes(1);
  });

  it('counts nothing from a chunk whose commit failed and keeps going', async () => {
    const { db } = makeDb(['fail', 'ok']);

    const result = await writeCourseFeeLedgers(
      db,
      [
        { classId: 'c1', ledger: planned('s1') },
        { classId: 'c2', ledger: planned('s2') },
      ],
      1
    );

    expect(result.createdCount).toBe(1);
    expect(result.affectedStudentIds).toEqual(['s2']);
    expect(result.errors).toEqual([{ classId: 'c1', message: 'already exists' }]);
  });

  it('keeps createdAmount in step with createdCount when a chunk fails', async () => {
    const { db } = makeDb(['fail', 'ok']);

    const result = await writeCourseFeeLedgers(
      db,
      [
        { classId: 'c1', ledger: planned('s1') },
        { classId: 'c2', ledger: planned('s2') },
      ],
      1
    );

    expect(result.createdCount).toBe(1);
    expect(result.createdAmount).toBe(900_000);
  });

  it('does not touch DocumentStore when there is nothing to write', async () => {
    const { db, batches } = makeDb([]);

    const result = await writeCourseFeeLedgers(db, []);

    expect(batches).toHaveLength(0);
    expect(result).toEqual({
      createdCount: 0,
      createdAmount: 0,
      affectedStudentIds: [],
      errors: [],
    });
  });
});
