import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importStudentsFromClass } from './studentImportHelper.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import {
  createInMemoryDocumentStore,
  pathsIn,
} from '../../../../test-utils/inMemoryDocumentStore.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

const SOURCE_CLASS = 'class-source';
const TARGET_CLASS = 'class-target';
const SOURCE_TERM = '2026-01-05';
const TARGET_TERM = '2026-07-01';

function enrollment(
  profileId: string,
  classId: string,
  termStart: string,
  status: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    [`student_course_enrollments/${makeStudentCourseEnrollmentId(profileId, classId, termStart)}`]: {
      id: makeStudentCourseEnrollmentId(profileId, classId, termStart),
      studentId: profileId,
      classId,
      termStart,
      termEnd: '2026-06-30',
      status,
      joinedAt: termStart,
      endedAt: ['completed', 'transferred', 'dropped'].includes(status) ? '2026-06-30' : null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: '2026-01-05T00:00:00.000Z',
      statusChangedBy: 'seed',
      confirmedAt: '2026-01-05T00:00:00.000Z',
      confirmedBy: 'seed',
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
      ...overrides,
    },
  };
}

function profile(id: string, overrides: Record<string, unknown> = {}) {
  return {
    [`students/${id}`]: {
      name: 'Quách Hoàng Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      studentId: 'HS260167',
      classId: SOURCE_CLASS,
      teacherId: 'teacher-1',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
      grade: 5,
      ...overrides,
    },
  };
}

const CLASSES = {
  [`classes/${SOURCE_CLASS}`]: {
    name: 'Source',
    teacherId: 'teacher-1',
    startDate: SOURCE_TERM,
    endDate: '2026-06-30',
  },
  [`classes/${TARGET_CLASS}`]: {
    name: 'Target',
    teacherId: 'teacher-2',
    tuitionFee: 2_000_000,
    startDate: TARGET_TERM,
    endDate: '2026-12-31',
    grade: 6,
  },
};

const INPUT = {
  sourceClassId: SOURCE_CLASS,
  targetClassId: TARGET_CLASS,
  teacherId: 'teacher-2',
  targetGrade: 6,
  actorId: 'admin-1',
  mutationOperation: 'classes:import-students' as const,
  kind: 'course_completion' as const,
  now: '2026-08-08T01:00:00.000Z',
};

describe('class promotion no longer clones a profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reproduces the HS260167 promotion and leaves exactly one profile', async () => {
    const { db, store, writeLog } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-1'),
      ...enrollment('profile-1', SOURCE_CLASS, SOURCE_TERM, 'active'),
      'users/student:profile-1': { role: 'student', studentId: 'profile-1' },
      'users/parent:profile-1': { role: 'parent', studentId: 'profile-1' },
    });

    const summary = await importStudentsFromClass(db, INPUT);

    expect(summary).toMatchObject({ eligibleCount: 1, progressedCount: 1, failures: [] });
    // The whole point: one human, one document, same id as before.
    expect(pathsIn(store, 'students')).toEqual(['students/profile-1']);
    expect(writeLog.filter((path) => path.startsWith('students/'))).toEqual([
      'students/profile-1',
    ]);

    const enrollments = [...store.entries()].filter(([path]) =>
      path.startsWith('student_course_enrollments/')
    );
    expect(enrollments).toHaveLength(2);
    expect(
      enrollments.filter(([, data]) => data.status === 'active').map(([, data]) => data.classId)
    ).toEqual([TARGET_CLASS]);
    expect(
      enrollments.filter(([, data]) => data.classId === SOURCE_CLASS)[0][1].status
    ).toBe('completed');

    // Linked users still point at the same profile, so login and the parent
    // portal follow the student rather than being orphaned on the old record.
    for (const role of ['student', 'parent']) {
      expect(store.get(`users/${role}:profile-1`)).toMatchObject({
        studentId: 'profile-1',
        classId: TARGET_CLASS,
      });
    }
  });

  it('changes nothing on a repeat run', async () => {
    const { db, store, writeLog } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-1'),
      ...enrollment('profile-1', SOURCE_CLASS, SOURCE_TERM, 'active'),
    });

    await importStudentsFromClass(db, INPUT);
    const afterFirst = new Map([...store.entries()].map(([path, data]) => [path, { ...data }]));
    writeLog.length = 0;

    const second = await importStudentsFromClass(db, INPUT);

    expect(second).toMatchObject({ progressedCount: 0, replayedCount: 1, failures: [] });
    // The pass takes and releases a mutation lease every time it runs. That
    // is operational bookkeeping, not a change to a student, so it is the one
    // path excluded from "nothing was written".
    const isLease = (path: string) =>
      path.startsWith('_maintenance/student_identity/active_mutations/');
    expect(writeLog.filter((path) => !isLease(path))).toEqual([]);
    expect([...store.keys()].filter((path) => !isLease(path)).sort()).toEqual(
      [...afterFirst.keys()].filter((path) => !isLease(path)).sort()
    );
  });

  it('never creates a student document or copies credentials', async () => {
    const { db, writeLog } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-1'),
      ...enrollment('profile-1', SOURCE_CLASS, SOURCE_TERM, 'active'),
      'student_auth_credentials/profile-1': { loginPasswordHash: 'secret' },
    });

    await importStudentsFromClass(db, INPUT);

    expect(writeLog.filter((path) => path.startsWith('student_auth_credentials/'))).toEqual([]);
    expect(writeLog.filter((path) => path.startsWith('students/auto-'))).toEqual([]);
  });

  it('carries the target class grade onto the profile', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-1'),
      ...enrollment('profile-1', SOURCE_CLASS, SOURCE_TERM, 'active'),
    });

    await importStudentsFromClass(db, INPUT);

    expect(store.get('students/profile-1')).toMatchObject({ grade: 6, classId: TARGET_CLASS });
  });
});

