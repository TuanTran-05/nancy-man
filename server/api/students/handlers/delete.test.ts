import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enforceDocumentStoreReadBeforeWrite } from '../../../../test-utils/strictDocumentStoreTransaction.js';
import { resetCanonicalStudentReadControlCacheForTests } from '../../lib/student/canonicalStudentReadControl.js';
import { handleDelete } from './delete.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
    delete: vi.fn(() => ({ __op: 'deleteField' })),
  },
}));

vi.mock('../../lib/student/studentCreation.js', () => ({
  writeStudentAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/services/accountingStudentSummaryService.js', () => ({
  refreshAccountingStudentSummariesAfterCommit: vi.fn().mockResolvedValue({
    rebuilt: [],
    queued: [],
    failed: [],
  }),
}));

const courseClosingMocks = vi.hoisted(() => ({
  invalidateCourseClosingApprovals: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../classes/helpers/courseClosing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../classes/helpers/courseClosing.js')>()),
  invalidateCourseClosingApprovals: courseClosingMocks.invalidateCourseClosingApprovals,
}));

function response() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function snapshot(id: string, data: Record<string, unknown>) {
  return { id, exists: true, data: () => data };
}

function makeDb(
  mode: 'canonical_preferred' | 'canonical_required',
  options: {
    profile?: Record<string, unknown>;
    classTeacherId?: string;
  } = {}
) {
  const profile = options.profile ?? {
    name: 'Student One',
    studentId: 'HS260001',
    classId: 'class-1',
    teacherId: 'teacher-1',
    enrollmentStatus: 'active',
    studentLifecycle: 'enrolled',
  };
  const enrollment = {
    id: makeStudentCourseEnrollmentId('stu-1', 'class-1', '2026-07-01'),
    studentId: 'stu-1',
    classId: 'class-1',
    termStart: '2026-07-01',
    termEnd: '2026-09-30',
    status: 'active',
    joinedAt: '2026-07-03',
    endedAt: null,
    statusReason: null,
    source: 'system',
    confidence: 'confirmed',
    statusChangedAt: '2026-07-03T01:00:00.000Z',
    statusChangedBy: 'admin-0',
    confirmedAt: '2026-07-03T01:00:00.000Z',
    confirmedBy: 'admin-0',
    createdAt: '2026-07-03T01:00:00.000Z',
    updatedAt: '2026-07-03T01:00:00.000Z',
  };
  const refs = new Map<string, any>();
  const refFor = (path: string, value?: Record<string, unknown>) => {
    if (!refs.has(path)) {
      refs.set(path, {
        id: path.split('/').at(-1),
        path,
        get: vi.fn(async () =>
          value ? snapshot(path.split('/').at(-1)!, value) : { exists: false, data: () => undefined }
        ),
      });
    }
    return refs.get(path);
  };
  const studentRef = refFor('students/stu-1', profile);
  const studentUserRef = refFor('users/student:stu-1', { role: 'student' });
  const parentUserRef = refFor('users/parent:stu-1');
  const enrollmentRef = refFor(`student_course_enrollments/${enrollment.id}`, enrollment);
  const classRef = refFor('classes/class-1', {
    teacherId: options.classTeacherId ?? 'teacher-1',
  });
  const enrollmentQuery = { kind: 'enrollment-query' };
  const tx = enforceDocumentStoreReadBeforeWrite({
    get: vi.fn(async (target: any) => {
      if (target.path === '_maintenance/student_identity') {
        return snapshot('student_identity', { mode: 'normal', generation: 1 });
      }
      if (target.path === '_maintenance/student_identity_read_model') {
        return snapshot('student_identity_read_model', { schemaVersion: 1, mode, generation: 1 });
      }
      if (target === enrollmentQuery) return { docs: [snapshot(enrollment.id, enrollment)] };
      return target.get();
    }),
    update: vi.fn(),
  });
  const db: any = {
    doc: vi.fn((path: string) => {
      if (path === '_maintenance/student_identity') {
        return refFor(path, { mode: 'normal', generation: 1 });
      }
      if (path === '_maintenance/student_identity_read_model') {
        return refFor(path, { schemaVersion: 1, mode, generation: 1 });
      }
      if (path === 'students/stu-1') return studentRef;
      return refFor(path);
    }),
    collection: vi.fn((name: string) => {
      if (name === 'students') return { doc: vi.fn(() => studentRef) };
      if (name === 'users') {
        return {
          doc: vi.fn((id: string) =>
            id === 'student:stu-1' ? studentUserRef : parentUserRef
          ),
        };
      }
      if (name === 'student_course_enrollments') {
        const query: any = {
          where: vi.fn(() => query),
          orderBy: vi.fn(() => enrollmentQuery),
          doc: vi.fn(() => enrollmentRef),
        };
        return query;
      }
      if (name === 'classes') return { doc: vi.fn(() => classRef) };
      return {};
    }),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };
  return { db, tx, studentRef, studentUserRef, enrollmentRef, classRef };
}

