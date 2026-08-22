import { beforeEach, describe, expect, it } from 'vitest';
import { readNotifications, readParentTuition, readStudentAdminReport } from './readers.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import {
  resetCanonicalStudentReadControlCacheForTests,
  STUDENT_IDENTITY_READ_MODEL_PATH,
} from '../../lib/student/canonicalStudentReadControl.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import type { UserContext } from '../../lib/auth/authz.js';

type Seed = Record<string, Record<string, unknown>>;

function control(mode: string): Seed {
  return {
    [STUDENT_IDENTITY_READ_MODEL_PATH]: {
      schemaVersion: 1,
      mode,
      generation: 1,
      activatedAt: '2026-08-08T00:00:00.000Z',
      activatedBy: 'admin:tt',
      normalizationRunId: null,
      planDigest: null,
      approvalDigest: null,
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
      endedAt: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: `${termStart}T00:00:00.000Z`,
      statusChangedBy: 'seed',
      confirmedAt: `${termStart}T00:00:00.000Z`,
      confirmedBy: 'seed',
      createdAt: `${termStart}T00:00:00.000Z`,
      updatedAt: `${termStart}T00:00:00.000Z`,
    },
  };
}

/**
 * A merged human: the retired profile, the surviving one, and money attached
 * to the surviving id. Opening the profile by the retired id is the request
 * this suite is about — it is what a link in an old receipt or audit entry
 * still produces.
 */
function mergedHumanSeed(mode = 'canonical_preferred'): Seed {
  return {
    ...control(mode),
    'classes/class-g7': { name: 'G7', teacherId: 'teacher-2', status: 'active' },
    'students/canonical-1': {
      name: 'Quách Hoàng Minh',
      studentId: 'HS260167',
      dob: '2014-05-02',
      contact: '0900000000',
      classId: 'class-g7',
      teacherId: 'teacher-2',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    },
    'students/legacy-1': {
      name: 'Quách Hoàng Minh',
      studentId: 'HS260167',
      studentProfileState: 'merged_tombstone',
      canonicalProfileId: 'canonical-1',
      mergeRunId: 'run-1',
      tombstoneSourceFingerprint: 'b'.repeat(64),
      identityWriteDisabled: true,
      authDisabled: true,
      walletOwnership: 'canonicalized',
    },
    ...alias('legacy-1', 'canonical-1'),
    ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    'course_fee_ledgers/ledger-1': {
      studentId: 'canonical-1',
      classId: 'class-g7',
      amount: 1_000_000,
      paidTotal: 1_000_000,
      discountTotal: 0,
      status: 'paid',
      termStart: '2026-07-01',
    },
  };
}

const ADMIN: UserContext = { uid: 'admin-1', role: 'admin', name: 'Admin' };

function request(studentId: string) {
  return { query: { studentId } } as never;
}

type Report = { student: Record<string, unknown>; ledgers?: Array<Record<string, unknown>> };

describe('readStudentAdminReport resolves identity before it reads anything', () => {
  beforeEach(() => resetCanonicalStudentReadControlCacheForTests());

  it('serves the surviving profile when opened by a retired id', async () => {
    // The retired document is a tombstone: it has no name, no contact, and no
    // money. Serving it looks like a working student record with everything
    // missing, which is worse than an error and much worse than the truth.
    const { db } = createInMemoryDocumentStore(mergedHumanSeed());

    const report = (await readStudentAdminReport(db, ADMIN, request('legacy-1'))) as Report;

    expect(report.student).toMatchObject({ id: 'canonical-1', name: 'Quách Hoàng Minh' });
  });

  it('finds the money attached to the surviving id, not the retired one', async () => {
    const { db } = createInMemoryDocumentStore(mergedHumanSeed());

    const report = (await readStudentAdminReport(db, ADMIN, request('legacy-1'))) as Report;

    expect(report.ledgers?.map((ledger) => ledger.id)).toEqual(['ledger-1']);
  });

  it('resolves in legacy_compare too, because serving a tombstone is never right', async () => {
    const { db } = createInMemoryDocumentStore(mergedHumanSeed('legacy_compare'));

    const report = (await readStudentAdminReport(db, ADMIN, request('legacy-1'))) as Report;

    expect(report.student).toMatchObject({ id: 'canonical-1' });
  });

  it('still 404s an id that names nobody', async () => {
    const { db } = createInMemoryDocumentStore(mergedHumanSeed());

    await expect(readStudentAdminReport(db, ADMIN, request('ghost'))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('shows a parent the money on the surviving profile, not an empty page', async () => {
    // The linked account still names the retired profile. Reading it literally
    // returns nothing, and nothing looks exactly like "you owe nothing".
    const { db } = createInMemoryDocumentStore({
      ...mergedHumanSeed(),
      'receipts/receipt-1': {
        studentId: 'canonical-1',
        amount: 1_000_000,
        status: 'posted',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    });

    const result = (await readParentTuition(
      db,
      { uid: 'parent-1', role: 'parent', name: 'PH', studentId: 'legacy-1' },
      { query: {} } as never
    )) as { ledgers: Array<{ id: string }> };

    expect(result.ledgers.map((ledger) => ledger.id)).toEqual(['ledger-1']);
  });

  it('shows a parent the notifications addressed to the surviving profile', async () => {
    const { db } = createInMemoryDocumentStore({
      ...mergedHumanSeed(),
      'notifications/note-1': {
        studentId: 'canonical-1',
        title: 'Học phí tháng 7',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    });

    const result = (await readNotifications(
      db,
      { uid: 'parent-1', role: 'parent', name: 'PH', studentId: 'legacy-1' },
      { query: {} } as never
    )) as { notifications: Array<{ id: string }> };

    expect(result.notifications.map((note) => note.id)).toEqual(['note-1']);
  });

  it('authorizes a teacher by the current enrollment, not the stale profile field', async () => {
    // The profile still names the old teacher. The enrollment is what says who
    // teaches this student now, so the old teacher must lose access and the
    // current one must have it.
    const seed = mergedHumanSeed();
    seed['students/canonical-1'] = {
      ...seed['students/canonical-1'],
      teacherId: 'teacher-old',
    };
    const { db } = createInMemoryDocumentStore(seed);

    await expect(
      readStudentAdminReport(
        db,
        { uid: 'teacher-old', role: 'teacher', name: 'Cô Cũ' },
        request('canonical-1')
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    const report = (await readStudentAdminReport(
      db,
      { uid: 'teacher-2', role: 'teacher', name: 'Cô Hai' },
      request('canonical-1')
    )) as Report;
    expect(report.student).toMatchObject({ id: 'canonical-1' });
  });
});
