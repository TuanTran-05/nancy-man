import { describe, expect, it } from 'vitest';
import { attachSiblingGroupMembers } from './readers.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

type Snapshot = AppDocumentStore.QueryDocumentSnapshot;

function seedOf(students: Record<string, Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(students).map(([id, data]) => [`students/${id}`, data])
  );
}

async function pageOf(db: AppDocumentStore.DocumentStore, ids: string[]): Promise<Snapshot[]> {
  const snapshot = await db.collection('students').get();
  const byId = new Map(snapshot.docs.map((doc) => [doc.id, doc as unknown as Snapshot]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

const FAMILY = {
  a: { name: 'An', siblingGroupId: 'g1' },
  b: { name: 'Binh', siblingGroupId: 'g1' },
};

function alias(legacyId: string, canonicalId: string) {
  return {
    [`student_profile_aliases/${legacyId}`]: {
      legacyProfileId: legacyId,
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: 't',
      createdBy: 'merge',
    },
  };
}

describe('attachSiblingGroupMembers', () => {
  it('returns the page unchanged when nobody has a group', async () => {
    const { db } = createInMemoryDocumentStore(seedOf({ x: { name: 'Khanh' } }));
    const result = await attachSiblingGroupMembers(db, await pageOf(db, ['x']));
    expect(result.map((doc) => doc.id)).toEqual(['x']);
  });

  it('adds a missing group member', async () => {
    const { db } = createInMemoryDocumentStore(seedOf(FAMILY));
    const result = await attachSiblingGroupMembers(db, await pageOf(db, ['a']));
    expect(result.map((doc) => doc.id)).toEqual(['a', 'b']);
  });

  it('does not duplicate a member already on the page', async () => {
    const { db } = createInMemoryDocumentStore(seedOf(FAMILY));
    const result = await attachSiblingGroupMembers(db, await pageOf(db, ['a', 'b']));
    expect(result.map((doc) => doc.id)).toEqual(['a', 'b']);
  });

  it('queries each distinct group only once', async () => {
    const { db, readLog } = createInMemoryDocumentStore(seedOf(FAMILY));
    const page = await pageOf(db, ['a', 'b']);
    readLog.length = 0;

    await attachSiblingGroupMembers(db, page);

    expect(readLog.filter((entry) => entry === 'query:students')).toHaveLength(1);
  });

  it('preserves the original page order at the front', async () => {
    const { db } = createInMemoryDocumentStore(seedOf({ ...FAMILY, x: { name: 'Khanh' } }));
    const result = await attachSiblingGroupMembers(db, await pageOf(db, ['x', 'a']));
    expect(result.map((doc) => doc.id)).toEqual(['x', 'a', 'b']);
  });

  it('adds one row for a sibling whose retired profile is still in the group', async () => {
    // Both documents carry the family's group id, so the group query returns
    // two rows for one child. Deduplicating by document id keeps both, which
    // is the duplicate showing up in a family list.
    const { db } = createInMemoryDocumentStore({
      ...seedOf({
        a: { name: 'An', siblingGroupId: 'g1' },
        'b-canonical': { name: 'Binh', siblingGroupId: 'g1' },
        'b-legacy': { name: 'Binh (cũ)', siblingGroupId: 'g1' },
      }),
      ...alias('b-legacy', 'b-canonical'),
    });

    const result = await attachSiblingGroupMembers(db, await pageOf(db, ['a']));

    expect(result.map((doc) => doc.id)).toEqual(['a', 'b-canonical']);
  });

  it('keeps a page row that is itself a retired profile without adding its twin twice', async () => {
    // The caller's page can contain a retired id: it came from a historical
    // record. The group must still contribute exactly one row for that human.
    const { db } = createInMemoryDocumentStore({
      ...seedOf({
        a: { name: 'An', siblingGroupId: 'g1' },
        'b-canonical': { name: 'Binh', siblingGroupId: 'g1' },
        'b-legacy': { name: 'Binh (cũ)', siblingGroupId: 'g1' },
      }),
      ...alias('b-legacy', 'b-canonical'),
    });

    const result = await attachSiblingGroupMembers(db, await pageOf(db, ['a', 'b-legacy']));

    expect(result.map((doc) => doc.id)).toEqual(['a', 'b-legacy']);
  });
});