describe('handleDelete canonical lifecycle projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCanonicalStudentReadControlCacheForTests();
    courseClosingMocks.invalidateCourseClosingApprovals.mockResolvedValue([]);
  });

  it('deletes legacy relationship fields from the profile and linked user in canonical_required', async () => {
    const mocked = makeDb('canonical_required');
    const res = response();

    await handleDelete(
      { method: 'DELETE', body: { id: 'stu-1', reason: 'Left' }, query: {}, headers: {} } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    const deletedRelationships = expect.objectContaining({
      classId: expect.objectContaining({ __op: 'deleteField' }),
      teacherId: expect.objectContaining({ __op: 'deleteField' }),
      enrollmentStatus: expect.objectContaining({ __op: 'deleteField' }),
    });
    expect(mocked.tx.update).toHaveBeenCalledWith(mocked.studentRef, deletedRelationships);
    expect(mocked.tx.update).toHaveBeenCalledWith(mocked.studentUserRef, deletedRelationships);
  });

  it('keeps the legacy relationship projection in canonical_preferred', async () => {
    const mocked = makeDb('canonical_preferred');
    const res = response();

    await handleDelete(
      { method: 'DELETE', body: { id: 'stu-1', reason: 'Left' }, query: {}, headers: {} } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.studentRef,
      expect.objectContaining({
        classId: 'class-1',
        teacherId: 'teacher-1',
        enrollmentStatus: 'dropped',
      })
    );
  });

  it('uses canonical placement for clean-profile archive counters and course-closing invalidation', async () => {
    const mocked = makeDb('canonical_required', {
      profile: {
        name: 'Clean Canonical Student',
        studentId: 'HS260001',
        studentLifecycle: 'enrolled',
      },
    });
    const res = response();

    await handleDelete(
      { method: 'DELETE', body: { id: 'stu-1', reason: 'Left' }, query: {}, headers: {} } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.classRef,
      expect.objectContaining({
        'studentCounts.active': 'increment:-1',
        'studentCounts.dropped': 'increment:1',
      })
    );
    expect(courseClosingMocks.invalidateCourseClosingApprovals).toHaveBeenCalledWith(
      mocked.db,
      ['class-1'],
      'admin-1',
      'REQUIRED_ROSTER_CHANGED'
    );
  });

  it('authorizes the teacher assigned through the canonical enrollment class', async () => {
    const mocked = makeDb('canonical_required', {
      profile: { name: 'Canonical Student', studentLifecycle: 'enrolled' },
      classTeacherId: 'teacher-1',
    });
    const res = response();

    await handleDelete(
      { method: 'DELETE', body: { id: 'stu-1', reason: 'Left' }, query: {}, headers: {} } as any,
      res,
      mocked.db,
      { uid: 'teacher-1' },
      { role: 'teacher', name: 'Assigned Teacher' }
    );

    expect(res.statusCode).toBe(200);
  });

  it('rejects an unassigned teacher before any archive write', async () => {
    const mocked = makeDb('canonical_required', {
      profile: { name: 'Canonical Student', studentLifecycle: 'enrolled' },
      classTeacherId: 'teacher-2',
    });
    const res = response();

    await handleDelete(
      { method: 'DELETE', body: { id: 'stu-1', reason: 'Left' }, query: {}, headers: {} } as any,
      res,
      mocked.db,
      { uid: 'teacher-1' },
      { role: 'teacher', name: 'Unassigned Teacher' }
    );

    expect(res.statusCode).toBe(403);
    expect(mocked.tx.update).not.toHaveBeenCalled();
  });
});
