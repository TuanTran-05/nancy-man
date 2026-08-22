import { describe, expect, it } from 'vitest';
import {
  SIBLING_DISCOUNT_PERCENT,
  computeSiblingGrant,
  describeSiblingEligibility,
  expandWithSiblings,
  getActiveSiblingGroupMembers,
  isActiveForSibling,
  isSiblingScholarshipEligible,
  type SiblingStudentRecord,
} from './siblingScholarship.js';

function student(overrides: Partial<SiblingStudentRecord> & { id: string }): SiblingStudentRecord {
  return { studentLifecycle: 'enrolled', enrollmentStatus: 'active', ...overrides };
}

describe('SIBLING_DISCOUNT_PERCENT', () => {
  it('is 10 percentage points', () => {
    expect(SIBLING_DISCOUNT_PERCENT).toBe(10);
  });
});

describe('isActiveForSibling', () => {
  it('accepts an enrolled, active student', () => {
    expect(isActiveForSibling(student({ id: 'a' }))).toBe(true);
  });

  it('treats legacy records with no status fields as active', () => {
    expect(isActiveForSibling({ id: 'legacy' })).toBe(true);
  });

  it.each(['on_leave', 'dropped', 'promoted'])('rejects enrollmentStatus %s', (status) => {
    expect(isActiveForSibling(student({ id: 'a', enrollmentStatus: status }))).toBe(false);
  });

  it.each(['trial', 'lead', 'pending', 'archived'])('rejects lifecycle %s', (lifecycle) => {
    expect(isActiveForSibling(student({ id: 'a', studentLifecycle: lifecycle }))).toBe(false);
  });

  it('rejects a revoked student even when the raw fields look enrolled', () => {
    expect(isActiveForSibling(student({ id: 'a', isRevoked: true }))).toBe(false);
  });

  it('rejects a soft-deleted student', () => {
    expect(isActiveForSibling(student({ id: 'a', deletedAt: '2026-01-01T00:00:00.000Z' }))).toBe(
      false
    );
  });
});

describe('isSiblingScholarshipEligible', () => {
  it('is true when two group members are active', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    const b = student({ id: 'b', siblingGroupId: 'g1' });
    expect(isSiblingScholarshipEligible(a, [a, b])).toBe(true);
    expect(isSiblingScholarshipEligible(b, [a, b])).toBe(true);
  });

  it('is false for BOTH when one member is archived', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    const b = student({ id: 'b', siblingGroupId: 'g1', studentLifecycle: 'archived' });
    expect(isSiblingScholarshipEligible(a, [a, b])).toBe(false);
    expect(isSiblingScholarshipEligible(b, [a, b])).toBe(false);
  });

  it('keeps the remaining two eligible when a third member leaves', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    const b = student({ id: 'b', siblingGroupId: 'g1' });
    const c = student({ id: 'c', siblingGroupId: 'g1', enrollmentStatus: 'dropped' });
    expect(isSiblingScholarshipEligible(a, [a, b, c])).toBe(true);
    expect(isSiblingScholarshipEligible(c, [a, b, c])).toBe(false);
  });

  it('is false when the student has no group', () => {
    const a = student({ id: 'a' });
    const b = student({ id: 'b', siblingGroupId: 'g1' });
    expect(isSiblingScholarshipEligible(a, [a, b])).toBe(false);
  });

  it('is false for a one-member group', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    expect(isSiblingScholarshipEligible(a, [a])).toBe(false);
  });

  it('ignores members of other groups', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    const other = student({ id: 'z', siblingGroupId: 'g2' });
    expect(isSiblingScholarshipEligible(a, [a, other])).toBe(false);
  });

  it('is false when a trial student is paired with an active one', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1', studentLifecycle: 'trial' });
    const b = student({ id: 'b', siblingGroupId: 'g1' });
    expect(isSiblingScholarshipEligible(a, [a, b])).toBe(false);
    expect(isSiblingScholarshipEligible(b, [a, b])).toBe(false);
  });
});

