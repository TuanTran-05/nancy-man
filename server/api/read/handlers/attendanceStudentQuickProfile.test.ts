import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { readAttendanceStudentQuickProfile } from './attendanceStudentQuickProfile.js';
import {
  resetCanonicalStudentReadControlCacheForTests,
  STUDENT_IDENTITY_READ_MODEL_PATH,
} from '../../lib/student/canonicalStudentReadControl.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import type { UserContext } from '../../lib/auth/authz.js';

const ADMIN = { uid: 'admin-1', role: 'admin', name: 'Admin' } as UserContext;
const OFFICE = { uid: 'office-1', role: 'office', name: 'Office' } as UserContext;
const TEACHER = { uid: 'teacher-1', role: 'teacher', name: 'Teacher' } as UserContext;
const enrollmentId = makeStudentCourseEnrollmentId('student-1', 'class-1', '2026-08-03');

function request(studentId = 'student-1', classId = 'class-1') {
  return { query: { studentId, classId } } as never;
}

function seed() {
  return {
    [STUDENT_IDENTITY_READ_MODEL_PATH]: {
      schemaVersion: 1,
      mode: 'canonical_preferred',
      generation: 1,
      activatedAt: '2026-08-01T00:00:00.000Z',
      activatedBy: 'admin-1',
    },
    'classes/class-1': {
      name: 'Movers 2',
      teacherId: 'teacher-1',
      status: 'active',
      startDate: '2026-08-03',
      endDate: '2026-08-31',
      daysOfWeek: [1, 3],
      weeklySessions: [],
      holidays: [],
    },
    'students/student-1': {
      name: 'Nguyễn Minh Anh',
      studentId: 'HS-0248',
      classId: 'class-1',
      teacherId: 'teacher-1',
      dob: '2014-04-15',
      contact: '0901234567',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    },
    [`student_course_enrollments/${enrollmentId}`]: {
      id: enrollmentId,
      studentId: 'student-1',
      classId: 'class-1',
      termStart: '2026-08-03',
      termEnd: '2026-08-31',
      status: 'active',
      joinedAt: '2026-08-03',
      endedAt: null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: '2026-08-03T00:00:00.000Z',
      statusChangedBy: 'admin-1',
      confirmedAt: '2026-08-03T00:00:00.000Z',
      confirmedBy: 'admin-1',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    },
    'attendance/attendance-1': {
      studentId: 'student-1',
      classId: 'class-1',
      date: '2026-08-03',
      status: 'present',
    },
    'course_fee_ledgers/ledger-1': {
      studentId: 'student-1',
      classId: 'class-1',
      amount: 10_000_000,
      discountTotal: 0,
      paidTotal: 7_000_000,
      status: 'partial',
      termStart: '2026-08-03',
    },
    'course_fee_ledgers/ledger-old': {
      studentId: 'student-1',
      classId: 'class-old',
      amount: 5_000_000,
      discountTotal: 0,
      paidTotal: 5_000_000,
      status: 'paid',
      termStart: '2026-01-01',
    },
  };
}

