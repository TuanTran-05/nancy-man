import { describe, expect, it } from 'vitest';
import {
  assertCanReadStudentScopedResource,
  assertClassAccess,
  assertStudentInClass,
  getUserContext,
  studentBelongsToClass,
} from './authz.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

type Seed = Record<string, Record<string, unknown>>;

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

function enrollment(profileId: string, classId: string, status: string): Seed {
  const id = makeStudentCourseEnrollmentId(profileId, classId, '2026-07-01');
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart: '2026-07-01',
      termEnd: '2026-12-31',
      status,
      joinedAt: '2026-07-01',
      endedAt: null,
    },
  };
}

/**
 * The production shape after a merge: the account still stores the id it was
 * created against, and that id is now a tombstone.
 */
function mergedFamilySeed(): Seed {
  return {
    'classes/class-g7': { name: 'G7', teacherId: 'teacher-1', status: 'active' },
    'students/canonical-1': { name: 'Bùi An', studentLifecycle: 'enrolled' },
    'students/legacy-1': {
      name: '',
      studentProfileState: 'merged_tombstone',
      canonicalProfileId: 'canonical-1',
      mergeRunId: 'run-1',
      mergedAt: '2026-08-01T00:00:00.000Z',
      identityWriteDisabled: true,
      authDisabled: true,
      walletOwnership: 'canonicalized',
      tombstoneSourceFingerprint: 'b'.repeat(64),
    },
    ...alias('legacy-1', 'canonical-1'),
    ...enrollment('canonical-1', 'class-g7', 'active'),
    'users/parent:legacy-1': {
      uid: 'parent:legacy-1',
      role: 'parent',
      displayName: 'Phụ huynh Bùi An',
      studentId: 'legacy-1',
    },
  };
}

describe('getUserContext', () => {
  it('carries the surviving profile id for an account linked before a merge', async () => {
    // Every downstream check compares against `ctx.studentId`. Left as the
    // stored id, one merge turns a working session into a student who owns
    // nothing and belongs to no class.
    const { db } = createInMemoryDocumentStore(mergedFamilySeed());

    const ctx = await getUserContext(db, { uid: 'parent:legacy-1' } as never);

    expect(ctx.role).toBe('parent');
    expect(ctx.studentId).toBe('canonical-1');
    expect(ctx.isBlocked).toBe(false);
  });

  it('does not revoke the account because the stored profile became a tombstone', async () => {
    // A tombstone carries `authDisabled`. Checking login eligibility against
    // it tells a family their account was revoked for a records cleanup they
    // never saw.
    const { db } = createInMemoryDocumentStore(mergedFamilySeed());

    const ctx = await getUserContext(db, { uid: 'parent:legacy-1' } as never);

    expect(ctx.isBlocked).toBe(false);
  });

  it('still blocks when the tombstone is all there is to go on', async () => {
    // Same seed with the alias removed: the merge is half-written, nothing
    // says where the child went, and a retired profile is not a live student.
    // This is also what proves the two assertions above turn on resolution
    // rather than on the tombstone happening to look enrolled.
    const seed = mergedFamilySeed();
    delete seed['student_profile_aliases/legacy-1'];
    const { db } = createInMemoryDocumentStore(seed);

    const ctx = await getUserContext(db, { uid: 'parent:legacy-1' } as never);

    expect(ctx.studentId).toBe('legacy-1');
    expect(ctx.isBlocked).toBe(true);
  });

  it('leaves a staff context untouched', async () => {
    const { db } = createInMemoryDocumentStore({
      'users/admin-1': { uid: 'admin-1', role: 'admin', displayName: 'Quản trị' },
    });

    const ctx = await getUserContext(db, { uid: 'admin-1' } as never);

    expect(ctx.studentId).toBeUndefined();
    expect(ctx.role).toBe('admin');
  });
});

describe('studentBelongsToClass', () => {
  it('answers from the enrollment when the profile projection is stale', async () => {
    // `students.classId` still names the class the student left. Used as an
    // access rule, that locks a family out of the class their child attends.
    const { db } = createInMemoryDocumentStore({
      'students/s-1': { name: 'Bùi An', classId: 'class-g6' },
      ...enrollment('s-1', 'class-g7', 'active'),
    });

    expect(await studentBelongsToClass(db, 's-1', 'class-g7')).toBe(true);
  });

  it('falls back to the profile field for a student with no enrollment record', async () => {
    // Production holds these. Answering "in no class" would revoke access a
    // family legitimately has.
    const { db } = createInMemoryDocumentStore({
      'students/s-1': { name: 'Bùi An', classId: 'class-g6' },
    });

    expect(await studentBelongsToClass(db, 's-1', 'class-g6')).toBe(true);
  });

  it('says no when neither the enrollment nor the projection puts them there', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/s-1': { name: 'Bùi An', classId: 'class-g6' },
      ...enrollment('s-1', 'class-g7', 'completed'),
    });

    expect(await studentBelongsToClass(db, 's-1', 'class-g9')).toBe(false);
  });
});

describe('assertStudentInClass', () => {
  it('accepts the canonical enrollment when students.classId is stale', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/s-1': { name: 'Nguyễn Lương Mai Ly', classId: 'class-huong' },
      ...enrollment('s-1', 'class-quynh', 'active'),
    });

    const student = await assertStudentInClass(db, 's-1', 'class-quynh');

    expect(student.name).toBe('Nguyễn Lương Mai Ly');
  });
});

describe('assertCanReadStudentScopedResource', () => {
  it('lets a family open a record filed under the id their merge retired', async () => {
    // The session carries the surviving id; the record names the retired one.
    // A raw string compare calls that somebody else's child.
    const { db } = createInMemoryDocumentStore(mergedFamilySeed());

    const student = await assertCanReadStudentScopedResource(
      db,
      { uid: 'parent:legacy-1', role: 'parent', name: 'PH', studentId: 'canonical-1' },
      'legacy-1'
    );

    expect(student.name).toBe('Bùi An');
  });

  it('still refuses a family asking about a different child', async () => {
    const { db } = createInMemoryDocumentStore({
      ...mergedFamilySeed(),
      'students/other-1': { name: 'Người Khác', studentLifecycle: 'enrolled' },
    });

    await expect(
      assertCanReadStudentScopedResource(
        db,
        { uid: 'parent:legacy-1', role: 'parent', name: 'PH', studentId: 'canonical-1' },
        'other-1'
      )
    ).rejects.toThrow('Not authorized for this student');
  });
});

describe('assertClassAccess', () => {
  it('admits a family to the class their enrollment puts them in', async () => {
    const { db } = createInMemoryDocumentStore(mergedFamilySeed());

    const classData = await assertClassAccess(
      db,
      { uid: 'parent:legacy-1', role: 'parent', name: 'PH', studentId: 'canonical-1' },
      'class-g7',
      'read'
    );

    expect(classData.name).toBe('G7');
  });
});
