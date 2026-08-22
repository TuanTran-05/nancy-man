import { describe, expect, it } from 'vitest';
import {
  createDocumentStoreTransactionHarness,
  makeDocumentStoreDocSnapshot,
  makeDocumentStoreQuerySnapshot,
} from './testDocumentStoreMocks.js';

describe('makeDocumentStoreDocSnapshot', () => {
  it('exposes stable document metadata and clones data reads', async () => {
    const snapshot = makeDocumentStoreDocSnapshot({
      id: 'student-1',
      path: 'students/student-1',
      data: { name: 'Student One' },
    });

    expect(snapshot.id).toBe('student-1');
    expect(snapshot.exists).toBe(true);
    expect(snapshot.ref).toMatchObject({ id: 'student-1', path: 'students/student-1' });
    expect(snapshot.data()).toEqual({ name: 'Student One' });
    expect(await snapshot.ref.get()).toBe(snapshot);
    expect(snapshot.updateTime.toDate().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves an explicit DocumentStore update time and returns fresh Date instances', () => {
    const snapshot = makeDocumentStoreDocSnapshot({
      id: 'evaluation-1',
      data: { evaluationType: 'final' },
      updateTime: '2026-07-18T08:30:00.000Z',
    });

    const first = snapshot.updateTime.toDate();
    const second = snapshot.updateTime.toDate();
    expect(first.toISOString()).toBe('2026-07-18T08:30:00.000Z');
    expect(second).not.toBe(first);
  });

  it('models a missing document without inventing data', () => {
    const snapshot = makeDocumentStoreDocSnapshot({
      id: 'missing',
      exists: false,
      data: { shouldNotLeak: true },
    });

    expect(snapshot.exists).toBe(false);
    expect(snapshot.data()).toBeUndefined();
  });

  it('allows distinct snapshots to carry distinct document versions', () => {
    const before = makeDocumentStoreDocSnapshot({
      id: 'evaluation-1',
      data: {},
      updateTime: '2026-07-18T08:00:00.000Z',
    });
    const after = makeDocumentStoreDocSnapshot({
      id: 'evaluation-1',
      data: {},
      updateTime: '2026-07-18T09:00:00.000Z',
    });

    expect(before.updateTime.toDate().toISOString()).not.toBe(
      after.updateTime.toDate().toISOString(),
    );
  });
});

describe('makeDocumentStoreQuerySnapshot', () => {
  it('exposes deterministic query metadata and iteration', () => {
    const docs = [
      makeDocumentStoreDocSnapshot({ id: 'one', data: { value: 1 } }),
      makeDocumentStoreDocSnapshot({ id: 'two', data: { value: 2 } }),
    ];
    const query = makeDocumentStoreQuerySnapshot(docs);
    const visited: string[] = [];
    query.forEach((doc) => visited.push(doc.id));

    expect(query.docs).toBe(docs);
    expect(query.size).toBe(2);
    expect(query.empty).toBe(false);
    expect(visited).toEqual(['one', 'two']);
  });
});

describe('createDocumentStoreTransactionHarness', () => {
  it('runs callbacks, delegates document and query reads, and records writes in order', async () => {
    const document = makeDocumentStoreDocSnapshot({ id: 'student-1', data: { name: 'Student' } });
    const query = makeDocumentStoreQuerySnapshot([document]);
    const documentTarget = document.ref;
    const queryTarget = { get: async () => query };
    const ref = { id: 'class-1', path: 'classes/class-1' };
    const harness = createDocumentStoreTransactionHarness();

    const result = await harness.runTransaction(async (tx) => {
      expect(await tx.get(documentTarget)).toBe(document);
      expect(await tx.get(queryTarget)).toBe(query);
      tx.set(ref, { name: 'Class' });
      tx.update(ref, { status: 'active' });
      tx.delete(ref);
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(harness.writes).toEqual([
      { type: 'set', ref, data: { name: 'Class' }, options: undefined },
      { type: 'update', ref, data: { status: 'active' } },
      { type: 'delete', ref },
    ]);
  });

  it('lets a supplied read hook model DocumentStore-specific targets', async () => {
    const target = { kind: 'aggregate-query' };
    const harness = createDocumentStoreTransactionHarness({
      onGet: async (received) => ({ received }),
    });

    await expect(harness.transaction.get(target)).resolves.toEqual({ received: target });
  });
});