describe('readAttendanceStudentQuickProfile', () => {
  beforeEach(() => resetCanonicalStudentReadControlCacheForTests());

  it('returns aggregate finance to admin', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    const result = await readAttendanceStudentQuickProfile(db, ADMIN, request());
    expect(result.finance).toEqual({
      hasLedgerData: true,
      totalPaid: 12_000_000,
      totalOutstanding: 3_000_000,
    });
    expect(result.student).not.toHaveProperty('code');
    expect(result.student).not.toHaveProperty('loginPasswordHash');
    expect(result.student).not.toHaveProperty('parentPasswordHash');
    expect(result.student).not.toHaveProperty('parentLogin');
    expect(result).not.toHaveProperty('attendanceRows');
    expect(result).not.toHaveProperty('ledgers');
    expect(result).not.toHaveProperty('receipts');
  });

  it('omits finance for office while retaining profile and attendance', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    const result = await readAttendanceStudentQuickProfile(db, OFFICE, request());

    expect(result.finance).toBeUndefined();
    expect(result.student).toMatchObject({
      id: 'student-1',
      studentId: 'HS-0248',
      classId: 'class-1',
    });
    expect(result.attendance).toEqual({ attendedSessions: 1, totalSessions: 9 });
  });

  it('omits finance for the class teacher', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    const result = await readAttendanceStudentQuickProfile(db, TEACHER, request());
    expect(result.finance).toBeUndefined();
  });

  it('returns not found to a teacher outside the class', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    await expect(
      readAttendanceStudentQuickProfile(
        db,
        { uid: 'teacher-2', role: 'teacher', name: 'Other' },
        request()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('distinguishes no ledger evidence from a zero balance', async () => {
    const withoutLedgers = Object.fromEntries(
      Object.entries(seed()).filter(([path]) => !path.startsWith('course_fee_ledgers/'))
    );
    const { db } = createInMemoryDocumentStore(withoutLedgers);
    const result = await readAttendanceStudentQuickProfile(db, ADMIN, request());
    expect(result.finance).toEqual({
      hasLedgerData: false,
      totalPaid: 0,
      totalOutstanding: 0,
    });
  });

  it('keeps confirmed zero ledger values numeric', async () => {
    const zeroLedgerSeed = {
      ...seed(),
      'course_fee_ledgers/ledger-1': {
        studentId: 'student-1',
        classId: 'class-1',
        amount: 0,
        discountTotal: 0,
        paidTotal: 0,
        status: 'paid',
        termStart: '2026-08-03',
      },
      'course_fee_ledgers/ledger-old': {
        studentId: 'student-1',
        classId: 'class-old',
        amount: 0,
        discountTotal: 0,
        paidTotal: 0,
        status: 'paid',
        termStart: '2026-01-01',
      },
    };
    const { db } = createInMemoryDocumentStore(zeroLedgerSeed);
    const result = await readAttendanceStudentQuickProfile(db, ADMIN, request());
    expect(result.finance).toEqual({
      hasLedgerData: true,
      totalPaid: 0,
      totalOutstanding: 0,
    });
  });

  it('resolves a retired profile id before reading attendance and finance', async () => {
    const aliasSeed = {
      ...seed(),
      'student_profile_aliases/legacy-1': {
        legacyProfileId: 'legacy-1',
        canonicalProfileId: 'student-1',
        mergeRunId: 'merge-run-1',
        reasonCode: 'profile_normalization',
        sourceFingerprint: 'a'.repeat(64),
        createdAt: '2026-08-01T00:00:00.000Z',
        createdBy: 'admin-1',
      },
      'students/legacy-1': {
        studentProfileState: 'merged_tombstone',
        canonicalProfileId: 'student-1',
        mergeRunId: 'merge-run-1',
        mergedAt: '2026-08-01T00:00:00.000Z',
        identityWriteDisabled: true,
        authDisabled: true,
        walletOwnership: 'canonicalized',
        tombstoneSourceFingerprint: 'a'.repeat(64),
      },
    };
    const { db } = createInMemoryDocumentStore(aliasSeed);
    const result = await readAttendanceStudentQuickProfile(
      db,
      ADMIN,
      request('legacy-1', 'class-1')
    );
    expect(result.student.id).toBe('student-1');
    expect(result.attendance).toEqual({ attendedSessions: 1, totalSessions: 9 });
    expect(result.finance).toEqual({
      hasLedgerData: true,
      totalPaid: 12_000_000,
      totalOutstanding: 3_000_000,
    });
  });

  it('returns unknown attendance instead of using truncated evidence', async () => {
    const excessiveSessions = Object.fromEntries(
      Array.from({ length: 5_001 }, (_, index) => [
        `class_sessions/session-${index}`,
        {
          classId: 'class-1',
          date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
          status: 'makeup',
        },
      ])
    );
    const { db } = createInMemoryDocumentStore({ ...seed(), ...excessiveSessions });
    const result = await readAttendanceStudentQuickProfile(db, ADMIN, request());
    expect(result.attendance).toBeNull();
  });
});
