import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore, DOCUMENT_ID_FIELD } from './inMemoryDocumentStore.js';

/**
 * Tests for the fake itself.
 *
 * The fake is what other suites use to decide whether a read is bounded. If it
 * cannot report the shape of the query it was asked for, "this endpoint pages
 * instead of scanning the collection" is not a property any test can check —
 * every full scan and every bounded page look identical from the outside,
 * because both return the right rows.
 */
describe('inMemoryDocumentStore query bounds', () => {
  it('records the shape of each query, including its limit', async () => {
    const { db, queryLog } = createInMemoryDocumentStore({
      'students/a': { name: 'A' },
      'students/b': { name: 'B' },
    });

    await (db as never as FakeDb).collection('students').orderBy(DOCUMENT_ID_FIELD).limit(1).get();

    expect(queryLog).toContainEqual({
      collection: 'students',
      filters: [],
      order: DOCUMENT_ID_FIELD,
      after: undefined,
      take: 1,
    });
  });

  it('records the filters a query carries, so an `in` chunk size is observable', async () => {
    const { db, queryLog } = createInMemoryDocumentStore({
      'student_course_enrollments/e1': { studentId: 'a', status: 'active' },
    });

    await (db as never as FakeDb)
      .collection('student_course_enrollments')
      .where('studentId', 'in', ['a', 'b'])
      .get();

    expect(queryLog).toContainEqual(
      expect.objectContaining({
        collection: 'student_course_enrollments',
        filters: [['studentId', 'in', ['a', 'b']]],
      })
    );
  });

  it('reads a batch of references through getAll and logs each one', async () => {
    const { db, readLog } = createInMemoryDocumentStore({
      'students/a': { name: 'A' },
      'students/b': { name: 'B' },
    });

    const fake = db as never as FakeDb;
    const snapshots = await fake.getAll(
      fake.collection('students').doc('a'),
      fake.collection('students').doc('b')
    );

    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['a', 'b']);
    expect(readLog).toEqual(expect.arrayContaining(['students/a', 'students/b']));
  });
});

type FakeDb = {
  collection: (name: string) => {
    doc: (id: string) => { get: () => Promise<{ id: string }> };
    orderBy: (field: string) => { limit: (n: number) => { get: () => Promise<unknown> } };
    where: (field: string, op: string, value: unknown) => { get: () => Promise<unknown> };
  };
  getAll: (...refs: Array<{ get: () => Promise<{ id: string }> }>) => Promise<Array<{ id: string }>>;
};
