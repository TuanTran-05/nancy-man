import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveLinkedStudentProfileId,
  selectStudentAuthProfile,
} from './canonicalAuthIdentity.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

type Seed = Record<string, Record<string, unknown>>;

function profile(id: string, overrides: Record<string, unknown> = {}): Seed {
  return {
    [`students/${id}`]: {
      name: `Học Sinh ${id}`,
      studentId: 'HS0001',
      enrollmentStatus: 'promoted',
      studentLifecycle: 'enrolled',
      ...overrides,
    },
  };
}

function alias(legacyId: string, canonicalId: string): Seed {
  return {
    [`student_profile_aliases/${legacyId}`]: {
      legacyProfileId: legacyId,
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: '2026-08-01T00:00:00.000Z',
      createdBy: 'merge',
    },
  };
}

function tombstone(id: string, canonicalId: string): Seed {
  return {
    [`students/${id}`]: {
      name: '',
      studentProfileState: 'merged_tombstone',
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      mergedAt: '2026-08-01T00:00:00.000Z',
      identityWriteDisabled: true,
      authDisabled: true,
      walletOwnership: 'canonicalized',
      tombstoneSourceFingerprint: 'b'.repeat(64),
    },
  };
}

function registry(code: string, canonicalId: string, status = 'active'): Seed {
  return {
    [`student_code_registry/${code}`]: {
      normalizedCode: code,
      canonicalProfileId: canonicalId,
      isPrimary: status === 'active',
      status,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      createdBy: 'merge',
      updatedBy: 'merge',
    },
  };
}

/**
 * The production shape: one child, two documents, one code. The retired half
 * is the one the old heuristic prefers, because it is the one still marked
 * `active` — the promotion wrote the new row as `promoted`.
 */
function duplicateCodeSeed(): Seed {
  return {
    ...profile('canonical-1', { enrollmentStatus: 'promoted' }),
    ...profile('legacy-1', { enrollmentStatus: 'active' }),
  };
}

function candidatesOf(seed: Seed) {
  return Object.entries(seed)
    .filter(([path]) => path.startsWith('students/'))
    .map(([path, data]) => ({ id: path.slice('students/'.length), data }));
}

