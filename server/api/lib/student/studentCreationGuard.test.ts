import { describe, expect, it } from 'vitest';
import {
  assertStudentCreationAllowed,
  assertStudentCreationAllowedInTransaction,
  findExactHumanConflict,
  findExactHumanConflictInTransaction,
} from './studentCreationGuard.js';

const HUMAN = { name: 'Quách Hoàng Minh', dob: '2014-05-02', contact: '0900000000' };

/**
 * DocumentStore stub whose equality query behaves like the real one: documents
 * missing the queried field are simply absent from the result, never returned
 * with an empty value.
 */
function makeDb(
  students: Array<{ id: string; data: Record<string, unknown> }>,
  aliases: Record<string, string> = {},
  coverage = { missingOrStale: 0 }
) {
  return {
    coverage,
    doc(path: string) {
      return {
        path,
        async get() {
          const [collection, id] = path.split('/');
          if (collection === 'student_profile_aliases') {
            const target = aliases[id];
            return {
              exists: target !== undefined,
              data: () => ({
                legacyProfileId: id,
                canonicalProfileId: target,
                mergeRunId: 'run-1',
                reasonCode: 'profile_normalization',
                sourceFingerprint: 'a'.repeat(64),
                createdAt: 't',
                createdBy: 'merge',
              }),
            };
          }
          const found = students.find((student) => student.id === id);
          return { exists: Boolean(found), data: () => found?.data };
        },
      };
    },
    collection() {
      const filters: Array<[string, unknown]> = [];
      const query = {
        where(field: string, _op: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
        limit() {
          return query;
        },
        async get() {
          const matched = students.filter((student) =>
            // A DocumentStore equality query omits a document that lacks the field
            // entirely; reproducing that here is the whole point of the stub.
            filters.every(([field, value]) => student.data[field] === value)
          );
          return { empty: matched.length === 0, docs: matched.map((s) => ({ id: s.id, data: () => s.data })) };
        },
      };
      return query;
    },
  } as never;
}

const COMPLETE = {
  ...HUMAN,
  admissionSearchName: 'quach hoang minh',
  admissionSearchDob: '2014-05-02',
  admissionSearchContact: '84900000000',
};

describe('exact-human conflict detection', () => {
  it('finds no conflict when nobody matches', async () => {
    // A genuinely different human. Changing only the denormalized field would
    // not make this a different person — the guard recomputes from the raw
    // fields precisely so a stale denormalized value cannot hide a match.
    const db = makeDb([
      {
        id: 'other',
        data: {
          name: 'Nguyễn An',
          dob: '2015-03-03',
          contact: '0911111111',
          admissionSearchName: 'nguyen an',
          admissionSearchDob: '2015-03-03',
          admissionSearchContact: '84911111111',
        },
      },
    ]);

    await expect(findExactHumanConflict(db, HUMAN)).resolves.toBeNull();
  });

  it('blocks creation when the same human already exists', async () => {
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]);

    await expect(findExactHumanConflict(db, HUMAN)).resolves.toMatchObject({
      canonicalProfileId: 'canonical-1',
    });
  });

  it('blocks across classes and lifecycle states', async () => {
    const db = makeDb([
      { id: 'canonical-1', data: { ...COMPLETE, classId: 'c-9', studentLifecycle: 'archived' } },
    ]);

    await expect(findExactHumanConflict(db, HUMAN)).resolves.toMatchObject({
      canonicalProfileId: 'canonical-1',
    });
  });

  it('resolves a matched alias to its canonical profile', async () => {
    const db = makeDb(
      [
        { id: 'legacy-1', data: COMPLETE },
        { id: 'canonical-1', data: COMPLETE },
      ],
      { 'legacy-1': 'canonical-1' }
    );

    const conflict = await findExactHumanConflict(db, HUMAN);

    expect(conflict?.canonicalProfileId).toBe('canonical-1');
  });

  it('throws when matches map to two different canonical profiles', async () => {
    // Two live humans indistinguishable on all three fields is a data problem
    // a human must look at, not something to resolve by picking one.
    const db = makeDb([
      { id: 'canonical-1', data: COMPLETE },
      { id: 'canonical-2', data: COMPLETE },
    ]);

    await expect(findExactHumanConflict(db, HUMAN)).rejects.toThrow(
      'STUDENT_IDENTITY_DATA_INCONSISTENT'
    );
  });

  it('ignores a tombstoned match whose canonical twin is the same profile', async () => {
    const db = makeDb(
      [
        { id: 'legacy-1', data: { ...COMPLETE, studentProfileState: 'merged_tombstone' } },
        { id: 'canonical-1', data: COMPLETE },
      ],
      { 'legacy-1': 'canonical-1' }
    );

    const conflict = await findExactHumanConflict(db, HUMAN);

    expect(conflict?.canonicalProfileId).toBe('canonical-1');
  });
});

