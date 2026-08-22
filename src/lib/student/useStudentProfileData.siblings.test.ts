import { describe, expect, it } from 'vitest';
import type { SafeStudent } from '../../types';
import { coerceSafeStudent, deriveSiblingProfileLists } from './useStudentProfileData';

describe('coerceSafeStudent siblingGroupId', () => {
  const raw = {
    id: 's1',
    name: 'Nguyen Van An',
    studentId: 'HS260001',
    classId: 'c1',
    siblingGroupId: 'sib-1',
  };

  it('carries siblingGroupId through', () => {
    expect(coerceSafeStudent(raw)?.siblingGroupId).toBe('sib-1');
  });

  it('leaves it undefined when absent', () => {
    const { siblingGroupId: _drop, ...withoutGroup } = raw;
    expect(coerceSafeStudent(withoutGroup)?.siblingGroupId).toBeUndefined();
  });

  it('ignores a non-string value', () => {
    expect(coerceSafeStudent({ ...raw, siblingGroupId: 42 })?.siblingGroupId).toBeUndefined();
  });
});

describe('deriveSiblingProfileLists', () => {
  const baseStudent = {
    name: 'HOANG THANH LONG',
    studentId: 'HS260112',
    dob: '2014-10-09',
    contact: '0976692203',
    classId: 'old-class',
    teacherId: 'teacher-1',
    createdAt: '2026-04-08T15:18:49.173Z',
    code: '',
    gender: 'male',
    studentLifecycle: 'enrolled',
  } satisfies Partial<SafeStudent>;

  it('offers every row the server returned as a sibling candidate', () => {
    // Filtering a "historical promoted copy" out here is an identity decision
    // made from `enrollmentStatus`, a compatibility projection. The server
    // decides which rows are one child; a candidate list that pre-empts it can
    // only remove the evidence that two exist.
    const currentProfile = {
      id: 'profile-student',
      name: 'Current Profile',
      studentId: 'HS260500',
      dob: '2014-01-01',
      contact: '0900000000',
      classId: 'class-1',
      teacherId: 'teacher-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      code: '',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    } satisfies SafeStudent;
    const promotedHistory = {
      ...baseStudent,
      id: 'old-copy',
      enrollmentStatus: 'promoted',
    } satisfies SafeStudent;
    const activeCopy = {
      ...baseStudent,
      id: 'active-copy',
      classId: 'new-class',
      enrollmentStatus: 'active',
    } satisfies SafeStudent;

    const result = deriveSiblingProfileLists(
      currentProfile,
      [currentProfile, promotedHistory, activeCopy],
      true
    );

    expect(result.candidates.map((student) => student.id).sort()).toEqual([
      'active-copy',
      'old-copy',
    ]);
  });
});

describe('deriveSiblingProfileLists with canonical rows', () => {
  const student = {
    id: 'canonical-1',
    canonicalProfileId: 'canonical-1',
    name: 'HOANG THANH LONG',
    studentId: 'HS0001',
    siblingGroupId: 'sib-1',
  } as unknown as SafeStudent;

  function canonicalRow(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      canonicalProfileId: id,
      name: `Học Sinh ${id}`,
      studentId: `HS-${id}`,
      siblingGroupId: 'sib-1',
      placementStatus: 'studying',
      ...overrides,
    } as unknown as SafeStudent;
  }

  it('keeps twins, whom the client-side collapse reads as one child', () => {
    // The collapse keys rows on name + date of birth + contact and keeps one
    // per key. Twins enrolled under the same parent's phone match on all
    // three, so one of them disappeared from their own family list. The server
    // has already returned one row per human — collapsing again is a guess
    // applied on top of an answer that did not need it.
    const twinFields = { name: 'TRAN MINH', dob: '2015-03-04', contact: '0384072314' };
    const rows = [student, canonicalRow('twin-a', twinFields), canonicalRow('twin-b', twinFields)];

    const { siblings } = deriveSiblingProfileLists(student, rows, true);

    expect(siblings.map((row) => row.id)).toEqual(['twin-a', 'twin-b']);
  });

  it('offers every other canonical row as a candidate, and never the student', () => {
    const rows = [student, canonicalRow('other-1'), canonicalRow('other-2')];

    const { candidates } = deriveSiblingProfileLists(student, rows, true);

    expect(candidates.map((row) => row.id)).toEqual(['other-1', 'other-2']);
  });

  it('offers nothing to a role that cannot edit the link', () => {
    const rows = [student, canonicalRow('other-1')];

    expect(deriveSiblingProfileLists(student, rows, false).candidates).toEqual([]);
  });
});
