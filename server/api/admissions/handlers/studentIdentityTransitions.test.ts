import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleTrialDecision } from './trialDecision.js';
import { handleCreateTrial } from './createTrial.js';
import { createInMemoryDocumentStore, pathsIn } from '../../../../test-utils/inMemoryDocumentStore.js';
import { resetCanonicalStudentReadControlCacheForTests } from '../../lib/student/canonicalStudentReadControl.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

vi.mock('@/server/db/documentStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/db/documentStore.js')>()),
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
    delete: vi.fn(() => ({ methodName: 'delete' })),
  },
}));

vi.mock('../../lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

/**
 * The admissions transitions this program most needs to protect: a decision
 * or a reactivation must land on the same canonical profile a request names,
 * even when that name is an alias, and never while identity maintenance is
 * running. `createTrial`'s reactivation path is the direct descendant of the
 * clone-based promotion this whole workstream replaces, so its "one profile,
 * not two" property gets its own regression test here.
 */
function makeReq(body: Record<string, unknown>) {
  return { method: 'POST', headers: {}, body } as never;
}

function makeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res as { statusCode: number; body: unknown; status: (c: number) => unknown; json: (b: unknown) => unknown };
}

const ADMIN = { uid: 'admin-1', email: 'admin@nancy.com' };
const ADMIN_INFO = { role: 'admin', name: 'Admin' };

const CLASS_1 = {
  'classes/class-1': { teacherId: 'teacher-1', name: 'Class 1', startDate: '2026-01-05', endDate: '2026-06-30' },
};

const CANONICAL_REQUIRED = {
  '_maintenance/student_identity_read_model': {
    schemaVersion: 1,
    mode: 'canonical_required',
    generation: 1,
    activatedAt: 't',
    activatedBy: 'test',
    normalizationRunId: 'run-1',
    planDigest: null,
    approvalDigest: null,
  },
};

function alias(legacyProfileId: string, canonicalProfileId: string) {
  return {
    legacyProfileId,
    canonicalProfileId,
    mergeRunId: 'run-1',
    reasonCode: 'profile_normalization',
    sourceFingerprint: 'a'.repeat(64),
    createdAt: 't',
    createdBy: 'merge',
  };
}

function trialEnrollment(studentId: string, classId = 'class-1') {
  const id = makeStudentCourseEnrollmentId(studentId, classId, '2026-01-05');
  return {
    path: `student_course_enrollments/${id}`,
    id,
    data: {
      id,
      studentId,
      classId,
      termStart: '2026-01-05',
      termEnd: '2026-06-30',
      status: 'trial',
      joinedAt: '2026-01-05',
      endedAt: null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: '2026-01-05T00:00:00.000Z',
      statusChangedBy: 'admin-1',
      confirmedAt: '2026-01-05T00:00:00.000Z',
      confirmedBy: 'admin-1',
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    },
  };
}

