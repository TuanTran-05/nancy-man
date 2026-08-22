import { describe, expect, it } from 'vitest';
import {
  isCanonicalStudentProfile,
  isLegacySoftMergedStudentProfile,
  isStudentProfileAlias,
  isStudentProfileTombstone,
  readLegacySoftMergePointer,
} from './studentIdentity.js';

const VALID_ALIAS = {
  legacyProfileId: 'legacy-1',
  canonicalProfileId: 'canonical-1',
  mergeRunId: 'run-1',
  reasonCode: 'profile_normalization',
  sourceFingerprint: 'a'.repeat(64),
  createdAt: '2026-08-07T00:00:00.000Z',
  createdBy: 'merge-engine',
};

const VALID_TOMBSTONE = {
  studentProfileState: 'merged_tombstone',
  canonicalProfileId: 'canonical-1',
  mergeRunId: 'run-1',
  mergedAt: '2026-08-07T00:00:00.000Z',
  identityWriteDisabled: true,
  authDisabled: true,
  walletOwnership: 'canonicalized',
  tombstoneSourceFingerprint: 'b'.repeat(64),
};

describe('isStudentProfileAlias', () => {
  it('accepts a complete alias record', () => {
    expect(isStudentProfileAlias(VALID_ALIAS)).toBe(true);
  });

  it('rejects an alias pointing at itself', () => {
    // A self-alias resolves forever without ever reaching a live profile.
    expect(
      isStudentProfileAlias({ ...VALID_ALIAS, canonicalProfileId: VALID_ALIAS.legacyProfileId })
    ).toBe(false);
  });

  it.each([
    'legacyProfileId',
    'canonicalProfileId',
    'mergeRunId',
    'reasonCode',
    'sourceFingerprint',
    'createdBy',
  ])('rejects a record missing %s', (field) => {
    const record: Record<string, unknown> = { ...VALID_ALIAS };
    delete record[field];

    expect(isStudentProfileAlias(record)).toBe(false);
  });

  it.each(['', '   '])('rejects a blank required field (%j)', (blank) => {
    expect(isStudentProfileAlias({ ...VALID_ALIAS, canonicalProfileId: blank })).toBe(false);
  });

  it('rejects an unrecognized reason code', () => {
    expect(isStudentProfileAlias({ ...VALID_ALIAS, reasonCode: 'because_i_said_so' })).toBe(false);
  });

  it('accepts audited forward repair as a reason', () => {
    expect(isStudentProfileAlias({ ...VALID_ALIAS, reasonCode: 'audited_forward_repair' })).toBe(
      true
    );
  });

  it.each([null, undefined, 'a string', 42, []])('rejects the non-record %j', (value) => {
    expect(isStudentProfileAlias(value)).toBe(false);
  });
});

describe('isStudentProfileTombstone', () => {
  it('accepts a complete tombstone', () => {
    expect(isStudentProfileTombstone(VALID_TOMBSTONE)).toBe(true);
  });

  it('rejects a different profile state', () => {
    expect(
      isStudentProfileTombstone({ ...VALID_TOMBSTONE, studentProfileState: 'archived' })
    ).toBe(false);
  });

  it.each(['identityWriteDisabled', 'authDisabled'])(
    'rejects a tombstone whose %s is not true',
    (field) => {
      expect(isStudentProfileTombstone({ ...VALID_TOMBSTONE, [field]: false })).toBe(false);
    }
  );

  it('rejects a tombstone whose wallet ownership was not canonicalized', () => {
    // The flag is the record that the money moved. Without it the document
    // claims to be retired while still owning a balance.
    expect(isStudentProfileTombstone({ ...VALID_TOMBSTONE, walletOwnership: 'legacy' })).toBe(
      false
    );
  });

  it.each(['canonicalProfileId', 'mergeRunId', 'tombstoneSourceFingerprint'])(
    'rejects a tombstone missing %s',
    (field) => {
      const record: Record<string, unknown> = { ...VALID_TOMBSTONE };
      delete record[field];

      expect(isStudentProfileTombstone(record)).toBe(false);
    }
  );
});

