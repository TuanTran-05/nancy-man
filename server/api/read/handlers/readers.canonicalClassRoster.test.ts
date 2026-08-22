import { beforeEach, describe, expect, it } from 'vitest';
import { readClassDetail } from './readers.js';
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

const ADMIN: UserContext = { uid: 'admin-1', role: 'admin', name: 'Admin' };

function request(classId: string, attendanceTermStart?: string) {
  return {
    query: {
      classId,
      ...(attendanceTermStart ? { attendanceTermStart } : {}),
    },
  } as never;
}

/**
 * Two students the profile projection and the enrollment disagree about, in
 * both directions: one profile claims a class it has no enrollment for, and
 * one has an enrollment the profile never recorded.
 */
function seed(mode: string): Seed {
  return {
    ...control(mode),
    'classes/class-g7': {
      name: 'G7',
      teacherId: 'teacher-2',
      status: 'active',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
    },
    'students/claims-only': {
      name: 'Chỉ Nói Miệng',
      classId: 'class-g7',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    },
    'students/enrolled-only': {
      name: 'Có Ghi Danh',
      classId: 'class-old',
      enrollmentStatus: 'promoted',
      studentLifecycle: 'enrolled',
    },
    ...enrollment('enrolled-only', 'class-g7', '2026-07-01', 'active'),
  };
}

type ClassDetail = { students: Array<Record<string, unknown>> };

function idsOf(detail: ClassDetail): string[] {
  return detail.students.map((student) => String(student.id));
}

describe('readClassDetail roster', () => {
  beforeEach(() => resetCanonicalStudentReadControlCacheForTests());

  it('uses the course-term roster even while global reads remain legacy_compare', async () => {
    const { db } = createInMemoryDocumentStore(seed('legacy_compare'));

    const detail = (await readClassDetail(db, ADMIN, request('class-g7'))) as ClassDetail;

    expect(idsOf(detail)).toEqual(['enrolled-only']);
    expect(detail.students[0]).toMatchObject({
      id: 'enrolled-only',
      classId: 'class-g7',
      attendanceEnrollment: {
        classId: 'class-g7',
        termStart: '2026-07-01',
        joinedAt: '2026-07-01',
        status: 'active',
      },
    });
  });

  it('rosters by enrollment in canonical modes, in both directions', async () => {
    // A stale profile field can neither add a student to a class nor hide one
    // from it. Both halves matter: the first is a phantom on the register, the
    // second is a real child nobody can mark present.
    const { db } = createInMemoryDocumentStore(seed('canonical_preferred'));

    const detail = (await readClassDetail(db, ADMIN, request('class-g7'))) as ClassDetail;

    expect(idsOf(detail)).toEqual(['enrolled-only']);
  });

  it('drops a student from the roster once their enrollment closes', async () => {
    const { db } = createInMemoryDocumentStore({
      ...control('canonical_preferred'),
      'classes/class-g7': {
        name: 'G7',
        teacherId: 'teacher-2',
        status: 'active',
        startDate: '2026-01-05',
        endDate: '2026-06-30',
      },
      'students/left': {
        name: 'Đã Chuyển',
        // The profile still says this class; only the enrollment moved.
        classId: 'class-g7',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('left', 'class-g7', '2026-01-05', 'transferred'),
    });

    const detail = (await readClassDetail(db, ADMIN, request('class-g7'))) as ClassDetail;

    expect(detail.students).toEqual([]);
  });

  it('falls back to profile classId when class has no startDate', async () => {
    const { db } = createInMemoryDocumentStore({
      ...control('legacy_compare'),
      'classes/class-no-start': { name: 'No Start', teacherId: 'teacher-2', status: 'active' },
      'students/profile-student': {
        name: 'Profile Student',
        classId: 'class-no-start',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
    });

    const detail = (await readClassDetail(db, ADMIN, request('class-no-start'))) as ClassDetail;

    expect(idsOf(detail)).toEqual(['profile-student']);
  });

  it('returns the historical course roster and its exact enrollment for attendance', async () => {
    const { db } = createInMemoryDocumentStore({
      ...seed('legacy_compare'),
      'classes/class-g7': {
        name: 'G7',
        teacherId: 'teacher-2',
        status: 'active',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        terms: [
          {
            id: 'course-old',
            startDate: '2026-01-05',
            endDate: '2026-06-30',
            daysOfWeek: [1, 3],
          },
        ],
      },
      'students/historical': {
        name: 'Historical Student',
        classId: 'class-other',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('historical', 'class-g7', '2026-01-05', 'completed'),
    });

    const detail = (await readClassDetail(
      db,
      ADMIN,
      request('class-g7', '2026-01-05')
    )) as ClassDetail;

    expect(idsOf(detail)).toEqual(['historical']);
    expect(detail.students[0]).toMatchObject({
      id: 'historical',
      classId: 'class-g7',
      attendanceEnrollment: {
        classId: 'class-g7',
        termStart: '2026-01-05',
        joinedAt: '2026-01-05',
        status: 'completed',
      },
    });
  });

  it('rejects an attendance term outside the class course history', async () => {
    const { db } = createInMemoryDocumentStore(seed('legacy_compare'));

    await expect(
      readClassDetail(db, ADMIN, request('class-g7', '2025-01-01'))
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