describe('trialDecision resolves the canonical profile before deciding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCanonicalStudentReadControlCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const TRIAL_STUDENT = {
    name: 'Quach Hoang Minh',
    dob: '2014-05-02',
    contact: '0900000000',
    classId: 'class-1',
    teacherId: 'teacher-1',
    trialClassId: 'class-1',
    trialTeacherId: 'teacher-1',
    studentLifecycle: 'trial',
    trialSessionCount: 2,
    trialRequiredSessions: 2,
  };

  it('decides the canonical profile even when the request names its alias', async () => {
    const enrollment = trialEnrollment('canonical-1');
    const { db, store, writeLog } = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/canonical-1': TRIAL_STUDENT,
      [enrollment.path]: enrollment.data,
      'attendance/att-1': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'present',
        date: '2026-01-06',
      },
      'attendance/att-2': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'present',
        date: '2026-01-07',
      },
      'student_profile_aliases/legacy-1': alias('legacy-1', 'canonical-1'),
      'students/legacy-1': {
        studentProfileState: 'merged_tombstone',
        canonicalProfileId: 'canonical-1',
        mergeRunId: 'run-1',
        mergedAt: 't',
        identityWriteDisabled: true,
        authDisabled: true,
        walletOwnership: 'canonicalized',
        tombstoneSourceFingerprint: 'b'.repeat(64),
      },
    });

    const res = makeRes();
    await handleTrialDecision(
      makeReq({ studentId: 'legacy-1', decision: 'accepted' }),
      res as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { studentId: string } }).data.studentId).toBe('canonical-1');
    expect(store.get('students/canonical-1')).toMatchObject({ studentLifecycle: 'enrolled' });
    // No write ever lands on the alias id itself -- it is a pointer, not a
    // second profile.
    expect(store.get('students/legacy-1')).toMatchObject({
      studentProfileState: 'merged_tombstone',
      canonicalProfileId: 'canonical-1',
    });
    expect(writeLog).not.toContain('students/legacy-1');

    await expect(
      handleTrialDecision(
        makeReq({ studentId: 'legacy-1', decision: 'rejected' }),
        makeRes() as never,
        db,
        ADMIN,
        ADMIN_INFO
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(store.get('students/canonical-1')).toMatchObject({
      studentLifecycle: 'enrolled',
      trialReviewStatus: 'accepted',
    });
  });

  it('rejects an alias decision when the canonical lifecycle changes before the transaction', async () => {
    const documentStore = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/canonical-1': TRIAL_STUDENT,
      'attendance/att-1': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'present',
        date: '2026-01-06',
      },
      'attendance/att-2': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'present',
        date: '2026-01-07',
      },
      'student_profile_aliases/legacy-1': alias('legacy-1', 'canonical-1'),
    });
    const realRunTransaction = (documentStore.db as any).runTransaction.bind(documentStore.db);
    (documentStore.db as any).runTransaction = async (callback: any) => {
      documentStore.store.set('students/canonical-1', {
        ...TRIAL_STUDENT,
        studentLifecycle: 'enrolled',
        trialReviewStatus: 'accepted',
      });
      return realRunTransaction(callback);
    };

    await expect(
      handleTrialDecision(
        makeReq({ studentId: 'legacy-1', decision: 'accepted' }),
        makeRes() as never,
        documentStore.db,
        ADMIN,
        ADMIN_INFO
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(documentStore.writeLog.filter((path) => path.startsWith('students/'))).toEqual([]);
    expect(documentStore.store.get('students/canonical-1')).toMatchObject({
      studentLifecycle: 'enrolled',
      trialReviewStatus: 'accepted',
    });
    expect(documentStore.store.has('students/legacy-1')).toBe(false);
  });

  it('removes legacy relationship projections when canonical mode is required', async () => {
    const enrollment = trialEnrollment('canonical-1');
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      ...CANONICAL_REQUIRED,
      'students/canonical-1': {
        ...TRIAL_STUDENT,
        enrollmentStatus: 'active',
      },
      [enrollment.path]: enrollment.data,
      'attendance/att-1': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'present',
        date: '2026-01-06',
      },
      'attendance/att-2': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'present',
        date: '2026-01-07',
      },
    });

    await handleTrialDecision(
      makeReq({ studentId: 'canonical-1', decision: 'accepted' }),
      makeRes() as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(store.get('students/canonical-1')).not.toHaveProperty('classId');
    expect(store.get('students/canonical-1')).not.toHaveProperty('teacherId');
    expect(store.get('students/canonical-1')).not.toHaveProperty('enrollmentStatus');
    expect(store.get('students/canonical-1')).toMatchObject({
      studentLifecycle: 'enrolled',
      trialClassId: 'class-1',
      trialTeacherId: 'teacher-1',
    });
  });

  it('uses the canonical trial enrollment and fresh class assignment when legacy placement conflicts', async () => {
    const enrollment = trialEnrollment('canonical-1');
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      ...CANONICAL_REQUIRED,
      'students/canonical-1': {
        ...TRIAL_STUDENT,
        classId: 'stale-class',
        teacherId: 'former-teacher',
        trialClassId: 'stale-trial-class',
        trialTeacherId: 'former-trial-teacher',
      },
      [enrollment.path]: enrollment.data,
      'attendance/att-1': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'present',
        date: '2026-01-06',
      },
      'attendance/att-2': {
        studentId: 'canonical-1',
        classId: 'class-1',
        status: 'late',
        date: '2026-01-07',
      },
    });

    const res = makeRes();
    await handleTrialDecision(
      makeReq({ studentId: 'canonical-1', decision: 'accepted' }),
      res as never,
      db,
      { uid: 'teacher-1', email: 'teacher@nancy.com' },
      { role: 'teacher', name: 'Assigned teacher' }
    );

    expect(res.statusCode).toBe(200);
    expect(store.get(enrollment.path)).toMatchObject({ status: 'active' });
    expect(store.get('students/canonical-1')).toMatchObject({ studentLifecycle: 'enrolled' });
  });

  it('moves the real repository row from trial to active in a create-trial-to-accept flow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      ...CANONICAL_REQUIRED,
    });
    const createRes = makeRes();
    await handleCreateTrial(
      makeReq({
        name: 'Created Trial Student',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
      }),
      createRes as never,
      db,
      ADMIN,
      ADMIN_INFO
    );
    const studentId = (createRes.body as { data: { studentId: string } }).data.studentId;
    const createdEnrollmentPath = pathsIn(store, 'student_course_enrollments')[0];
    store.set('attendance/create-flow-1', {
      studentId,
      classId: 'class-1',
      status: 'present',
      date: '2026-08-10',
    });
    store.set('attendance/create-flow-2', {
      studentId,
      classId: 'class-1',
      status: 'late',
      date: '2026-08-11',
    });
    vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'));

    const decisionRes = makeRes();
    await handleTrialDecision(
      makeReq({ studentId, decision: 'accepted' }),
      decisionRes as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(createRes.statusCode).toBe(201);
    expect(decisionRes.statusCode).toBe(200);
    expect(store.get(createdEnrollmentPath)).toMatchObject({
      studentId,
      classId: 'class-1',
      status: 'active',
    });
    expect(store.get(`students/${studentId}`)).toMatchObject({ studentLifecycle: 'enrolled' });
  });

  it('writes nothing while identity maintenance is read_only', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/canonical-1': TRIAL_STUDENT,
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'run-1',
        migrationActorId: 'merge-bot',
        updatedAt: 't',
        updatedBy: 'test',
      },
    });

    await expect(
      handleTrialDecision(
        makeReq({ studentId: 'canonical-1', decision: 'accepted' }),
        makeRes() as never,
        db,
        ADMIN,
        ADMIN_INFO
      )
    ).rejects.toThrow('STUDENT_IDENTITY_MAINTENANCE');
    expect(store.get('students/canonical-1')).toMatchObject({ studentLifecycle: 'trial' });
  });
});

