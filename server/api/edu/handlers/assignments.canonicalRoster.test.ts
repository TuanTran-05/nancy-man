import { describe, expect, it } from 'vitest';
import { listCanonicalClassRosterProfiles } from '../../lib/student/canonicalClassRoster.js';
import { assertDeliveryPolicyStudentsInClass } from './assignments.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

type Seed = Record<string, Record<string, unknown>>;

function enrollment(profileId: string, classId: string, termStart: string, status: string): Seed {
  const id = makeStudentCourseEnrollmentId(profileId, classId, termStart);
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart,
      termEnd: '2026-12-31',
      status,
      joinedAt: termStart,
      endedAt: ['completed', 'transferred', 'dropped'].includes(status) ? '2026-12-31' : null,
      source: 'system',
      confidence: 'confirmed',
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
      createdAt: 't',
      createdBy: 'merge',
    },
  };
}

/**
 * The roster every non-read surface needs: who is actually in this class right
 * now, as profile id and name, with nothing else attached.
 *
 * Assignment delivery, class counters, and course closing all used
 * `students.classId` for this. That field is a projection, so an assignment
 * went to a student who had already left and missed one who had arrived.
 */
describe('listCanonicalClassRosterProfiles', () => {
  it('takes the roster from enrollments, not the profile field', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/class-g7': { name: 'G7', teacherId: 'teacher-2' },
      'students/claims-only': { name: 'Chỉ Nói Miệng', classId: 'class-g7' },
      'students/enrolled-only': { name: 'Có Ghi Danh', classId: 'class-old' },
      ...enrollment('enrolled-only', 'class-g7', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRosterProfiles(db, 'class-g7');

    expect(roster).toEqual([{ id: 'enrolled-only', name: 'Có Ghi Danh' }]);
  });

  it('returns one entry per human when a retired profile is still enrolled', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/class-g7': { name: 'G7' },
      'students/canonical-1': { name: 'Một Người' },
      'students/legacy-1': { name: 'Một Người (cũ)' },
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('legacy-1', 'class-g7', '2026-07-01', 'active'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRosterProfiles(db, 'class-g7');

    expect(roster).toEqual([{ id: 'canonical-1', name: 'Một Người' }]);
  });

  it('omits a student whose enrollment has closed', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/class-g7': { name: 'G7' },
      'students/left': { name: 'Đã Chuyển', classId: 'class-g7' },
      ...enrollment('left', 'class-g7', '2026-01-05', 'transferred'),
    });

    expect(await listCanonicalClassRosterProfiles(db, 'class-g7')).toEqual([]);
  });

  it('includes a closed enrollment when a historical term is named', async () => {
    // Course closing and ledger rebuilds ask about a term that has ended. They
    // have to say so; a roster with no time context means "right now".
    const { db } = createInMemoryDocumentStore({
      'classes/class-g6': { name: 'G6' },
      'students/past': { name: 'Khoá Trước' },
      ...enrollment('past', 'class-g6', '2026-01-05', 'completed'),
    });

    const roster = await listCanonicalClassRosterProfiles(db, 'class-g6', {
      termStart: '2026-01-05',
      includeStatuses: ['active', 'on_leave', 'trial', 'completed', 'transferred'],
    });

    expect(roster.map((entry) => entry.id)).toEqual(['past']);
  });

  it('returns nothing for a class id that is empty', async () => {
    const { db } = createInMemoryDocumentStore({});
    expect(await listCanonicalClassRosterProfiles(db, '')).toEqual([]);
  });
});

/**
 * Who may be named as a selected recipient.
 *
 * The check read `students.classId`, which is the projection this workstream
 * exists to stop trusting. It said no to a student who had just been enrolled
 * and yes to one who had already left — the second is the one that matters,
 * because it delivers a child's assignment to a class they are no longer in.
 */
describe('assertDeliveryPolicyStudentsInClass', () => {
  const selected = (studentId: string) =>
    ({ targetMode: 'selected_students', assignedStudentIds: [studentId] }) as never;

  it('accepts a student the enrollment places in the class despite a stale profile', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/target-class': { name: 'G7' },
      'students/student-1': {
        name: 'Student 1',
        studentLifecycle: 'enrolled',
        classId: 'old-class',
      },
      ...enrollment('student-1', 'target-class', '2026-07-01', 'active'),
    });

    await expect(
      assertDeliveryPolicyStudentsInClass(db, 'target-class', selected('student-1'))
    ).resolves.toBeUndefined();
  });

  it('rejects a student whose stale profile still names the class they left', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/target-class': { name: 'G7' },
      'students/student-1': {
        name: 'Student 1',
        studentLifecycle: 'enrolled',
        classId: 'target-class',
      },
      ...enrollment('student-1', 'other-class', '2026-07-01', 'active'),
    });

    await expect(
      assertDeliveryPolicyStudentsInClass(db, 'target-class', selected('student-1'))
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts a retired id the alias points into the class', async () => {
    // An old saved draft can still name the retired half of a merged pair.
    const { db } = createInMemoryDocumentStore({
      'classes/target-class': { name: 'G7' },
      'students/canonical-1': { name: 'Một Người', studentLifecycle: 'enrolled' },
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('canonical-1', 'target-class', '2026-07-01', 'active'),
    });

    await expect(
      assertDeliveryPolicyStudentsInClass(db, 'target-class', selected('legacy-1'))
    ).resolves.toBeUndefined();
  });
});