describe('getActiveSiblingGroupMembers', () => {
  it('returns active members including the student itself', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    const b = student({ id: 'b', siblingGroupId: 'g1' });
    const c = student({ id: 'c', siblingGroupId: 'g1', studentLifecycle: 'archived' });
    expect(getActiveSiblingGroupMembers(a, [a, b, c]).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('returns an empty list when the student has no group', () => {
    const a = student({ id: 'a' });
    expect(getActiveSiblingGroupMembers(a, [a])).toEqual([]);
  });
});

describe('describeSiblingEligibility', () => {
  it('reports no_group when the student is unlinked', () => {
    const a = student({ id: 'a' });
    expect(describeSiblingEligibility(a, [a])).toEqual({
      eligible: false,
      reason: 'no_group',
      activeCount: 0,
    });
  });

  it('reports student_inactive when the student itself is not active', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1', enrollmentStatus: 'on_leave' });
    const b = student({ id: 'b', siblingGroupId: 'g1' });
    expect(describeSiblingEligibility(a, [a, b])).toEqual({
      eligible: false,
      reason: 'student_inactive',
      activeCount: 1,
    });
  });

  it('reports no_active_sibling when the student is the last one studying', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    const b = student({ id: 'b', siblingGroupId: 'g1', studentLifecycle: 'archived' });
    expect(describeSiblingEligibility(a, [a, b])).toEqual({
      eligible: false,
      reason: 'no_active_sibling',
      activeCount: 1,
    });
  });

  it('reports eligible with the active count', () => {
    const a = student({ id: 'a', siblingGroupId: 'g1' });
    const b = student({ id: 'b', siblingGroupId: 'g1' });
    expect(describeSiblingEligibility(a, [a, b])).toEqual({
      eligible: true,
      reason: null,
      activeCount: 2,
    });
  });
});

describe('expandWithSiblings', () => {
  const an = student({ id: 'an', siblingGroupId: 'g1' });
  const binh = student({ id: 'binh', siblingGroupId: 'g1' });
  const khanh = student({ id: 'khanh' });

  it('emits a sibling row directly after its direct match', () => {
    expect(expandWithSiblings([an], [an, binh, khanh])).toEqual([
      { student: an, matchKind: 'direct' },
      { student: binh, matchKind: 'sibling', siblingOf: 'an' },
    ]);
  });

  it('keeps a student as direct when they also match directly', () => {
    expect(expandWithSiblings([an, binh], [an, binh])).toEqual([
      { student: an, matchKind: 'direct' },
      { student: binh, matchKind: 'direct' },
    ]);
  });

  it('emits a shared sibling only once across several direct matches', () => {
    const cuong = student({ id: 'cuong', siblingGroupId: 'g1' });
    expect(expandWithSiblings([an, binh], [an, binh, cuong])).toEqual([
      { student: an, matchKind: 'direct' },
      { student: cuong, matchKind: 'sibling', siblingOf: 'an' },
      { student: binh, matchKind: 'direct' },
    ]);
  });

  it('omits siblings a filter excluded from the pool', () => {
    expect(expandWithSiblings([an], [an])).toEqual([{ student: an, matchKind: 'direct' }]);
  });

  it('includes inactive siblings — visibility is not the scholarship rule', () => {
    const archived = student({ id: 'binh', siblingGroupId: 'g1', studentLifecycle: 'archived' });
    expect(expandWithSiblings([an], [an, archived])).toEqual([
      { student: an, matchKind: 'direct' },
      { student: archived, matchKind: 'sibling', siblingOf: 'an' },
    ]);
  });

  it('returns plain direct rows when nobody has a group', () => {
    expect(expandWithSiblings([khanh], [khanh])).toEqual([{ student: khanh, matchKind: 'direct' }]);
  });

  it('ignores records with a blank id', () => {
    const ghost = { siblingGroupId: 'g1', studentLifecycle: 'enrolled' };
    expect(expandWithSiblings([an], [an, ghost])).toEqual([{ student: an, matchKind: 'direct' }]);
  });
});

describe('computeSiblingGrant', () => {
  const base = {
    ledgerAmount: 1_000_000,
    siblingDiscountTotal: 0,
    eligible: true,
    waived: false,
    isFullWaiver: false,
  };

  it('grants the full 10% on a fresh ledger', () => {
    expect(computeSiblingGrant(base)).toBe(100_000);
  });

  it('grants nothing once the entitlement is consumed', () => {
    expect(computeSiblingGrant({ ...base, siblingDiscountTotal: 100_000 })).toBe(0);
  });

  it('grants only the shortfall when partly consumed', () => {
    expect(computeSiblingGrant({ ...base, siblingDiscountTotal: 40_000 })).toBe(60_000);
  });

  it('never returns a negative grant when over-consumed', () => {
    expect(computeSiblingGrant({ ...base, siblingDiscountTotal: 500_000 })).toBe(0);
  });

  it('grants nothing when the student is ineligible', () => {
    expect(computeSiblingGrant({ ...base, eligible: false })).toBe(0);
  });

  it('grants nothing when the scholarship is waived', () => {
    expect(computeSiblingGrant({ ...base, waived: true })).toBe(0);
  });

  it('grants nothing on a full waiver', () => {
    expect(computeSiblingGrant({ ...base, isFullWaiver: true })).toBe(0);
  });

  it('rounds to whole dong', () => {
    expect(computeSiblingGrant({ ...base, ledgerAmount: 999_995 })).toBe(100_000);
  });

  it('handles a zero-amount ledger', () => {
    expect(computeSiblingGrant({ ...base, ledgerAmount: 0 })).toBe(0);
  });
});