describe('createTrial reactivation never creates a second profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('reuses the archived match instead of creating a new student document', async () => {
    const archived = {
      name: 'Quach Hoang Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      isRevoked: true,
      studentId: 'HS260099',
    };
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/archived-1': archived,
    });

    const res = makeRes();
    await handleCreateTrial(
      makeReq({
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
        selectedHistoricalStudentId: 'archived-1',
      }),
      res as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { studentId: string } }).data.studentId).toBe('archived-1');
    // The whole property under test: exactly one students/ document, same id
    // as before, now carrying the trial state.
    expect(pathsIn(store, 'students')).toEqual(['students/archived-1']);
    expect(store.get('students/archived-1')).toMatchObject({ studentLifecycle: 'trial' });
  });

  it('moves the existing closed system row to trial when reactivating the same canonical tuple', async () => {
    const archived = {
      name: 'Quach Hoang Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
      studentLifecycle: 'archived',
      isRevoked: true,
      studentId: 'HS260099',
    };
    const existing = trialEnrollment('archived-1');
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      ...CANONICAL_REQUIRED,
      'students/archived-1': archived,
      [existing.path]: {
        ...existing.data,
        status: 'dropped',
        endedAt: '2026-02-01',
        statusReason: 'previous_drop',
      },
    });

    const res = makeRes();
    await handleCreateTrial(
      makeReq({
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
        selectedHistoricalStudentId: 'archived-1',
      }),
      res as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(res.statusCode).toBe(200);
    expect(store.get(existing.path)).toMatchObject({
      status: 'trial',
      endedAt: null,
      statusReason: 'trial_reactivated',
    });
    expect(store.get('students/archived-1')).toMatchObject({ studentLifecycle: 'trial' });
  });

  it('moves counters from the prior canonical class when the archived profile has no legacy placement', async () => {
    const oldEnrollmentId = makeStudentCourseEnrollmentId(
      'archived-1',
      'class-old',
      '2025-09-01'
    );
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      ...CANONICAL_REQUIRED,
      'classes/class-old': { teacherId: 'teacher-old', name: 'Old Class' },
      'students/archived-1': {
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        admissionSearchName: 'quach hoang minh',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '84900000000',
        studentLifecycle: 'archived',
        isRevoked: true,
        studentId: 'HS260099',
      },
      [`student_course_enrollments/${oldEnrollmentId}`]: {
        ...trialEnrollment('archived-1', 'class-old').data,
        id: oldEnrollmentId,
        classId: 'class-old',
        termStart: '2025-09-01',
        termEnd: '2025-12-31',
        joinedAt: '2025-09-01',
        status: 'dropped',
        endedAt: '2025-12-01',
        statusReason: 'previous_drop',
      },
    });

    await handleCreateTrial(
      makeReq({
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
        selectedHistoricalStudentId: 'archived-1',
      }),
      makeRes() as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(store.get('classes/class-old')).toMatchObject({
      'studentCounts.total': 'increment:-1',
      'studentCounts.dropped': 'increment:-1',
    });
    expect(store.get('classes/class-1')).toMatchObject({
      'studentCounts.total': 'increment:1',
      'studentCounts.active': 'increment:1',
      'studentCounts.trial': 'increment:1',
    });
  });

  it('rejects a manual row conflict instead of reactivating only the profile lifecycle', async () => {
    const archived = {
      name: 'Quach Hoang Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
      studentLifecycle: 'archived',
      isRevoked: true,
      studentId: 'HS260099',
    };
    const existing = trialEnrollment('archived-1');
    const { db, store, writeLog } = createInMemoryDocumentStore({
      ...CLASS_1,
      ...CANONICAL_REQUIRED,
      'students/archived-1': archived,
      [existing.path]: {
        ...existing.data,
        status: 'dropped',
        endedAt: '2026-02-01',
        statusReason: 'manual_drop',
        source: 'manual',
      },
    });

    await expect(
      handleCreateTrial(
        makeReq({
          name: 'Quach Hoang Minh',
          dob: '2014-05-02',
          contact: '0900000000',
          grade: 5,
          classId: 'class-1',
          selectedHistoricalStudentId: 'archived-1',
        }),
        makeRes() as never,
        db,
        ADMIN,
        ADMIN_INFO
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(store.get('students/archived-1')).toMatchObject({ studentLifecycle: 'archived' });
    expect(store.get(existing.path)).toMatchObject({ status: 'dropped', source: 'manual' });
    expect(writeLog.filter((path) => path === 'students/archived-1')).toEqual([]);
  });

  it('promotes the canonical pending profile when pendingStudentId is an alias', async () => {
    const { db, store, writeLog } = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/pending-canonical': {
        name: 'Pending Student',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        studentId: 'HS260101',
        studentLifecycle: 'pending',
        admissionStatus: 'pending',
      },
      'student_profile_aliases/pending-legacy': alias('pending-legacy', 'pending-canonical'),
    });

    const res = makeRes();
    await handleCreateTrial(
      makeReq({ pendingStudentId: 'pending-legacy', classId: 'class-1' }),
      res as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { studentId: string } }).data.studentId).toBe('pending-canonical');
    expect(store.get('students/pending-canonical')).toMatchObject({ studentLifecycle: 'trial' });
    expect(store.has('students/pending-legacy')).toBe(false);
    expect(writeLog).not.toContain('students/pending-legacy');
    expect([...store.values()]).toContainEqual(
      expect.objectContaining({ studentId: 'pending-canonical', status: 'trial' })
    );
  });

  it('rejects pending promotion when the canonical lifecycle changes before the transaction', async () => {
    const documentStore = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/pending-canonical': {
        name: 'Pending Student',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        studentId: 'HS260101',
        studentLifecycle: 'pending',
        admissionStatus: 'pending',
      },
      'student_profile_aliases/pending-legacy': alias('pending-legacy', 'pending-canonical'),
    });
    const realRunTransaction = (documentStore.db as any).runTransaction.bind(documentStore.db);
    (documentStore.db as any).runTransaction = async (callback: any) => {
      documentStore.store.set('students/pending-canonical', {
        ...documentStore.store.get('students/pending-canonical'),
        studentLifecycle: 'enrolled',
      });
      return realRunTransaction(callback);
    };

    await expect(
      handleCreateTrial(
        makeReq({ pendingStudentId: 'pending-legacy', classId: 'class-1' }),
        makeRes() as never,
        documentStore.db,
        ADMIN,
        ADMIN_INFO
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(documentStore.writeLog.filter((path) => path.startsWith('students/'))).toEqual([]);
    expect(documentStore.store.get('students/pending-canonical')).toMatchObject({
      studentLifecycle: 'enrolled',
    });
  });

  it('reactivates one canonical target when physical archived matches collapse to it', async () => {
    const archived = {
      name: 'Quach Hoang Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      isRevoked: true,
      studentId: 'HS260099',
    };
    const { db, store, writeLog } = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/canonical-1': archived,
      'students/soft-merged-1': {
        ...archived,
        studentId: 'HS250001',
        mergedIntoStudentId: 'canonical-1',
      },
    });

    const res = makeRes();
    await handleCreateTrial(
      makeReq({
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
        selectedHistoricalStudentId: 'soft-merged-1',
      }),
      res as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { studentId: string } }).data.studentId).toBe('canonical-1');
    expect(store.get('students/canonical-1')).toMatchObject({ studentLifecycle: 'trial' });
    expect(store.get('students/soft-merged-1')).toMatchObject({
      studentLifecycle: 'archived',
      mergedIntoStudentId: 'canonical-1',
    });
    expect(writeLog).not.toContain('students/soft-merged-1');
    expect([...store.values()]).toContainEqual(
      expect.objectContaining({ studentId: 'canonical-1', status: 'trial' })
    );
  });

  it('does not fabricate an exact match by unioning complementary reasons from aliases', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/canonical-1': {
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0911111111',
        admissionSearchName: 'quach hoang minh',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '84911111111',
        studentLifecycle: 'archived',
        studentId: 'HS260099',
      },
      'students/soft-merged-1': {
        name: 'Different Stored Name',
        dob: '2014-05-02',
        contact: '0900000000',
        admissionSearchName: 'different stored name',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '84900000000',
        studentLifecycle: 'archived',
        studentId: 'HS250001',
        mergedIntoStudentId: 'canonical-1',
      },
    });

    const res = makeRes();
    await handleCreateTrial(
      makeReq({
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
      }),
      res as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(res.statusCode).toBe(201);
    expect((res.body as { data: { mode: string; studentId: string } }).data.mode).toBe('created');
    expect((res.body as { data: { studentId: string } }).data.studentId).not.toBe('canonical-1');
    expect(store.get('students/canonical-1')).toMatchObject({ studentLifecycle: 'archived' });
  });

  it('rejects reactivation when the canonical lifecycle changes before the transaction', async () => {
    const archived = {
      name: 'Quach Hoang Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      studentId: 'HS260099',
    };
    const documentStore = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/canonical-1': archived,
      'students/legacy-1': { ...archived, studentId: 'HS250001' },
      'student_profile_aliases/legacy-1': alias('legacy-1', 'canonical-1'),
    });
    const realRunTransaction = (documentStore.db as any).runTransaction.bind(documentStore.db);
    (documentStore.db as any).runTransaction = async (callback: any) => {
      documentStore.store.set('students/canonical-1', {
        ...archived,
        studentLifecycle: 'enrolled',
        enrollmentStatus: 'active',
      });
      return realRunTransaction(callback);
    };

    await expect(
      handleCreateTrial(
        makeReq({
          name: 'Quach Hoang Minh',
          dob: '2014-05-02',
          contact: '0900000000',
          grade: 5,
          classId: 'class-1',
          selectedHistoricalStudentId: 'legacy-1',
        }),
        makeRes() as never,
        documentStore.db,
        ADMIN,
        ADMIN_INFO
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(documentStore.writeLog.filter((path) => path.startsWith('students/'))).toEqual([]);
    expect(documentStore.store.get('students/canonical-1')).toMatchObject({
      studentLifecycle: 'enrolled',
    });
  });

  it('re-reads the destination class teacher and term inside reactivation transaction', async () => {
    const archived = {
      name: 'Quach Hoang Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      studentId: 'HS260099',
    };
    const documentStore = createInMemoryDocumentStore({
      ...CLASS_1,
      'students/archived-1': archived,
    });
    const realRunTransaction = (documentStore.db as any).runTransaction.bind(documentStore.db);
    (documentStore.db as any).runTransaction = async (callback: any) => {
      documentStore.store.set('classes/class-1', {
        teacherId: 'teacher-2',
        name: 'Class 1 moved',
        startDate: '2026-02-01',
        endDate: '2026-04-30',
      });
      return realRunTransaction(callback);
    };

    await handleCreateTrial(
      makeReq({
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
        joinedAt: '2026-02-10',
        selectedHistoricalStudentId: 'archived-1',
      }),
      makeRes() as never,
      documentStore.db,
      ADMIN,
      ADMIN_INFO
    );

    expect(documentStore.store.get('students/archived-1')).toMatchObject({
      teacherId: 'teacher-2',
      trialTeacherId: 'teacher-2',
      trialStartedAt: '2026-02-10T00:00:00.000Z',
      courseJoins: [{ classId: 'class-1', termStart: '2026-02-01', joinedAt: '2026-02-10' }],
    });
    expect([...documentStore.store.values()]).toContainEqual(
      expect.objectContaining({
        studentId: 'archived-1',
        termStart: '2026-02-01',
        joinedAt: '2026-02-10',
      })
    );
  });

  it('removes legacy relationship projections when reactivated in canonical mode', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...CLASS_1,
      ...CANONICAL_REQUIRED,
      'students/archived-1': {
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        admissionSearchName: 'quach hoang minh',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '84900000000',
        studentLifecycle: 'archived',
        enrollmentStatus: 'dropped',
        classId: 'old-class',
        teacherId: 'old-teacher',
        isRevoked: true,
        studentId: 'HS260099',
      },
    });

    await handleCreateTrial(
      makeReq({
        name: 'Quach Hoang Minh',
        dob: '2014-05-02',
        contact: '0900000000',
        grade: 5,
        classId: 'class-1',
        selectedHistoricalStudentId: 'archived-1',
      }),
      makeRes() as never,
      db,
      ADMIN,
      ADMIN_INFO
    );

    expect(store.get('students/archived-1')).not.toHaveProperty('classId');
    expect(store.get('students/archived-1')).not.toHaveProperty('teacherId');
    expect(store.get('students/archived-1')).not.toHaveProperty('enrollmentStatus');
    expect(store.get('students/archived-1')).toMatchObject({
      studentLifecycle: 'trial',
      trialClassId: 'class-1',
      trialTeacherId: 'teacher-1',
    });
    expect(store.get('classes/class-1')).toMatchObject({
      'studentCounts.total': 'increment:1',
      'studentCounts.active': 'increment:1',
      'studentCounts.trial': 'increment:1',
    });
  });
});
