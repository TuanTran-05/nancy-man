import { describe, expect, it } from 'vitest';
import { detectStudentIdentityCandidates, selectCanonicalStudentProfile } from './planner.js';
import type { PlannerProfileSource } from './planner.js';

function profile(overrides: Partial<PlannerProfileSource> & { id: string }): PlannerProfileSource {
  return {
    normalizedCode: '',
    admissionSearchName: '',
    admissionSearchDob: '',
    admissionSearchContact: '',
    mergedIntoStudentId: '',
    isTombstone: false,
    hasAlias: false,
    hasOpenEnrollment: false,
    hasCurrentLinkedAuth: false,
    hasActiveFinance: false,
    classProjectionConsistent: true,
    profileCompleteness: 0,
    verifiedTimestamp: null,
    archived: false,
    ...overrides,
  };
}

describe('detectStudentIdentityCandidates', () => {
  it('groups profiles sharing a normalized code as an exact_code candidate', () => {
    const candidates = detectStudentIdentityCandidates([
      profile({ id: 'a', normalizedCode: 'HS260167' }),
      profile({ id: 'b', normalizedCode: 'HS260167' }),
      profile({ id: 'c', normalizedCode: 'HS260200' }),
    ]);

    const exact = candidates.filter((c) => c.kind === 'exact_code');
    expect(exact).toHaveLength(1);
    expect(exact[0].profileIds.sort()).toEqual(['a', 'b']);
    expect(exact[0].normalizedCodes).toEqual(['HS260167']);
  });

  it('groups a legacy soft-merge pointer as its own candidate kind, separate from exact-code detection', () => {
    const candidates = detectStudentIdentityCandidates([
      profile({ id: 'canonical-1', normalizedCode: 'HS260001' }),
      profile({ id: 'legacy-1', normalizedCode: 'HS260001', mergedIntoStudentId: 'canonical-1', archived: true }),
    ]);

    const legacy = candidates.filter((c) => c.kind === 'legacy_soft_merge');
    expect(legacy).toHaveLength(1);
    expect(legacy[0].profileIds.sort()).toEqual(['canonical-1', 'legacy-1']);
    // The exact_code path must not also emit this pair as a duplicate group.
    expect(candidates.filter((c) => c.kind === 'exact_code')).toHaveLength(0);
  });

  it('flags a group with a valid alias and tombstone as existing_alias rather than a fresh candidate', () => {
    const candidates = detectStudentIdentityCandidates([
      profile({ id: 'canonical-1', normalizedCode: 'HS260002' }),
      profile({
        id: 'legacy-2',
        normalizedCode: 'HS260002',
        mergedIntoStudentId: 'canonical-1',
        hasAlias: true,
        isTombstone: true,
      }),
    ]);

    expect(candidates.map((c) => c.kind)).toEqual(['existing_alias']);
  });

  it('groups profiles with different codes but matching normalized name+dob+contact as different_code_identity', () => {
    const candidates = detectStudentIdentityCandidates([
      profile({
        id: 'x',
        normalizedCode: 'HS260003',
        admissionSearchName: 'quach hoang minh',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '84900000000',
      }),
      profile({
        id: 'y',
        normalizedCode: 'HS260099',
        admissionSearchName: 'quach hoang minh',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '84900000000',
      }),
    ]);

    const different = candidates.filter((c) => c.kind === 'different_code_identity');
    expect(different).toHaveLength(1);
    expect(different[0].profileIds.sort()).toEqual(['x', 'y']);
    expect(different[0].decision).toBe('manual_review');
  });

  it('does not treat a name-only or dob-only match as a different-code candidate', () => {
    const candidates = detectStudentIdentityCandidates([
      profile({ id: 'x', normalizedCode: 'HS1', admissionSearchName: 'nguyen van a', admissionSearchDob: '2015-01-01', admissionSearchContact: '84900000001' }),
      profile({ id: 'y', normalizedCode: 'HS2', admissionSearchName: 'nguyen van a', admissionSearchDob: '2016-01-01', admissionSearchContact: '84900000002' }),
    ]);

    expect(candidates.filter((c) => c.kind === 'different_code_identity')).toHaveLength(0);
  });

  it('is deterministic under shuffled input order', () => {
    const set = [
      profile({ id: 'b', normalizedCode: 'HS1' }),
      profile({ id: 'a', normalizedCode: 'HS1' }),
    ];
    const a = detectStudentIdentityCandidates(set);
    const b = detectStudentIdentityCandidates([...set].reverse());
    expect(a).toEqual(b);
  });

  it('assigns a stable evidence fingerprint that changes only when membership changes', () => {
    const candidatesA = detectStudentIdentityCandidates([
      profile({ id: 'a', normalizedCode: 'HS1' }),
      profile({ id: 'b', normalizedCode: 'HS1' }),
    ]);
    const candidatesB = detectStudentIdentityCandidates([
      profile({ id: 'a', normalizedCode: 'HS1' }),
      profile({ id: 'b', normalizedCode: 'HS1' }),
      profile({ id: 'c', normalizedCode: 'HS1' }),
    ]);
    expect(candidatesA[0].evidenceFingerprint).not.toBe(candidatesB[0].evidenceFingerprint);
  });
});

describe('selectCanonicalStudentProfile', () => {
  it('prefers a live profile over a tombstoned one regardless of other scores', () => {
    const scores = selectCanonicalStudentProfile({
      profiles: [
        profile({ id: 'tombstone', isTombstone: true, hasOpenEnrollment: true, hasCurrentLinkedAuth: true }),
        profile({ id: 'live', isTombstone: false }),
      ],
    });
    expect(scores[0].profileId).toBe('live');
    expect(scores[0].liveProfile).toBe(true);
  });

  it('breaks ties in lexicographic priority order: enrollment before auth before finance', () => {
    const scores = selectCanonicalStudentProfile({
      profiles: [
        profile({ id: 'has-auth-only', hasCurrentLinkedAuth: true }),
        profile({ id: 'has-enrollment-only', hasOpenEnrollment: true }),
      ],
    });
    expect(scores[0].profileId).toBe('has-enrollment-only');
  });

  it('falls back to lexicographic document id as the final tiebreak', () => {
    const scores = selectCanonicalStudentProfile({
      profiles: [profile({ id: 'zzz' }), profile({ id: 'aaa' })],
    });
    expect(scores[0].profileId).toBe('aaa');
  });

  it('records every score component and a human-readable reason list', () => {
    const scores = selectCanonicalStudentProfile({
      profiles: [profile({ id: 'a', hasOpenEnrollment: true, profileCompleteness: 5 })],
    });
    expect(scores[0]).toMatchObject({
      profileId: 'a',
      liveProfile: true,
      hasOpenEnrollment: true,
      profileCompleteness: 5,
    });
    expect(scores[0].reasons.length).toBeGreaterThan(0);
  });

  it('is deterministic under shuffled input order', () => {
    const set = [profile({ id: 'a', hasOpenEnrollment: true }), profile({ id: 'b' }), profile({ id: 'c', hasCurrentLinkedAuth: true })];
    const a = selectCanonicalStudentProfile({ profiles: set });
    const b = selectCanonicalStudentProfile({ profiles: [...set].reverse() });
    expect(a.map((s) => s.profileId)).toEqual(b.map((s) => s.profileId));
  });
});
