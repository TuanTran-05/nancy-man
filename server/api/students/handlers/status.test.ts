import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enforceDocumentStoreReadBeforeWrite } from '../../../../test-utils/strictDocumentStoreTransaction.js';
import { resetCanonicalStudentReadControlCacheForTests } from '../../lib/student/canonicalStudentReadControl.js';
import { handleStatus } from './status.js';
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
  profile: Record<string, unknown>,
  options: {
    enrollmentStatus?: 'active' | 'on_leave';
    classTeacherId?: string;
  } = {}
) {
  const enrollment = {
    id: makeStudentCourseEnrollmentId('stu-1', 'class-canonical', '2026-07-01'),
    studentId: 'stu-1',
    classId: 'class-canonical',
    termStart: '2026-07-01',
    termEnd: '2026-09-30',
    status: options.enrollmentStatus ?? 'on_leave',
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
  const classRef = refFor('classes/class-canonical', {
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
      if (target === enrollmentQuery) {
        return { docs: [snapshot(enrollment.id, enrollment)] };
      }
      return target.get();
    }),
    update: vi.fn(),
    create: vi.fn(),
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
          doc: vi.fn((id: string) =>
            id === enrollment.id ? enrollmentRef : refFor(`student_course_enrollments/${id}`)
          ),
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

describe('handleStatus canonical lifecycle projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCanonicalStudentReadControlCacheForTests();
    courseClosingMocks.invalidateCourseClosingApprovals.mockResolvedValue([]);
  });

  it('uses the canonical open enrollment when the profile has no legacy placement', async () => {
    const mocked = makeDb('canonical_required', {
      name: 'Canonical Student',
      studentLifecycle: 'enrolled',
    });
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Returned' },
        headers: {},
      } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.enrollmentRef,
      expect.objectContaining({ classId: 'class-canonical', status: 'active' })
    );
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.studentRef,
      expect.objectContaining({
        classId: expect.objectContaining({ __op: 'deleteField' }),
        teacherId: expect.objectContaining({ __op: 'deleteField' }),
        enrollmentStatus: expect.objectContaining({ __op: 'deleteField' }),
      })
    );
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.studentUserRef,
      expect.objectContaining({
        classId: expect.objectContaining({ __op: 'deleteField' }),
        teacherId: expect.objectContaining({ __op: 'deleteField' }),
        enrollmentStatus: expect.objectContaining({ __op: 'deleteField' }),
      })
    );
  });

  it('keeps legacy relationship values in canonical_preferred mode', async () => {
    const mocked = makeDb('canonical_preferred', {
      name: 'Compatibility Student',
      classId: 'class-canonical',
      teacherId: 'teacher-1',
      enrollmentStatus: 'on_leave',
      studentLifecycle: 'enrolled',
    });
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Returned' },
        headers: {},
      } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.studentRef,
      expect.objectContaining({
        classId: 'class-canonical',
        teacherId: 'teacher-1',
        enrollmentStatus: 'active',
      })
    );
  });

  it('restores an archived profile from its canonical open enrollment without legacy placement', async () => {
    const mocked = makeDb('canonical_required', {
      name: 'Archived Canonical Student',
      studentLifecycle: 'archived',
      isRevoked: true,
      deletedAt: '2026-07-20T00:00:00.000Z',
    });
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Restored' },
        headers: {},
      } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.enrollmentRef,
      expect.objectContaining({ classId: 'class-canonical', status: 'active' })
    );
  });

  it('rejects dropped for an archived profile without clearing archive state', async () => {
    const mocked = makeDb('canonical_required', {
      name: 'Archived Student',
      studentLifecycle: 'archived',
      isRevoked: true,
      archivedAt: '2026-07-20T00:00:00.000Z',
      deletedAt: '2026-07-20T00:00:00.000Z',
    });
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'dropped', statusNote: 'Still archived' },
        headers: {},
      } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(400);
    expect(mocked.tx.update).not.toHaveBeenCalled();
  });

  it('uses canonical placement for dropped counters and course-closing invalidation', async () => {
    const mocked = makeDb(
      'canonical_required',
      {
        name: 'Clean Canonical Student',
        studentLifecycle: 'enrolled',
      },
      { enrollmentStatus: 'active' }
    );
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'dropped', statusNote: 'Left course' },
        headers: {},
      } as any,
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
      ['class-canonical'],
      'admin-1',
      'REQUIRED_ROSTER_CHANGED'
    );
  });

  it('does not create a false leave delta while only cleaning stale profile projections', async () => {
    const mocked = makeDb(
      'canonical_required',
      {
        name: 'Stale Projection Student',
        classId: 'class-canonical',
        enrollmentStatus: 'on_leave',
        studentLifecycle: 'enrolled',
      },
      { enrollmentStatus: 'active' }
    );
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Projection cleanup' },
        headers: {},
      } as any,
      res,
      mocked.db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).not.toHaveBeenCalledWith(
      mocked.classRef,
      expect.objectContaining({ 'studentCounts.onLeave': expect.anything() })
    );
    expect(courseClosingMocks.invalidateCourseClosingApprovals).toHaveBeenCalledWith(
      mocked.db,
      [],
      'admin-1',
      'REQUIRED_ROSTER_CHANGED'
    );
  });

  it('authorizes the teacher assigned through the canonical enrollment class', async () => {
    const mocked = makeDb(
      'canonical_required',
      { name: 'Canonical Student', studentLifecycle: 'enrolled' },
      { classTeacherId: 'teacher-1' }
    );
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Returned' },
        headers: {},
      } as any,
      res,
      mocked.db,
      { uid: 'teacher-1' },
      { role: 'teacher', name: 'Assigned Teacher' }
    );

    expect(res.statusCode).toBe(200);
  });

  it('rejects an unassigned teacher before any lifecycle write', async () => {
    const mocked = makeDb(
      'canonical_required',
      { name: 'Canonical Student', studentLifecycle: 'enrolled' },
      { classTeacherId: 'teacher-2' }
    );
    const res = response();

    await handleStatus(
      {
        method: 'PUT',
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Unauthorized' },
        headers: {},
      } as any,
      res,
      mocked.db,
      { uid: 'teacher-1' },
      { role: 'teacher', name: 'Unassigned Teacher' }
    );

    expect(res.statusCode).toBe(403);
    expect(mocked.tx.update).not.toHaveBeenCalled();
  });
});