describe('the source roster comes from enrollment authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores a stale students.classId and follows the enrollment instead', async () => {
    // The profile still claims the source class but its enrollment says it left.
    // Reading students.classId is how the old helper promoted people twice.
    const { db, store } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-gone'),
      ...enrollment('profile-gone', SOURCE_CLASS, SOURCE_TERM, 'dropped'),
    });

    const summary = await importStudentsFromClass(db, INPUT);

    expect(summary).toMatchObject({ eligibleCount: 0, progressedCount: 0 });
    expect(store.get('students/profile-gone')).toMatchObject({ classId: SOURCE_CLASS });
  });

  it('excludes transferred and dropped source records', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('p-dropped'),
      ...enrollment('p-dropped', SOURCE_CLASS, SOURCE_TERM, 'dropped'),
      ...profile('p-transferred'),
      ...enrollment('p-transferred', SOURCE_CLASS, SOURCE_TERM, 'transferred'),
    });

    const summary = await importStudentsFromClass(db, INPUT);

    expect(summary).toMatchObject({ eligibleCount: 0, skippedCount: 2 });
  });

  it('promotes the latest completed record when the course already closed', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-1', { enrollmentStatus: 'promoted' }),
      ...enrollment('profile-1', SOURCE_CLASS, SOURCE_TERM, 'completed'),
    });

    const summary = await importStudentsFromClass(db, INPUT);

    expect(summary).toMatchObject({ eligibleCount: 1, progressedCount: 1 });
    expect(store.get('students/profile-1')).toMatchObject({
      classId: TARGET_CLASS,
      enrollmentStatus: 'active',
    });
  });

  it('reports a per-profile failure without stopping the cohort', async () => {
    // One student is already open in an unrelated class, which progression
    // refuses. The rest of the cohort must still move.
    const { db, store } = createInMemoryDocumentStore({
      ...CLASSES,
      'classes/class-elsewhere': { name: 'Elsewhere', teacherId: 'teacher-3' },
      ...profile('p-ok'),
      ...enrollment('p-ok', SOURCE_CLASS, SOURCE_TERM, 'completed'),
      ...profile('p-busy'),
      ...enrollment('p-busy', SOURCE_CLASS, SOURCE_TERM, 'completed'),
      ...enrollment('p-busy', 'class-elsewhere', '2026-04-01', 'active'),
    });

    const summary = await importStudentsFromClass(db, INPUT);

    expect(summary.progressedCount).toBe(1);
    expect(summary.failures).toEqual([
      { profileId: 'p-busy', code: expect.stringContaining('STUDENT_PROGRESSION_SOURCE_INELIGIBLE') },
    ]);
    expect(store.get('students/p-ok')).toMatchObject({ classId: TARGET_CLASS });
    expect(store.get('students/p-busy')).toMatchObject({ classId: SOURCE_CLASS });
  });

  it('returns an empty summary when there is no source class', async () => {
    const { db, writeLog } = createInMemoryDocumentStore({ ...CLASSES });

    const summary = await importStudentsFromClass(db, { ...INPUT, sourceClassId: '' });

    expect(summary).toMatchObject({ eligibleCount: 0, progressedCount: 0, importedCount: 0 });
    expect(writeLog).toEqual([]);
  });
});

describe('finance and roster totals reach the caller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates rollover, created ledgers, and affected classes', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-1'),
      ...enrollment('profile-1', SOURCE_CLASS, SOURCE_TERM, 'active'),
      'course_fee_ledgers/ledger-source': {
        studentId: 'profile-1',
        classId: SOURCE_CLASS,
        termStart: SOURCE_TERM,
        amount: 1_000_000,
        paidTotal: 1_300_000,
        discountTotal: 0,
      },
    });

    const summary = await importStudentsFromClass(db, INPUT);

    expect(summary).toMatchObject({
      rolloverBalance: 300_000,
      createdLedgerCount: 1,
      affectedClassIds: [SOURCE_CLASS, TARGET_CLASS],
      // Kept so existing audit and response shapes keep working.
      importedCount: 1,
    });
  });
});

describe('class promotion holds a mutation lease', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is visible to the drain check for the whole pass, and releases after', async () => {
    // Promotion runs one transaction per student. Checking maintenance once at
    // the start leaves the rest of the pass invisible: the window could lift
    // while students are still being moved.
    const { db, store } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('profile-1'),
      ...enrollment('profile-1', SOURCE_CLASS, SOURCE_TERM, 'active'),
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: 't',
        updatedBy: 'operator',
      },
    });

    await importStudentsFromClass(db, INPUT);

    const leases = [...store.entries()].filter(([key]) =>
      key.startsWith('_maintenance/student_identity/active_mutations/')
    );
    expect(leases).toHaveLength(1);
    expect(leases[0][1]).toMatchObject({
      state: 'released',
      actorId: 'admin-1',
      operation: 'classes:import-students',
    });
  });
});