describe('profiles missing denormalized fields', () => {
  it('still blocks when the stored profile has no admissionSearch fields', async () => {
    // This is the population the guard exists for: the clone path in
    // studentImportHelper.ts never wrote these fields, so an equality query
    // alone is blind to exactly the duplicates it is meant to catch.
    const db = makeDb([{ id: 'cloned', data: HUMAN }]);

    const conflict = await findExactHumanConflict(db, HUMAN);

    expect(conflict?.canonicalProfileId).toBe('cloned');
  });

  it('blocks when the stored profile has stale denormalized fields', async () => {
    const db = makeDb([
      { id: 'drifted', data: { ...COMPLETE, admissionSearchContact: '84900009999' } },
    ]);

    const conflict = await findExactHumanConflict(db, HUMAN);

    expect(conflict?.canonicalProfileId).toBe('drifted');
  });

  it('matches a name that differs only by diacritics and spacing', async () => {
    const db = makeDb([{ id: 'canonical-1', data: { ...HUMAN, name: '  quach   hoang  minh ' } }]);

    const conflict = await findExactHumanConflict(db, HUMAN);

    expect(conflict?.canonicalProfileId).toBe('canonical-1');
  });

  it('matches a contact written in a different phone format', async () => {
    const db = makeDb([{ id: 'canonical-1', data: { ...HUMAN, contact: '+84 900 000 000' } }]);

    const conflict = await findExactHumanConflict(db, HUMAN);

    expect(conflict?.canonicalProfileId).toBe('canonical-1');
  });
});

describe('partial matches are not conflicts', () => {
  it.each([
    ['name only', { ...HUMAN, dob: '2010-01-01', contact: '0911111111' }],
    ['dob only', { ...HUMAN, name: 'Nguyễn An', contact: '0911111111' }],
    ['contact only', { ...HUMAN, name: 'Nguyễn An', dob: '2010-01-01' }],
  ])('does not block on a %s match', async (_label, stored) => {
    // Siblings share a contact and twins share a birthday. Auto-linking these
    // would merge two real children.
    const db = makeDb([{ id: 'someone', data: stored }]);

    await expect(findExactHumanConflict(db, HUMAN)).resolves.toBeNull();
  });
});

describe('creation gate', () => {
  const ADMIN = { actorId: 'admin:tt', role: 'admin' as const };

  it('allows creation of a genuinely new human', async () => {
    const db = makeDb([]);

    await expect(assertStudentCreationAllowed(db, HUMAN, ADMIN)).resolves.toBeNull();
  });

  it('refuses creation when an exact human already exists', async () => {
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]);

    await expect(assertStudentCreationAllowed(db, HUMAN, ADMIN)).rejects.toThrow(
      'STUDENT_IDENTITY_REVIEW_REQUIRED'
    );
  });

  it('accepts an admin override that names the candidate and a reason', async () => {
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]);

    const audit = await assertStudentCreationAllowed(db, HUMAN, {
      ...ADMIN,
      override: {
        decision: 'confirmed_distinct_person',
        candidateProfileIds: ['canonical-1'],
        reason: 'twin sibling, verified by birth certificate',
      },
    });

    expect(audit).toMatchObject({
      decision: 'confirmed_distinct_person',
      candidateProfileIds: ['canonical-1'],
      actorId: 'admin:tt',
    });
  });

  it('refuses an override that names no candidate', async () => {
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]);

    await expect(
      assertStudentCreationAllowed(db, HUMAN, {
        ...ADMIN,
        override: { decision: 'confirmed_distinct_person', candidateProfileIds: [], reason: 'x' },
      })
    ).rejects.toThrow('STUDENT_IDENTITY_OVERRIDE_INVALID');
  });

  it('refuses an override with no reason', async () => {
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]);

    await expect(
      assertStudentCreationAllowed(db, HUMAN, {
        ...ADMIN,
        override: {
          decision: 'confirmed_distinct_person',
          candidateProfileIds: ['canonical-1'],
          reason: '   ',
        },
      })
    ).rejects.toThrow('STUDENT_IDENTITY_OVERRIDE_INVALID');
  });

  it('refuses an override naming a profile that is not the conflict', async () => {
    // Otherwise the override becomes a blanket bypass rather than a decision
    // about a specific pair of humans.
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]);

    await expect(
      assertStudentCreationAllowed(db, HUMAN, {
        ...ADMIN,
        override: {
          decision: 'confirmed_distinct_person',
          candidateProfileIds: ['someone-unrelated'],
          reason: 'x',
        },
      })
    ).rejects.toThrow('STUDENT_IDENTITY_OVERRIDE_INVALID');
  });

  it.each(['office', 'teacher', 'import', 'admissions'])(
    'refuses an override from a %s caller',
    async (role) => {
      const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]);

      await expect(
        assertStudentCreationAllowed(db, HUMAN, {
          actorId: `${role}:someone`,
          role: role as never,
          override: {
            decision: 'confirmed_distinct_person',
            candidateProfileIds: ['canonical-1'],
            reason: 'x',
          },
        })
      ).rejects.toThrow('STUDENT_IDENTITY_OVERRIDE_FORBIDDEN');
    }
  );
});

