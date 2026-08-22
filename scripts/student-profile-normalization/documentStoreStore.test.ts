import { describe, expect, it } from 'vitest';
import { createDocumentStoreNormalizationStore } from './documentStoreStore.js';
import { fingerprintDocumentProjection } from './canonicalJson.js';
import { createInMemoryDocumentStore } from '../../test-utils/inMemoryDocumentStore.js';

/**
 * The engine's only door to production.
 *
 * `writer.ts` and `rollback.ts` are written against a three-method port, and
 * until now nothing implemented that port outside a test — so the merge engine
 * could apply operations to a fake and nothing else. Everything the engine
 * relies on has to survive the trip through this adapter: a document read back
 * with the fingerprint the engine will compare against, a missing document
 * reported as missing rather than as empty, and writes that only land if the
 * transaction commits.
 */

describe('createDocumentStoreNormalizationStore', () => {
  it('reads a document with the fingerprint the engine compares against', async () => {
    const data = { amount: 1000, studentId: 'canonical-1' };
    const { db } = createInMemoryDocumentStore({ 'course_fee_ledgers/led-1': data });
    const store = createDocumentStoreNormalizationStore(db as never);

    const read = await store.runTransaction((tx) => tx.get('course_fee_ledgers/led-1'));

    expect(read).toMatchObject({ data });
    expect(read?.fingerprint).toBe(fingerprintDocumentProjection(data));
  });

  it('reports a missing document as missing, not as an empty one', async () => {
    // The engine treats an empty document and an absent one differently: one
    // is drift, the other is a document it may still create.
    const { db } = createInMemoryDocumentStore({});
    const store = createDocumentStoreNormalizationStore(db as never);

    const read = await store.runTransaction((tx) => tx.get('course_fee_ledgers/nope'));

    expect(read).toBeNull();
  });

  it('commits what the transaction set and removes what it deleted', async () => {
    const { db, store: docs } = createInMemoryDocumentStore({
      'students/legacy-1': { name: 'old' },
    });
    const store = createDocumentStoreNormalizationStore(db as never);

    await store.runTransaction(async (tx) => {
      tx.set('students/canonical-1', {
        data: { name: 'new' },
        fingerprint: fingerprintDocumentProjection({ name: 'new' }),
      });
      tx.delete('students/legacy-1');
    });

    expect(docs.get('students/canonical-1')).toMatchObject({ name: 'new' });
    expect(docs.has('students/legacy-1')).toBe(false);
  });

  it('writes nothing when the transaction body throws', async () => {
    // Half an operation is worse than none: the engine's journal and the
    // documents it names have to move together or not at all.
    const { db, store: docs } = createInMemoryDocumentStore({});
    const store = createDocumentStoreNormalizationStore(db as never);

    await expect(
      store.runTransaction(async (tx) => {
        tx.set('students/canonical-1', { data: { name: 'new' }, fingerprint: 'f' });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(docs.has('students/canonical-1')).toBe(false);
  });
});