describe('legacy soft merges', () => {
  // Production holds fifty-eight of these, written by
  // scripts/merge-duplicate-student-records.ts. They carry no
  // studentProfileState at all, so a predicate keyed only on that field would
  // classify every one of them as a canonical profile.
  const LEGACY = { mergedIntoStudentId: 'canonical-1', studentLifecycle: 'archived' };

  it('recognizes the old script marker', () => {
    expect(isLegacySoftMergedStudentProfile(LEGACY)).toBe(true);
    expect(readLegacySoftMergePointer(LEGACY)).toBe('canonical-1');
  });

  it('recognizes the marker even without the archived lifecycle', () => {
    // The pointer alone is what makes the document non-canonical; a missing
    // lifecycle flag is sloppiness, not evidence the record is live.
    expect(isLegacySoftMergedStudentProfile({ mergedIntoStudentId: 'canonical-1' })).toBe(true);
  });

  it('treats an empty pointer as no pointer', () => {
    expect(isLegacySoftMergedStudentProfile({ mergedIntoStudentId: '' })).toBe(false);
    expect(readLegacySoftMergePointer({ mergedIntoStudentId: '   ' })).toBeNull();
  });

  it('returns null rather than a pointer for a document that has none', () => {
    expect(readLegacySoftMergePointer({ name: 'Quách Hoàng Minh' })).toBeNull();
  });

  it('does not resolve a self-pointer', () => {
    // Resolving it would return the retired document as its own canonical.
    expect(readLegacySoftMergePointer({ id: 'legacy-1', mergedIntoStudentId: 'legacy-1' })).toBeNull();
  });
});

describe('isCanonicalStudentProfile', () => {
  it('accepts an ordinary live profile', () => {
    expect(isCanonicalStudentProfile({ name: 'Quách Hoàng Minh', classId: 'c-1' })).toBe(true);
  });

  it('rejects a tombstone', () => {
    expect(isCanonicalStudentProfile(VALID_TOMBSTONE)).toBe(false);
  });

  it('rejects a legacy soft-merge record', () => {
    expect(
      isCanonicalStudentProfile({ mergedIntoStudentId: 'canonical-1', studentLifecycle: 'archived' })
    ).toBe(false);
  });

  it('rejects a document carrying both the legacy marker and a real tombstone', () => {
    expect(
      isCanonicalStudentProfile({ ...VALID_TOMBSTONE, mergedIntoStudentId: 'canonical-1' })
    ).toBe(false);
  });

  it('rejects a document claiming merged_tombstone with a malformed body', () => {
    // Fail closed: a half-written tombstone is not a canonical profile just
    // because it failed validation.
    expect(isCanonicalStudentProfile({ studentProfileState: 'merged_tombstone' })).toBe(false);
  });

  it('keeps an ordinary archived student canonical-shaped', () => {
    // Lifecycle exclusion is a separate concern, applied elsewhere. This
    // predicate only answers "is this a retired duplicate?".
    expect(isCanonicalStudentProfile({ studentLifecycle: 'archived', name: 'A' })).toBe(true);
  });

  it.each([null, undefined, 'a string'])('rejects the non-record %j', (value) => {
    expect(isCanonicalStudentProfile(value)).toBe(false);
  });
});

describe('alias precedence during the merge window', () => {
  it('an alias and its still-present source profile can both be valid', () => {
    // Workstream C writes the alias before the tombstone phase, so for part of
    // the run both documents exist. Resolution must prefer the alias.
    const alias = VALID_ALIAS;
    const stillLiveSource = { name: 'Quách Hoàng Minh', classId: 'c-1' };

    expect(isStudentProfileAlias(alias)).toBe(true);
    expect(isCanonicalStudentProfile(stillLiveSource)).toBe(true);
  });
});
