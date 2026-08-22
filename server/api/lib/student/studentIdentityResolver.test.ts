import { describe, expect, it } from 'vitest';
import {
  resolveCanonicalStudentId,
  STUDENT_PROFILE_ALIASES_COLLECTION,
} from './studentIdentityResolver.js';
import { STUDENT_CODE_REGISTRY_COLLECTION } from './studentCodeRegistry.js';

const ALIAS = {
  legacyProfileId: 'legacy-1',
  canonicalProfileId: 'canonical-1',
  mergeRunId: 'run-1',
  reasonCode: 'profile_normalization',
  sourceFingerprint: 'a'.repeat(64),
  createdAt: '2026-08-07T00:00:00.000Z',
  createdBy: 'merge-engine',
};

/** DocumentStore stub over a flat path map, with an optional legacy code query. */
function makeDb(docs: Record<string, unknown>, legacyCodeOwners: string[] = []) {
  const reads: string[] = [];
  return {
    reads,
    doc(path: string) {
      return {
        path,
        async get() {
          reads.push(path);
          const data = docs[path];
          return { exists: data !== undefined, id: path.split('/').pop(), data: () => data };
        },
      };
    },
    collection(name: string) {
      return {
        where() {
          return {
            limit() {
              return {
                async get() {
                  reads.push(`query:${name}`);
                  return {
                    empty: legacyCodeOwners.length === 0,
                    docs: legacyCodeOwners.map((id) => ({
                      id,
                      data: () => docs[`students/${id}`] ?? {},
                    })),
                  };
                },
              };
            },
          };
        },
      };
    },
  } as never;
}

const LIVE_CANONICAL = { 'students/canonical-1': { name: 'Quách Hoàng Minh' } };

describe('direct resolution', () => {
  it('returns a live profile unchanged', async () => {
    const result = await resolveCanonicalStudentId(makeDb(LIVE_CANONICAL), 'canonical-1');

    expect(result).toEqual({
      requestedId: 'canonical-1',
      canonicalProfileId: 'canonical-1',
      resolution: 'profile',
      shouldRedirect: false,
    });
  });

  it('rejects an id that names nothing', async () => {
    await expect(resolveCanonicalStudentId(makeDb({}), 'ghost')).rejects.toThrow(
      'STUDENT_IDENTITY_NOT_FOUND'
    );
  });
});

describe('alias resolution', () => {
  it('prefers the alias even while the source profile still exists', async () => {
    // Workstream C writes the alias before the tombstone phase, so for part of
    // a run both documents are present. Reading the profile first would return
    // the doomed one.
    const db = makeDb({
      ...LIVE_CANONICAL,
      'students/legacy-1': { name: 'Quách Hoàng Minh' },
      [`${STUDENT_PROFILE_ALIASES_COLLECTION}/legacy-1`]: ALIAS,
    });

    const result = await resolveCanonicalStudentId(db, 'legacy-1');

    expect(result).toMatchObject({
      canonicalProfileId: 'canonical-1',
      resolution: 'profile_alias',
      shouldRedirect: true,
    });
  });

  it('refuses an alias whose target does not exist', async () => {
    const db = makeDb({ [`${STUDENT_PROFILE_ALIASES_COLLECTION}/legacy-1`]: ALIAS });

    await expect(resolveCanonicalStudentId(db, 'legacy-1')).rejects.toThrow(
      'STUDENT_IDENTITY_ALIAS_TARGET_MISSING'
    );
  });

  it('refuses a second hop', async () => {
    // One hop only: a chain means some link was written wrong, and following
    // it would hide that.
    const db = makeDb({
      'students/canonical-1': { name: 'A' },
      [`${STUDENT_PROFILE_ALIASES_COLLECTION}/legacy-1`]: {
        ...ALIAS,
        canonicalProfileId: 'legacy-2',
      },
      [`${STUDENT_PROFILE_ALIASES_COLLECTION}/legacy-2`]: {
        ...ALIAS,
        legacyProfileId: 'legacy-2',
        canonicalProfileId: 'canonical-1',
      },
      'students/legacy-2': { name: 'B' },
    });

    await expect(resolveCanonicalStudentId(db, 'legacy-1')).rejects.toThrow(
      'STUDENT_IDENTITY_ALIAS_NOT_ONE_HOP'
    );
  });

  it('refuses a malformed alias rather than falling through to the profile', async () => {
    const db = makeDb({
      'students/legacy-1': { name: 'Quách Hoàng Minh' },
      [`${STUDENT_PROFILE_ALIASES_COLLECTION}/legacy-1`]: { canonicalProfileId: 'canonical-1' },
    });

    await expect(resolveCanonicalStudentId(db, 'legacy-1')).rejects.toThrow(
      'STUDENT_IDENTITY_ALIAS_MALFORMED'
    );
  });

  it('refuses an alias to a tombstoned profile', async () => {
    const db = makeDb({
      [`${STUDENT_PROFILE_ALIASES_COLLECTION}/legacy-1`]: ALIAS,
      'students/canonical-1': { studentProfileState: 'merged_tombstone' },
    });

    await expect(resolveCanonicalStudentId(db, 'legacy-1')).rejects.toThrow(
      'STUDENT_IDENTITY_ALIAS_TARGET_NOT_CANONICAL'
    );
  });
});