/**
 * Creation runs the guard inside the same transaction that writes the profile.
 * A guard that read outside it would decide against a snapshot the transaction
 * never validated, so two concurrent enrolments of the same child could each
 * see no conflict and each commit. The transactional variant must therefore
 * route every read through `tx.get` — the log below is the assertion.
 */
function makeTx(db: { doc: (path: string) => { get: () => Promise<unknown> } }) {
  const log: string[] = [];
  return {
    log,
    async get(target: { path?: string; get: () => Promise<unknown> }) {
      log.push(target.path ?? 'query');
      return target.get();
    },
  };
}

describe('transactional exact-human conflict detection', () => {
  it('routes every read through the transaction', async () => {
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]) as never as {
      doc: (path: string) => { get: () => Promise<unknown> };
    };
    const tx = makeTx(db);

    const conflict = await findExactHumanConflictInTransaction(tx as never, db as never, HUMAN);

    expect(conflict).toMatchObject({ canonicalProfileId: 'canonical-1' });
    // Two student queries plus the alias lookup for the one match.
    expect(tx.log).toEqual([
      'query',
      'query',
      'student_profile_aliases/canonical-1',
    ]);
  });

  it('reaches the same verdict as the database variant for a profile with no denormalized fields', async () => {
    // The cloned-profile case. Both variants must agree, or moving the guard
    // into the transaction would silently change who is allowed to be created.
    const cloned = [{ id: 'cloned-1', data: { ...HUMAN } }];
    const db = makeDb(cloned) as never;
    const tx = makeTx(db as never);

    await expect(findExactHumanConflict(db, HUMAN)).resolves.toMatchObject({
      canonicalProfileId: 'cloned-1',
    });
    await expect(findExactHumanConflictInTransaction(tx as never, db, HUMAN)).resolves.toMatchObject(
      { canonicalProfileId: 'cloned-1' }
    );
  });

  it('resolves an alias through the transaction rather than the database', async () => {
    const db = makeDb([{ id: 'legacy-1', data: COMPLETE }], { 'legacy-1': 'canonical-9' }) as never;
    const tx = makeTx(db as never);

    await expect(
      findExactHumanConflictInTransaction(tx as never, db, HUMAN)
    ).resolves.toMatchObject({ canonicalProfileId: 'canonical-9', matchedProfileIds: ['legacy-1'] });
  });

  it('blocks an unreviewed creation and returns the audit for a valid admin override', async () => {
    const db = makeDb([{ id: 'canonical-1', data: COMPLETE }]) as never;

    await expect(
      assertStudentCreationAllowedInTransaction(makeTx(db as never) as never, db, HUMAN, {
        actorId: 'office-1',
        role: 'office',
      })
    ).rejects.toThrow('STUDENT_IDENTITY_REVIEW_REQUIRED');

    await expect(
      assertStudentCreationAllowedInTransaction(makeTx(db as never) as never, db, HUMAN, {
        actorId: 'admin-1',
        role: 'admin',
        override: {
          decision: 'confirmed_distinct_person',
          candidateProfileIds: ['canonical-1'],
          reason: 'Two cousins, same name and phone; verified in person.',
        },
      })
    ).resolves.toMatchObject({
      decision: 'confirmed_distinct_person',
      candidateProfileIds: ['canonical-1'],
      actorId: 'admin-1',
    });
  });

  it('returns null when nobody matches, so creation proceeds', async () => {
    const db = makeDb([]) as never;

    await expect(
      assertStudentCreationAllowedInTransaction(makeTx(db as never) as never, db, HUMAN, {
        actorId: 'office-1',
        role: 'office',
      })
    ).resolves.toBeNull();
  });
});