describe('selectStudentAuthProfile', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps the legacy winner in legacy_compare so nobody is locked out', async () => {
    // Shadow mode must not change who can log in. The retired document is the
    // one that currently holds the credentials, and preferring the canonical
    // profile before those credentials have moved would lock out a real family.
    const seed = { ...duplicateCodeSeed(), ...alias('legacy-1', 'canonical-1') };
    const { db } = createInMemoryDocumentStore(seed);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS0001',
      candidates: candidatesOf(duplicateCodeSeed()),
      mode: 'legacy_compare',
      surface: 'student_login',
    });

    expect(selection).toEqual({
      profileId: 'legacy-1',
      legacyProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
      redirected: false,
    });
    const logged = info.mock.calls.map((call) => String(call[1]));
    expect(logged.join()).toContain('LEGACY_PHYSICAL_DUPLICATE');
    // Never a name, a code, or anything else a log reader could not already
    // see in the id list.
    expect(logged.join()).not.toContain('Học Sinh');
    expect(logged.join()).not.toContain('HS0001');
  });

  it('logs nothing when the legacy and canonical answers already agree', async () => {
    const seed = profile('canonical-1', { enrollmentStatus: 'active' });
    const { db } = createInMemoryDocumentStore(seed);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS0001',
      candidates: candidatesOf(seed),
      mode: 'legacy_compare',
      surface: 'student_login',
    });

    expect(selection?.profileId).toBe('canonical-1');
    expect(info).not.toHaveBeenCalled();
  });

  it('authenticates the surviving profile once canonical reads are preferred', async () => {
    // The heuristic picks `legacy-1` because it is the one still marked active.
    // That is the retired half of a merged child: its credentials were moved.
    const seed = { ...duplicateCodeSeed(), ...alias('legacy-1', 'canonical-1') };
    const { db } = createInMemoryDocumentStore(seed);

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS0001',
      candidates: candidatesOf(duplicateCodeSeed()),
      mode: 'canonical_preferred',
      surface: 'student_login',
    });

    expect(selection).toEqual({
      profileId: 'canonical-1',
      legacyProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
      redirected: true,
    });
  });

  it('refuses the login when one code is carried by two unmerged profiles', async () => {
    // No alias and no registry entry: nothing records which of the two is the
    // human logging in. Picking one would hand a family somebody else's record.
    const seed = duplicateCodeSeed();
    const { db } = createInMemoryDocumentStore(seed);

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS0001',
      candidates: candidatesOf(seed),
      mode: 'canonical_preferred',
      surface: 'student_login',
    });

    expect(selection).toBeNull();
  });

  it('honours a retired code through the registry', async () => {
    // An old code kept working on purpose: a family that still types the code
    // printed on last year's receipt must reach the same child.
    const seed = {
      ...profile('canonical-1', { studentId: 'HS0002' }),
      ...registry('HS0001', 'canonical-1', 'retired'),
    };
    const { db } = createInMemoryDocumentStore(seed);

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS0001',
      // The code query finds nothing: no live profile carries this code now.
      candidates: [],
      mode: 'canonical_preferred',
      surface: 'student_login',
    });

    expect(selection?.profileId).toBe('canonical-1');
  });

  it('never authenticates against a tombstone', async () => {
    // The tombstone still answers the code query and still carries
    // `enrollmentStatus: 'active'`, so the old heuristic prefers it. Its
    // `authDisabled` flag is the record that its access was withdrawn.
    const seed = {
      ...tombstone('legacy-1', 'canonical-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...profile('canonical-1'),
    };
    const { db } = createInMemoryDocumentStore(seed);
    const candidates = [
      { id: 'legacy-1', data: { ...seed['students/legacy-1'], enrollmentStatus: 'active' } },
      { id: 'canonical-1', data: seed['students/canonical-1'] },
    ];

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS0001',
      candidates,
      mode: 'canonical_preferred',
      surface: 'student_login',
    });

    expect(selection?.legacyProfileId).toBe('legacy-1');
    expect(selection?.profileId).toBe('canonical-1');
  });

  it('refuses rather than falling through to a physical credential on a broken alias chain', async () => {
    // A chain means a merge was written wrong. Falling back to the physical
    // document here would quietly authenticate against the record the merge
    // was in the middle of retiring.
    const seed = {
      ...profile('a'),
      ...profile('b'),
      ...profile('c'),
      ...alias('a', 'b'),
      ...alias('b', 'c'),
    };
    const { db } = createInMemoryDocumentStore(seed);

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS0001',
      candidates: [{ id: 'a', data: seed['students/a'] }],
      mode: 'canonical_preferred',
      surface: 'student_login',
    });

    expect(selection).toBeNull();
  });

  it('returns nothing when no profile carries the code at all', async () => {
    const { db } = createInMemoryDocumentStore(profile('canonical-1'));

    const selection = await selectStudentAuthProfile(db, {
      code: 'HS9999',
      candidates: [],
      mode: 'canonical_preferred',
      surface: 'student_login',
    });

    expect(selection).toBeNull();
  });
});

describe('resolveLinkedStudentProfileId', () => {
  it('points a linked account at the profile that survived the merge', async () => {
    // The account stores the id it was created against. After a merge that id
    // is a tombstone, and every query made with it comes back empty — which on
    // a tuition page is indistinguishable from owing nothing.
    const { db } = createInMemoryDocumentStore({
      ...profile('canonical-1'),
      ...tombstone('legacy-1', 'canonical-1'),
      ...alias('legacy-1', 'canonical-1'),
    });

    expect(await resolveLinkedStudentProfileId(db, 'legacy-1')).toBe('canonical-1');
  });

  it('keeps the stored id when it cannot be resolved', async () => {
    // A broken pointer is not evidence that a family should be locked out, and
    // the records written under that id are still the best answer available.
    const { db } = createInMemoryDocumentStore({});

    expect(await resolveLinkedStudentProfileId(db, 'ghost')).toBe('ghost');
  });

  it('returns an empty string unchanged rather than resolving nothing', async () => {
    const { db } = createInMemoryDocumentStore({});

    expect(await resolveLinkedStudentProfileId(db, '')).toBe('');
  });
});
