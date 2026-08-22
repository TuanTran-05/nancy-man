import { describe, expect, it, vi } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { generateCourseFeeLedgers } from './classHelpers.js';

type Doc = { id: string; data: Record<string, unknown> };

function snap(doc: Doc) {
  return { id: doc.id, exists: true, data: () => doc.data, ref: { id: doc.id } };
}

/**
 * `assertValidStudentCourseEnrollment` requires the doc id to equal
 * makeStudentCourseEnrollmentId(studentId, classId, termStart), so fixtures
 * must derive it rather than hand-write one.
 */
function enrollmentDoc(studentId: string, classId: string, overrides: Record<string, unknown> = {}): Doc {
  const termStart = String(overrides.termStart || '2026-01-05');
  return {
    id: makeStudentCourseEnrollmentId(studentId, classId, termStart),
    data: {
      studentId,
      classId,
      termStart,
      termEnd: '2026-06-05',
      status: 'active',
      joinedAt: termStart,
      endedAt: null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      ...overrides,
    },
  };
}

function makeDb(seed: { classes: Doc[]; enrollments: Doc[]; ledgers: Doc[] }) {
  const batches: Array<{ create: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> }> = [];
  const db = {
    batch: () => {
      const batch = { create: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      batches.push(batch);
      return batch;
    },
    collection(name: string) {
      if (name === 'classes') {
        return {
          doc: (id: string) => ({
            get: async () => {
              const found = seed.classes.find((row) => row.id === id);
              return found ? snap(found) : { id, exists: false, data: () => undefined };
            },
          }),
          orderBy: () => ({
            limit: (n: number) => ({
              get: async () => ({ docs: seed.classes.slice(0, n).map(snap) }),
            }),
            startAfter: () => ({
              limit: (n: number) => ({
                get: async () => ({ docs: seed.classes.slice(0, n).map(snap) }),
              }),
            }),
          }),
        };
      }
      const rows = name === 'student_course_enrollments' ? seed.enrollments : seed.ledgers;
      return {
        doc: (id: string) => ({ id }),
        where: (_field: string, _op: string, value: string) => ({
          get: async () => ({ docs: rows.filter((row) => row.data.classId === value).map(snap) }),
        }),
      };
    },
  } as unknown as DocumentStore;
  return { db, batches };
}

const g3 = { id: 'c1', data: { name: 'G3', status: 'active', tuitionFee: 900_000 } };

describe('generateCourseFeeLedgers', () => {
  it('does not write in preview mode', async () => {
    const { db, batches } = makeDb({
      classes: [g3],
      enrollments: [enrollmentDoc('s1', 'c1')],
      ledgers: [],
    });

    const result = await generateCourseFeeLedgers(db, { mode: 'preview' });

    expect(batches).toHaveLength(0);
    expect(result.mode).toBe('preview');
    expect(result.createdCount).toBe(1);
    expect(result.totalAmount).toBe(900_000);
    expect(result.affectedStudentIds).toEqual([]);
  });

  it('never reads the students collection', async () => {
    const { db } = makeDb({
      classes: [g3],
      enrollments: [enrollmentDoc('s1', 'c1')],
      ledgers: [],
    });
    const collectionSpy = vi.spyOn(db, 'collection');

    await generateCourseFeeLedgers(db, { mode: 'preview' });

    expect(collectionSpy.mock.calls.map((call) => call[0])).not.toContain('students');
  });

  it('writes and reports only students that received a ledger', async () => {
    const { db, batches } = makeDb({
      classes: [g3],
      enrollments: [enrollmentDoc('s1', 'c1'), enrollmentDoc('s2', 'c1')],
      ledgers: [{ id: 'old', data: { classId: 'c1', studentId: 's2', termStart: '2026-01-05' } }],
    });

    const result = await generateCourseFeeLedgers(db, { mode: 'apply' });

    expect(result.createdCount).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.affectedStudentIds).toEqual(['s1']);
    expect(batches[0].create).toHaveBeenCalledTimes(1);
  });

  it('rebuilds nothing when every enrollment already has a ledger', async () => {
    const { db } = makeDb({
      classes: [g3],
      enrollments: [enrollmentDoc('s1', 'c1')],
      ledgers: [
        { id: 'stale-term-end', data: { classId: 'c1', studentId: 's1', termStart: '2026-01-05' } },
      ],
    });

    const result = await generateCourseFeeLedgers(db, { mode: 'apply' });

    expect(result.createdCount).toBe(0);
    expect(result.affectedStudentIds).toEqual([]);
  });

  it('records a skip reason per class instead of hiding it', async () => {
    const { db } = makeDb({
      classes: [
        { id: 'c1', data: { name: 'Archived', status: 'archived', tuitionFee: 900_000 } },
        { id: 'c2', data: { name: 'No fee', status: 'active', tuitionFee: 0 } },
      ],
      enrollments: [],
      ledgers: [],
    });

    const result = await generateCourseFeeLedgers(db, { mode: 'preview' });

    expect(result.skippedClasses).toBe(2);
    expect(result.plan.map((row) => row.skipReason)).toEqual([
      'class_archived',
      'tuition_not_configured',
    ]);
  });

  it('surfaces pre-existing duplicates', async () => {
    const { db } = makeDb({
      classes: [g3],
      enrollments: [enrollmentDoc('s1', 'c1')],
      ledgers: [
        { id: 'a', data: { classId: 'c1', studentId: 's1', termStart: '2026-01-05' } },
        { id: 'b', data: { classId: 'c1', studentId: 's1', termStart: '2026-01-05' } },
      ],
    });

    const result = await generateCourseFeeLedgers(db, { mode: 'preview' });

    expect(result.duplicateLedgers).toEqual([
      { classId: 'c1', studentId: 's1', termStart: '2026-01-05', ledgerIds: ['a', 'b'] },
    ]);
  });

  it('keeps going when one class throws', async () => {
    const { db } = makeDb({
      classes: [
        { id: 'c1', data: { name: 'Boom', status: 'active', tuitionFee: 900_000 } },
        { id: 'c2', data: { name: 'G3', status: 'active', tuitionFee: 900_000 } },
      ],
      enrollments: [enrollmentDoc('s1', 'c2')],
      ledgers: [],
    });
    const original = db.collection.bind(db);
    vi.spyOn(db, 'collection').mockImplementation(((name: string) => {
      if (name === 'student_course_enrollments') {
        return {
          where: (_f: string, _o: string, value: string) => ({
            get: async () => {
              if (value === 'c1') throw new Error('read failed');
              return { docs: [snap(enrollmentDoc('s1', 'c2'))] };
            },
          }),
        };
      }
      return original(name);
    }) as never);

    const result = await generateCourseFeeLedgers(db, { mode: 'preview' });

    expect(result.errors).toEqual([{ classId: 'c1', message: 'read failed' }]);
    expect(result.createdCount).toBe(1);
  });

  it('rejects preview for the enrollment branch', async () => {
    const { db } = makeDb({ classes: [g3], enrollments: [], ledgers: [] });

    await expect(
      generateCourseFeeLedgers(db, { mode: 'preview', enrollmentIds: ['whatever'] })
    ).rejects.toThrow(/preview/i);
  });
});