describe('legacy soft-merge compatibility branch', () => {
  const SOFT_MERGED = {
    'students/legacy-1': { mergedIntoStudentId: 'canonical-1', studentLifecycle: 'archived' },
    ...LIVE_CANONICAL,
  };

  it('follows the old script pointer exactly one hop', async () => {
    // Fifty-eight production records still look like this and have no alias.
    // Without this branch every one of them resolves to the retired document.
    const result = await resolveCanonicalStudentId(makeDb(SOFT_MERGED), 'legacy-1');

    expect(result).toMatchObject({
      canonicalProfileId: 'canonical-1',
      resolution: 'legacy_soft_merge_pointer',
      shouldRedirect: true,
    });
  });

  it('never returns the retired document itself', async () => {
    const result = await resolveCanonicalStudentId(makeDb(SOFT_MERGED), 'legacy-1');

    expect(result.canonicalProfileId).not.toBe('legacy-1');
  });

  it('prefers a real alias when both exist', async () => {
    const db = makeDb({
      ...SOFT_MERGED,
      'students/canonical-2': { name: 'B' },
      [`${STUDENT_PROFILE_ALIASES_COLLECTION}/legacy-1`]: {
        ...ALIAS,
        canonicalProfileId: 'canonical-2',
      },
    });

    const result = await resolveCanonicalStudentId(db, 'legacy-1');

    expect(result.resolution).toBe('profile_alias');
    expect(result.canonicalProfileId).toBe('canonical-2');
  });

  it('fails closed on a self-pointer', async () => {
    const db = makeDb({ 'students/legacy-1': { mergedIntoStudentId: 'legacy-1' } });

    await expect(resolveCanonicalStudentId(db, 'legacy-1')).rejects.toThrow(
      'STUDENT_IDENTITY_LEGACY_POINTER_INVALID'
    );
  });

  it('fails closed on a pointer to a missing profile', async () => {
    const db = makeDb({ 'students/legacy-1': { mergedIntoStudentId: 'gone' } });

    await expect(resolveCanonicalStudentId(db, 'legacy-1')).rejects.toThrow(
      'STUDENT_IDENTITY_LEGACY_POINTER_INVALID'
    );
  });

  it('fails closed on a pointer to a profile that is itself retired', async () => {
    const db = makeDb({
      'students/legacy-1': { mergedIntoStudentId: 'legacy-2' },
      'students/legacy-2': { mergedIntoStudentId: 'canonical-1' },
      ...LIVE_CANONICAL,
    });

    await expect(resolveCanonicalStudentId(db, 'legacy-1')).rejects.toThrow(
      'STUDENT_IDENTITY_LEGACY_POINTER_INVALID'
    );
  });

  it('is gated by one named flag so its removal is provable', async () => {
    const db = makeDb(SOFT_MERGED);

    await expect(
      resolveCanonicalStudentId(db, 'legacy-1', { allowLegacySoftMergePointer: false })
    ).rejects.toThrow('STUDENT_IDENTITY_LEGACY_POINTER_DISABLED');
  });
});

describe('business code resolution', () => {
  it('resolves a registered code to its canonical profile', async () => {
    const db = makeDb({
      ...LIVE_CANONICAL,
      [`${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`]: {
        normalizedCode: 'HS260167',
        canonicalProfileId: 'canonical-1',
        status: 'active',
        isPrimary: true,
      },
    });

    const result = await resolveCanonicalStudentId(db, 'HS260167');

    expect(result).toMatchObject({ canonicalProfileId: 'canonical-1', resolution: 'code_registry' });
  });

  it('resolves a retired code, so historical references still land correctly', async () => {
    const db = makeDb({
      ...LIVE_CANONICAL,
      [`${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`]: {
        normalizedCode: 'HS260167',
        canonicalProfileId: 'canonical-1',
        status: 'retired',
        isPrimary: false,
      },
    });

    const result = await resolveCanonicalStudentId(db, 'HS260167');

    expect(result.canonicalProfileId).toBe('canonical-1');
  });

  it('does not fall back to a legacy code query unless asked', async () => {
    const db = makeDb({}, ['canonical-1']);

    await expect(resolveCanonicalStudentId(db, 'HS260167')).rejects.toThrow(
      'STUDENT_IDENTITY_NOT_FOUND'
    );
  });

  it('uses the legacy code query only when the fallback is enabled', async () => {
    const db = makeDb(LIVE_CANONICAL, ['canonical-1']);

    const result = await resolveCanonicalStudentId(db, 'HS260167', {
      allowLegacyCodeFallback: true,
    });

    expect(result.resolution).toBe('legacy_code_fallback');
  });

  it('refuses an ambiguous legacy code instead of choosing a winner', async () => {
    // Choosing the "active" one heuristically is how the wrong student ends up
    // owning a payment.
    const db = makeDb(LIVE_CANONICAL, ['canonical-1', 'legacy-9']);

    await expect(
      resolveCanonicalStudentId(db, 'HS260167', { allowLegacyCodeFallback: true })
    ).rejects.toThrow('STUDENT_IDENTITY_DATA_INCONSISTENT');
  });
});
