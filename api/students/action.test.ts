import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/students/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { enforceDocumentStoreReadBeforeWrite } from '../../test-utils/strictDocumentStoreTransaction.js';
import { makeStudentCourseEnrollmentId } from '../../shared/studentCourseEnrollment.js';
import { createInMemoryDocumentStore } from '../../test-utils/inMemoryDocumentStore.js';

const courseEnrollmentHandlerMock = vi.hoisted(() =>
  vi.fn(async (_req: any, res: any) => {
    return res.status(200).json({ success: true });
  })
);

vi.mock('../../server/api/students/handlers/courseEnrollment.js', () => ({
  handleCourseEnrollment: courseEnrollmentHandlerMock,
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => {
  const getDb = vi.fn();
  const verifyAuthToken = vi.fn();
  const verifyAuthContext = vi.fn(async (req, res, requiredRoles) => {
    const user = await verifyAuthToken(req, res, requiredRoles);
    if (!user) return null;
    const db = getDb();
    let role = 'unknown';
    let name = user.uid;
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      const data = userDoc?.data() || {};
      role = data.role || 'unknown';
      name = data.displayName || data.name || user.email || user.uid;
    } catch (e) {
      // ignore error
    }
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return null;
    }
    return {
      decoded: user,
      context: {
        uid: user.uid,
        email: user.email || '',
        role,
        name,
      },
    };
  });
  return {
    getDb,
    verifyAuthToken,
    verifyAuthContext,
  };
});

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  computeChanges: vi.fn(() => ({})),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// Student mutation tests stop at the post-commit accounting boundary. The
// rebuild/invalidation service is covered with a real in-memory DocumentStore
// in its own suite.
vi.mock('../../server/api/lib/services/accountingStudentSummaryService.js', () => ({
  refreshAccountingStudentSummariesAfterCommit: vi.fn().mockResolvedValue({
    rebuilt: [],
    queued: [],
    failed: [],
  }),
}));

function mockRes() {
  const res: any = { statusCode: 200 };
  res.setHeader = vi.fn();
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

function makeDoc(data: Record<string, unknown>, exists = true) {
  return { exists, data: () => data };
}

function makeStudentMutationDb({
  userRole = 'admin',
  userUid = userRole === 'teacher' ? 'teacher-1' : 'admin-uid',
  strictTransaction = false,
  openEnrollment = false,
  classTerm = false,
}: {
  userRole?: string;
  userUid?: string;
  strictTransaction?: boolean;
  openEnrollment?: boolean;
  classTerm?: boolean;
} = {}) {
  const adminUserRef = {
    id: userUid,
    get: vi.fn().mockResolvedValue(makeDoc({ role: userRole, displayName: 'Admin User' })),
  };
  const studentUserRef = {
    id: 'student:stu-1',
    get: vi.fn().mockResolvedValue(makeDoc({ role: 'student', studentId: 'stu-1' })),
  };
  const parentUserRef = {
    id: 'parent:stu-1',
    get: vi.fn().mockResolvedValue(makeDoc({ role: 'parent', studentId: 'stu-1' })),
  };
  const userDoc = vi.fn((id: string) => {
    if (id === userUid) return adminUserRef;
    if (id === 'student:stu-1') return studentUserRef;
    if (id === 'parent:stu-1') return parentUserRef;
    return { id, get: vi.fn().mockResolvedValue(makeDoc({}, false)) };
  });

  const studentRef = {
    id: 'stu-1',
    get: vi.fn().mockResolvedValue(
      makeDoc({
        name: 'Old Name',
        studentId: 'HS260001',
        dob: '2014-01-01',
        contact: '0384072314',
        classId: 'class-1',
        teacherId: 'teacher-1',
        enrollmentStatus: 'active',
        isRevoked: false,
      })
    ),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const studentsQuery: any = {
    doc: vi.fn((id: string) => {
      if (id === 'stu-1') return studentRef;
      return { id, get: vi.fn().mockResolvedValue(makeDoc({}, false)) };
    }),
    where: vi.fn(() => ({
      get: vi.fn().mockResolvedValue({ docs: [{ id: 'stu-1' }] }),
    })),
  };

  const termData = classTerm ? { startDate: '2026-01-01', endDate: '2026-12-31' } : {};
  const originalClassRef = {
    id: 'class-1',
    get: vi.fn().mockResolvedValue(makeDoc({ teacherId: 'teacher-1', ...termData })),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const classRef = {
    id: 'class-2',
    get: vi.fn().mockResolvedValue(makeDoc({ teacherId: 'teacher-2', ...termData })),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const enrollmentRef = { id: 'WyJzdHUtMSIsImNsYXNzLTEiLCIyMDI2LTAxLTAxIl0' };
  const enrollmentQuery: any = {
    where: vi.fn(() => enrollmentQuery),
    orderBy: vi.fn(() => enrollmentQuery),
    doc: vi.fn((id: string) =>
      id === enrollmentRef.id
        ? enrollmentRef
        : { id, get: vi.fn().mockResolvedValue(makeDoc({}, false)) }
    ),
  };
  const enrollmentDoc = {
    id: 'WyJzdHUtMSIsImNsYXNzLTEiLCIyMDI2LTAxLTAxIl0',
    data: () => ({
      studentId: 'stu-1',
      classId: 'class-1',
      termStart: '2026-01-01',
      termEnd: '2026-12-31',
      status: 'active',
      joinedAt: '2026-01-01',
      endedAt: null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: '2026-01-01T00:00:00.000Z',
      statusChangedBy: 'admin-uid',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      confirmedBy: 'admin-uid',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  };
  const baseTx = {
    get: vi.fn((ref: any) => {
      if (ref === enrollmentQuery) {
        return Promise.resolve({ docs: openEnrollment ? [enrollmentDoc] : [] });
      }
      if (ref?.id === enrollmentRef.id) return Promise.resolve(makeDoc({}, false));
      return ref.get();
    }),
    create: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const tx = strictTransaction ? enforceDocumentStoreReadBeforeWrite(baseTx) : baseTx;
  const db: any = {
    collection: vi.fn((name: string) => {
      if (name === 'users') return { doc: userDoc };
      if (name === 'students') return studentsQuery;
      if (name === 'classes') {
        return { doc: vi.fn((id: string) => (id === 'class-1' ? originalClassRef : classRef)) };
      }
      if (name === 'student_course_enrollments') return enrollmentQuery;
      return {};
    }),
    // Path-addressed reads: maintenance state, aliases, and the canonical
    // resolver's own profile lookup all arrive through db.doc rather than
    // db.collection(...).doc(...), so students/stu-1 has to route to the same
    // studentRef the collection-style lookups use. Everything else (no
    // maintenance window, no alias, no registry record) is absent, which is
    // the ordinary case.
    doc: vi.fn((path: string) => {
      if (path === 'students/stu-1') return studentRef;
      return {
        path,
        id: path.split('/').pop(),
        get: vi.fn().mockResolvedValue(makeDoc({}, false)),
      };
    }),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };

  return {
    db,
    tx,
    studentRef,
    studentUserRef,
    parentUserRef,
    originalClassRef,
    classRef,
    enrollmentRef,
  };
}

describe('POST /api/v1/students/update-profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'student:stu-1' } as any);
  });

  it('does not let a student profile update change the official student name', async () => {
    const userRef = { id: 'student:stu-1' };
    const studentRef = { id: 'stu-1' };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === studentRef) return makeDoc({ name: 'Official Name' });
        return makeDoc({});
      }),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              ...userRef,
              get: vi.fn().mockResolvedValue(
                makeDoc({
                  role: 'student',
                  studentId: 'stu-1',
                  displayName: 'Old Display',
                })
              ),
            })),
          };
        }
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'update-profile' },
        body: { displayName: 'Changed By Student', faceImage: 'https://example.com/avatar.png' },
      } as any,
      res
    );

    console.log(res.body); expect(res.statusCode).toBe(200);
    const studentUpdate = tx.update.mock.calls.find(([ref]) => ref === studentRef)?.[1];
    expect(studentUpdate).toBeDefined();
    expect(studentUpdate).not.toHaveProperty('name');
    expect(studentUpdate).toMatchObject({ faceImage: 'https://example.com/avatar.png' });
    expect(studentUpdate.updatedAt).not.toEqual(expect.any(String));
  });
});

describe('GET /api/v1/students/evaluation-insights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@nancy.com',
    } as any);
  });

  it('uses a bounded evaluation query when ranking a student', async () => {
    const evalsQuery: any = {
      limit: vi.fn(() => evalsQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            data: () => ({
              studentId: 'stu-1',
              classId: 'class-1',
              finalScore: 8,
              createdAt: '2026-05-10T00:00:00.000Z',
            }),
          },
          {
            data: () => ({
              studentId: 'stu-2',
              classId: 'class-1',
              finalScore: 9,
              createdAt: '2026-05-11T00:00:00.000Z',
            }),
          },
        ],
      }),
    };
    const evaluationsCollection = {
      where: vi.fn(() => evalsQuery),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ role: 'admin', displayName: 'Admin' })),
            })),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(makeDoc({ classId: 'class-1', teacherId: 'teacher-1' })),
            })),
          };
        }
        if (name === 'evaluations') return evaluationsCollection;
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'evaluation-insights', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(evaluationsCollection.where).toHaveBeenCalledWith('classId', '==', 'class-1');
    expect(evalsQuery.limit).toHaveBeenCalledWith(500);
    expect(res.body).toMatchObject({
      rank: 2,
      classification: 'Giỏi',
      myScore: 8,
    });
  });
});

describe('student linked user sync on mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@nancy.com',
    } as any);
  });

  it('syncs deterministic student and parent user docs when official student fields change', async () => {
    // The class stays put: a generic update may no longer move a student
    // between classes, so this covers what it may still do — rename the human
    // and have both linked user documents follow.
    const { db, tx, studentRef, studentUserRef, parentUserRef } = makeStudentMutationDb({
      strictTransaction: true,
      classTerm: true,
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'update' },
        body: {
          id: 'stu-1',
          name: 'New Name',
          studentId: 'HS260001',
          dob: '2014-01-01',
          contact: '0384072314',
          classId: 'class-1',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.get).toHaveBeenCalledWith(studentRef);
    expect(tx.update).toHaveBeenCalledWith(
      studentUserRef,
      expect.objectContaining({
        studentId: 'stu-1',
        displayName: 'NEW NAME',
        classId: 'class-1',
        teacherId: 'teacher-1',
        enrollmentStatus: 'active',
        isRevoked: false,
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      parentUserRef,
      expect.objectContaining({
        studentId: 'stu-1',
        classId: 'class-1',
        teacherId: 'teacher-1',
        enrollmentStatus: 'active',
        isRevoked: false,
      })
    );
    // No class count delta: nothing about the roster changed, only the name.
    expect(
      tx.update.mock.calls.filter(([, data]: [unknown, Record<string, unknown>]) =>
        Object.keys(data).some((key) => key.startsWith('studentCounts.'))
      )
    ).toEqual([]);
  });

  it('syncs enrollmentStatus to linked user docs when status changes', async () => {
    const { db, tx, studentRef, studentUserRef, parentUserRef, originalClassRef } =
      makeStudentMutationDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'stu-1', enrollmentStatus: 'promoted', statusNote: 'Graduated' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    // This suite owns the identity mutation transaction. The post-commit
    // accounting rebuild is mocked and verified in accountingStudentSummaryService.test.ts.
    expect(db.runTransaction).toHaveBeenCalledOnce();
    expect(tx.get).toHaveBeenCalledWith(studentRef);
    expect(tx.update).toHaveBeenCalledWith(
      studentUserRef,
      expect.objectContaining({ studentId: 'stu-1', enrollmentStatus: 'promoted' })
    );
    expect(tx.update).toHaveBeenCalledWith(
      parentUserRef,
      expect.objectContaining({ studentId: 'stu-1', enrollmentStatus: 'promoted' })
    );
    expect(tx.update).toHaveBeenCalledWith(
      originalClassRef,
      expect.objectContaining({
        'studentCounts.active': expect.anything(),
        'studentCounts.promoted': expect.anything(),
      })
    );
  });

  it('marks dropped status without soft-deleting the student', async () => {
    const { db, tx, studentRef, studentUserRef, parentUserRef } = makeStudentMutationDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'stu-1', enrollmentStatus: 'dropped', statusNote: 'Left class' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const studentUpdate = vi
      .mocked(tx.update)
      .mock.calls.find(([ref]) => ref === studentRef)?.[1] as Record<string, unknown>;
    expect(studentUpdate).toEqual(
      expect.objectContaining({
        enrollmentStatus: 'dropped',
        studentLifecycle: 'enrolled',
        isRevoked: false,
      })
    );
    expect(studentUpdate.deletedAt).not.toEqual(expect.any(String));
    expect(studentUpdate.deletedBy).not.toEqual(expect.any(String));
    expect(tx.update).toHaveBeenCalledWith(
      studentUserRef,
      expect.objectContaining({ enrollmentStatus: 'dropped', isRevoked: false })
    );
    expect(tx.update).toHaveBeenCalledWith(
      parentUserRef,
      expect.objectContaining({ enrollmentStatus: 'dropped', isRevoked: false })
    );
  });

  it('reads linked users before closing an enrollment on dropped status', async () => {
    const { db, tx, enrollmentRef } = makeStudentMutationDb({
      strictTransaction: true,
      openEnrollment: true,
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'stu-1', enrollmentStatus: 'dropped', statusNote: 'Left class' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      enrollmentRef,
      expect.objectContaining({ status: 'dropped' })
    );
  });

  // Code review fix: statusChangedAt is a UTC instant; slicing it directly
  // picks the wrong calendar day for part of the Vietnam morning.
  it('opens a leave period on the correct Vietnam calendar day, not the UTC-shifted one', async () => {
    // 2026-03-01T20:00:00Z = 2026-03-02T03:00 Vietnam time (UTC+7) — squarely
    // inside the 00:00-06:59 window where a naive UTC slice reads one day early.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T20:00:00.000Z'));
    try {
      const { db, tx, studentRef } = makeStudentMutationDb();
      vi.mocked(getDb).mockReturnValue(db);

      const res = mockRes();
      await handler(
        {
          method: 'PUT',
          headers: {},
          query: { action: 'status' },
          body: { id: 'stu-1', enrollmentStatus: 'on_leave', statusNote: 'Nghỉ ốm' },
        } as any,
        res
      );

      expect(res.statusCode).toBe(200);
      const studentUpdate = vi
        .mocked(tx.update)
        .mock.calls.find(([ref]) => ref === studentRef)?.[1] as Record<string, unknown>;
      expect(studentUpdate.leavePeriods).toEqual([
        expect.objectContaining({ from: '2026-03-02', until: null }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores revocation fields when archived student status changes to active', async () => {
    const { db, tx, studentRef, studentUserRef, parentUserRef } = makeStudentMutationDb();
    studentRef.get.mockResolvedValue(
      makeDoc({
        name: 'Old Name',
        studentId: 'HS260001',
        dob: '2014-01-01',
        contact: '0384072314',
        classId: 'class-1',
        teacherId: 'teacher-1',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'archived',
        isRevoked: true,
        deletedAt: '2026-05-24T00:00:00.000Z',
      })
    );
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Restored' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
        isRevoked: false,
        enrollmentDate: expect.anything(),
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      studentUserRef,
      expect.objectContaining({ enrollmentStatus: 'active', isRevoked: false })
    );
    expect(tx.update).toHaveBeenCalledWith(
      parentUserRef,
      expect.objectContaining({ enrollmentStatus: 'active', isRevoked: false })
    );
  });

  it('rejects restoring archived records without class assignment through status update', async () => {
    const { db, studentRef } = makeStudentMutationDb();
    studentRef.get.mockResolvedValue(
      makeDoc({
        name: 'Rejected Trial',
        studentId: 'HS260099',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'archived',
        isRevoked: true,
      })
    );
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Restore' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain('Admissions reactivation');
  });

  it('rejects teacher restore of soft-deleted archived records', async () => {
    const { db, studentRef } = makeStudentMutationDb({ userRole: 'teacher' });
    studentRef.get.mockResolvedValue(
      makeDoc({
        name: 'Soft Deleted Student',
        studentId: 'HS260001',
        classId: 'class-1',
        teacherId: 'teacher-1',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'archived',
        isRevoked: true,
        deletedAt: '2026-05-01T00:00:00.000Z',
      })
    );
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'teacher-1' } as any);
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'stu-1', enrollmentStatus: 'active', statusNote: 'Restore' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });

  it('syncs revocation state to linked user docs when a student is soft-deleted', async () => {
    const { db, tx, studentRef, studentUserRef, parentUserRef, originalClassRef } =
      makeStudentMutationDb({ strictTransaction: true, openEnrollment: true });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'DELETE',
        headers: {},
        query: { action: 'delete' },
        body: { id: 'stu-1', reason: 'Left school' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(db.runTransaction).toHaveBeenCalledOnce();
    expect(tx.get).toHaveBeenCalledWith(studentRef);
    expect(tx.update).toHaveBeenCalledWith(
      studentUserRef,
      expect.objectContaining({
        studentId: 'stu-1',
        enrollmentStatus: 'dropped',
        isRevoked: true,
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      parentUserRef,
      expect.objectContaining({
        studentId: 'stu-1',
        enrollmentStatus: 'dropped',
        isRevoked: true,
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      originalClassRef,
      expect.objectContaining({
        'studentCounts.active': expect.anything(),
        'studentCounts.dropped': expect.anything(),
      })
    );
  });
});

describe('office student academic permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@nancy.com',
    } as any);
  });

  it('allows office to create an official active student through normal student CRUD', async () => {
    const classSnap = { exists: true, data: () => ({ teacherId: 'teacher-1' }) };
    const classRef = { id: 'class-1', get: vi.fn().mockResolvedValue(classSnap) };
    const createdStudentRef = { id: 'student-new' };
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      doc: vi.fn(() => createdStudentRef),
    };
    const counterRef = { id: 'students_26', set: vi.fn().mockResolvedValue(undefined) };
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef
          ? { exists: true, data: () => ({ seq: 0 }) }
          : { empty: true, docs: [] }
      ),
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ role: 'office', displayName: 'Office' })),
            })),
          };
        }
        if (name === 'classes') {
          return { doc: vi.fn(() => classRef) };
        }
        if (name === 'students') {
          return studentsQuery;
        }
        if (name === '_counters') {
          return { doc: vi.fn(() => counterRef) };
        }
        return {};
      }),
      doc: vi.fn((path: string) => ({
        path,
        get: vi.fn().mockResolvedValue(makeDoc({}, false)),
      })),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create' },
        body: {
          name: 'Official Student',
          dob: '2014-01-01',
          contact: '0384072314',
          classId: 'class-1',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(tx.create).toHaveBeenCalledWith(
      createdStudentRef,
      expect.objectContaining({
        studentLifecycle: 'enrolled',
        enrollmentStatus: 'active',
        enrollmentDate: expect.anything(),
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      classRef,
      expect.objectContaining({
        'studentCounts.total': expect.anything(),
        'studentCounts.active': expect.anything(),
      })
    );
  });
});

describe('POST /api/v1/students/standardize-student-ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@nancy.com',
    } as any);
  });

  function buildStandardizeDb() {
    const validRef = { id: 'stu-1' };
    const invalidRef = { id: 'stu-2' };
    const extraRef = { id: 'stu-3' };
    const pageDocs = [
      { id: 'stu-1', ref: validRef, data: () => ({ studentId: 'HS260001', code: 'HS260001' }) },
      { id: 'stu-2', ref: invalidRef, data: () => ({ studentId: 'LEGACY-2', code: 'LEGACY-2' }) },
      { id: 'stu-3', ref: extraRef, data: () => ({ studentId: 'LEGACY-3', code: 'LEGACY-3' }) },
    ];
    const pageQuery: any = {
      startAfter: vi.fn(() => pageQuery),
      limit: vi.fn(() => pageQuery),
      get: vi.fn().mockResolvedValue({ docs: pageDocs }),
    };
    const maxIdQuery: any = {
      where: vi.fn(() => maxIdQuery),
      orderBy: vi.fn(() => maxIdQuery),
      limit: vi.fn(() => maxIdQuery),
    };
    const studentsCollection: any = {
      orderBy: vi.fn(() => pageQuery),
      where: vi.fn(() => maxIdQuery),
      get: vi.fn().mockResolvedValue({ docs: pageDocs }),
    };
    const counterRef = { id: 'students_26', set: vi.fn().mockResolvedValue(undefined) };
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef ? makeDoc({ seq: 5 }) : { empty: true, docs: [] }
      ),
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ role: 'admin', displayName: 'Admin' })),
            })),
          };
        }
        if (name === 'students') return studentsCollection;
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        return {};
      }),
      doc: vi.fn((path: string) => ({
        path,
        get: vi.fn().mockResolvedValue(makeDoc({}, false)),
      })),
      batch: vi.fn(() => ({
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      })),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    return { db, tx, studentsCollection, pageQuery, invalidRef, extraRef };
  }

  function standardizeReq(body: Record<string, unknown>) {
    return {
      method: 'POST',
      headers: {},
      query: { action: 'standardize-student-ids' },
      body,
    } as any;
  }

  it('plans a bounded page without writing anything', async () => {
    // A bulk rename of student codes is an identity change across many humans.
    // Nothing happens until an operator has seen exactly which profiles it
    // covers, so the default call is a report.
    const { db, studentsCollection, pageQuery } = buildStandardizeDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(standardizeReq({ batchSize: 2 }), res);

    expect(res.statusCode).toBe(200);
    expect(studentsCollection.get).not.toHaveBeenCalled();
    expect(studentsCollection.orderBy).toHaveBeenCalled();
    expect(pageQuery.limit).toHaveBeenCalledWith(3);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: true,
      mode: 'plan',
      plan: [{ id: 'stu-2', from: 'LEGACY-2' }],
      processed: 2,
      updated: 0,
      candidates: 1,
      skipped: 1,
      cursor: 'stu-2',
      hasMore: true,
      batchSize: 2,
    });
    expect(res.body.planDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renames the page and claims the new codes once the plan is confirmed', async () => {
    const { db, tx, invalidRef, extraRef } = buildStandardizeDb();
    vi.mocked(getDb).mockReturnValue(db);

    const planRes = mockRes();
    await handler(standardizeReq({ batchSize: 2 }), planRes);

    const res = mockRes();
    await handler(
      standardizeReq({ batchSize: 2, apply: true, confirmPlanDigest: planRes.body.planDigest }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledWith(
      invalidRef,
      expect.objectContaining({ studentId: 'HS260006', code: 'HS260006' })
    );
    // The registry is what actually owns a code now, so a rename that skipped
    // it would leave the profile and the owner document disagreeing.
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'student_code_registry/HS260006' }),
      expect.objectContaining({ canonicalProfileId: 'stu-2', isPrimary: true })
    );
    expect(tx.update).not.toHaveBeenCalledWith(extraRef, expect.anything());
    expect(res.body).toMatchObject({ mode: 'applied', updated: 1 });
  });

  it('refuses to apply a plan digest that does not match the current page', async () => {
    const { db, tx } = buildStandardizeDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      standardizeReq({ batchSize: 2, apply: true, confirmPlanDigest: 'f'.repeat(64) }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: expect.stringContaining('STUDENT_ID_STANDARDIZE_PLAN_STALE'),
    });
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('refuses to apply without any confirmation at all', async () => {
    const { db } = buildStandardizeDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(standardizeReq({ batchSize: 2, apply: true }), res);

    expect(res.statusCode).toBe(409);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/students/transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@nancy.com',
    } as any);
  });

  const SOURCE_CLASS = 'class-1';
  const TARGET_CLASS = 'class-2';
  const SOURCE_TERM = '2026-01-05';
  const TARGET_TERM = '2026-01-05';

  /**
   * transfer.ts now delegates its transaction entirely to
   * progressStudentToClass, so this harness is a stateful fake rather than a
   * transaction-shape mock: the old tests asserted exact tx.get call order for
   * a transaction transfer.ts no longer owns. What matters here is the
   * handler's own boundary (validation, authorization, the joinedAt window)
   * and that the response reflects what progression actually did.
   */
  function seed(overrides: {
    student?: Record<string, unknown>;
    targetClass?: Record<string, unknown>;
    sourceClass?: Record<string, unknown>;
  } = {}) {
    return {
      'users/admin-uid': { role: 'admin', displayName: 'Admin' },
      'students/student-1': {
        name: 'Transfer Student',
        studentId: 'HS260001',
        dob: '2014-01-01',
        contact: '0900000000',
        classId: SOURCE_CLASS,
        teacherId: 'teacher-1',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
        ...(overrides.student || {}),
      },
      [`classes/${SOURCE_CLASS}`]: {
        name: 'Class 1',
        teacherId: 'teacher-1',
        startDate: SOURCE_TERM,
        endDate: '2026-06-30',
        ...(overrides.sourceClass || {}),
      },
      [`classes/${TARGET_CLASS}`]: {
        name: 'Class 2',
        teacherId: 'teacher-2',
        tuitionFee: 500_000,
        startDate: TARGET_TERM,
        endDate: '2026-06-30',
        ...(overrides.targetClass || {}),
      },
      [`student_course_enrollments/${makeStudentCourseEnrollmentId('student-1', SOURCE_CLASS, SOURCE_TERM)}`]:
        {
          id: makeStudentCourseEnrollmentId('student-1', SOURCE_CLASS, SOURCE_TERM),
          studentId: 'student-1',
          classId: SOURCE_CLASS,
          termStart: SOURCE_TERM,
          termEnd: '2026-06-30',
          status: 'active',
          joinedAt: SOURCE_TERM,
          endedAt: null,
          source: 'system',
          confidence: 'confirmed',
          statusChangedAt: '2026-01-05T00:00:00.000Z',
          statusChangedBy: 'seed',
          confirmedAt: '2026-01-05T00:00:00.000Z',
          confirmedBy: 'seed',
          createdAt: '2026-01-05T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
        },
    };
  }

  function transferReq(body: Record<string, unknown>) {
    return { method: 'POST', headers: {}, query: { action: 'transfer' }, body } as any;
  }

  it('rejects a request missing the student id or target class id', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(transferReq({ id: 'student-1' }), res);

    expect(res.statusCode).toBe(400);
  });

  it('rejects a teacher; only admin or office may transfer', async () => {
    const { db } = createInMemoryDocumentStore({
      ...seed(),
      'users/teacher-uid': { role: 'teacher', displayName: 'Teacher' },
    });
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'teacher-uid', email: 't@nancy.com' } as any);

    const res = mockRes();
    await handler(transferReq({ id: 'student-1', targetClassId: TARGET_CLASS }), res);

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when the student does not exist', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(transferReq({ id: 'no-such-student', targetClassId: TARGET_CLASS }), res);

    expect(res.statusCode).toBe(404);
  });

  it('rejects transferring into the class the student is already in', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(transferReq({ id: 'student-1', targetClassId: SOURCE_CLASS }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('already in the target class');
  });

  it('rejects transferring into an archived class', async () => {
    const { db } = createInMemoryDocumentStore(seed({ targetClass: { status: 'archived' } }));
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(transferReq({ id: 'student-1', targetClassId: TARGET_CLASS }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('archived');
  });

  it('rejects a joinedAt outside the target course term', async () => {
    const { db } = createInMemoryDocumentStore(seed());
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      transferReq({ id: 'student-1', targetClassId: TARGET_CLASS, joinedAt: '2025-01-01' }),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('joinedAt must fall between');
  });

  it('transfers the student, closing the source enrollment and opening the target', async () => {
    const { db, store } = createInMemoryDocumentStore(seed());
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(transferReq({ id: 'student-1', targetClassId: TARGET_CLASS }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      id: 'student-1',
      sourceClassId: SOURCE_CLASS,
      targetClassId: TARGET_CLASS,
    });
    // Same profile document throughout -- the whole point of delegating to
    // progressStudentToClass instead of this handler's own transaction.
    expect(store.has('students/student-1')).toBe(true);
    expect([...store.keys()].filter((path) => path.startsWith('students/'))).toEqual([
      'students/student-1',
    ]);
    expect(store.get('students/student-1')).toMatchObject({ classId: TARGET_CLASS });

    const enrollments = [...store.entries()].filter(([path]) =>
      path.startsWith('student_course_enrollments/')
    );
    expect(enrollments).toHaveLength(2);
    expect(
      enrollments.find(([path]) =>
        path.includes(makeStudentCourseEnrollmentId('student-1', SOURCE_CLASS, SOURCE_TERM))
      )?.[1].status
    ).toBe('transferred');
    expect(
      enrollments.find(([path]) =>
        path.includes(makeStudentCourseEnrollmentId('student-1', TARGET_CLASS, TARGET_TERM))
      )?.[1].status
    ).toBe('active');
  });

  it('reports "already in target class" rather than moving a student twice', async () => {
    // The handler's own pre-check reads the profile's current classId fresh,
    // so once a transfer has actually landed, a retry stops there -- it never
    // reaches progression's own idempotency check, and it never opens a
    // second target enrollment.
    const { db, store } = createInMemoryDocumentStore(seed());
    vi.mocked(getDb).mockReturnValue(db);

    const first = mockRes();
    await handler(transferReq({ id: 'student-1', targetClassId: TARGET_CLASS }), first);
    const second = mockRes();
    await handler(transferReq({ id: 'student-1', targetClassId: TARGET_CLASS }), second);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
    expect(second.body.error).toContain('already in the target class');
    const enrollments = [...store.entries()].filter(([path]) =>
      path.startsWith('student_course_enrollments/')
    );
    expect(enrollments).toHaveLength(2);
  });

  it('rolls a source credit into a discount on the new ledger', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...seed(),
      'course_fee_ledgers/ledger-source': {
        studentId: 'student-1',
        classId: SOURCE_CLASS,
        termStart: SOURCE_TERM,
        amount: 300_000,
        paidTotal: 500_000,
        discountTotal: 0,
      },
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(transferReq({ id: 'student-1', targetClassId: TARGET_CLASS }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ rolloverBalance: 200_000, newLedgerCreated: true });
    const ledgerWrite = [...store.entries()].find(
      ([path]) => path.startsWith('course_fee_ledgers/') && path !== 'course_fee_ledgers/ledger-source'
    );
    expect(ledgerWrite?.[1]).toMatchObject({ discountTotal: 200_000, rolloverBalance: 200_000 });
  });
});

function createReq(method: string, action: string, body: Record<string, unknown>) {
  return {
    method,
    headers: {},
    query: { action },
    body,
  } as any;
}

function mockVerifiedContext(
  role: 'admin' | 'teacher' | 'office' = 'teacher',
  uid = role === 'teacher' ? 'teacher-1' : `${role}-1`
) {
  vi.mocked(verifyAuthToken).mockResolvedValue({
    uid,
    email: `${uid}@example.test`,
  } as any);
}

function buildStudentCreateDb(options: {
  classDoc: { exists: boolean; data: () => any };
  duplicateStudentExists: boolean;
}) {
  const classRef = { id: 'class-1', get: vi.fn().mockResolvedValue(options.classDoc) };
  const createdStudentRef = { id: 'student-new' };
  const studentsQuery: any = {
    where: vi.fn(() => studentsQuery),
    orderBy: vi.fn(() => studentsQuery),
    limit: vi.fn(() => studentsQuery),
    get: vi.fn().mockResolvedValue({
      empty: !options.duplicateStudentExists,
      docs: options.duplicateStudentExists ? [{ id: 'duplicate-student' }] : [],
    }),
    doc: vi.fn(() => createdStudentRef),
  };
  const counterRef = { id: 'students_26', set: vi.fn().mockResolvedValue(undefined) };
  const tx = {
    get: vi.fn(async (target: any) =>
      target === counterRef
        ? { exists: true, data: () => ({ seq: 0 }) }
        : {
            empty: !options.duplicateStudentExists,
            docs: options.duplicateStudentExists
              ? [{ id: 'duplicate-student', data: () => ({}) }]
              : [],
          }
    ),
    update: vi.fn(),
    create: vi.fn(),
    set: vi.fn(),
  };
  const db: any = {
    collection: vi.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(makeDoc({ role: 'teacher', displayName: 'Teacher' })),
          })),
        };
      }
      if (name === 'classes') return { doc: vi.fn(() => classRef) };
      if (name === 'students') return studentsQuery;
      if (name === '_counters') return { doc: vi.fn(() => counterRef) };
      return {};
    }),
    doc: vi.fn((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue(makeDoc({}, false)),
    })),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };
  return db;
}

function buildStudentUpdateDb(options: {
  studentGet: any;
  studentData?: Record<string, unknown>;
  canonicalEnrollment?: boolean;
}) {
  const classRef = {
    id: 'class-1',
    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ teacherId: 'teacher-1' }) }),
  };
  const enrollment = {
    id: makeStudentCourseEnrollmentId('student-1', 'class-1', '2026-01-01'),
    studentId: 'student-1',
    classId: 'class-1',
    termStart: '2026-01-01',
    termEnd: '2026-06-30',
    status: 'active',
    joinedAt: '2026-01-01',
    endedAt: null,
    statusReason: null,
    source: 'system',
    confidence: 'confirmed',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    statusChangedBy: 'admin-1',
    confirmedAt: '2026-01-01T00:00:00.000Z',
    confirmedBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const enrollmentRef = { id: enrollment.id };
  const enrollmentQuery: any = {
    where: vi.fn(() => enrollmentQuery),
    orderBy: vi.fn(() => enrollmentQuery),
    doc: vi.fn(() => enrollmentRef),
  };
  const studentRef = {
    id: 'student-1',
    get: options.studentGet,
    update: vi.fn().mockResolvedValue(undefined),
  };
  const studentsQuery: any = {
    where: vi.fn(() => studentsQuery),
    orderBy: vi.fn(() => studentsQuery),
    limit: vi.fn(() => studentsQuery),
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    doc: vi.fn((id: string) => {
      if (id === 'student-1') return studentRef;
      // This fixture owns the identity-mutation transaction only. Declining
      // the accounting projection probe keeps its post-commit transaction out
      // of the duplicate-read assertion while studentGet still guards direct reads.
      if (options.canonicalEnrollment && id === '__probe__') return { id };
      return { id, get: vi.fn().mockResolvedValue(makeDoc({}, false)) };
    }),
  };
  const tx = {
    get: vi.fn(async (target: any) => {
      if (target === studentRef) {
        return {
          exists: true,
          data: () => ({
            id: 'student-1',
            name: 'Nguyen Van A',
            dob: '2014-05-01',
            contact: '0900000000',
            classId: 'class-1',
            teacherId: 'teacher-1',
            studentId: 'HS260001',
            enrollmentStatus: 'active',
            ...options.studentData,
          }),
        };
      }
      if (options.canonicalEnrollment && target === enrollmentQuery) {
        return { docs: [{ id: enrollment.id, exists: true, data: () => enrollment }] };
      }
      if (options.canonicalEnrollment && target === classRef) {
        return { exists: true, data: () => ({ teacherId: 'teacher-1' }) };
      }
      return { exists: false };
    }),
    update: vi.fn(),
    create: vi.fn(),
    set: vi.fn(),
  };
  const db: any = {
    collection: vi.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(makeDoc({ role: 'teacher', displayName: 'Teacher' })),
          })),
        };
      }
      if (name === 'classes') return { doc: vi.fn(() => classRef) };
      if (name === 'students') return studentsQuery;
      if (options.canonicalEnrollment && name === 'student_course_enrollments') {
        return enrollmentQuery;
      }
      return {};
    }),
    // A dedicated stub rather than routing to studentRef: studentRef.get is
    // `options.studentGet`, an intentionally bare vi.fn() these tests assert
    // is never called (that is the "no duplicate pre-transaction read" claim
    // under test), so the canonical resolver's own read needs its own path.
    doc: vi.fn((path: string) =>
      path === 'students/student-1'
        ? { path, get: vi.fn().mockResolvedValue(makeDoc({ id: 'student-1' })) }
        : { path, get: vi.fn().mockResolvedValue(makeDoc({}, false)) }
    ),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };
  return { db, tx };
}

describe('Student CRUD Duplicate Reads', () => {
  it('rejects duplicate student creation with conflict status', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const db = buildStudentCreateDb({
      classDoc: { exists: true, data: () => ({ teacherId: 'teacher-1' }) },
      duplicateStudentExists: true,
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'create', {
        name: 'Nguyen Van A',
        dob: '2014-05-01',
        contact: '0900000000',
        classId: 'class-1',
      }),
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('updates a student without duplicate pre-transaction student reads', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const studentGet = vi.fn();
    const { db } = buildStudentUpdateDb({ studentGet });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('PUT', 'update', {
        id: 'student-1',
        name: 'Updated Student',
        dob: '2014-05-01',
        contact: '0900000000',
        classId: 'class-1',
        studentId: 'HS260001',
      }),
      res as any
    );

    expect(studentGet).not.toHaveBeenCalled();
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('deletes a student without duplicate pre-transaction student reads', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const studentGet = vi.fn();
    const { db } = buildStudentUpdateDb({ studentGet, canonicalEnrollment: true });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('DELETE', 'delete', {
        id: 'student-1',
        reason: 'Soft deleted',
      }),
      res as any
    );

    expect(studentGet).not.toHaveBeenCalled();
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Code review fix: archiving a student who is on_leave must close the open
  // leave window, or it stays open forever — invisible but never resolved.
  it('closes an open leave period when soft-deleting a student who is on_leave', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const studentGet = vi.fn();
    const { db, tx } = buildStudentUpdateDb({
      studentGet,
      canonicalEnrollment: true,
      studentData: {
        enrollmentStatus: 'on_leave',
        leavePeriods: [{ from: '2026-03-02', until: null, classId: 'class-1' }],
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('DELETE', 'delete', { id: 'student-1', reason: 'Archived by staff' }),
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(200);
    // applyClassStudentCountDeltas also calls tx.update (on the class doc), so
    // find the call that targets the student ref specifically.
    const studentRef = db.collection('students').doc('student-1');
    const studentUpdateCall = tx.update.mock.calls.find(([ref]: [any]) => ref === studentRef);
    const [, updateData] = studentUpdateCall;
    expect(updateData.leavePeriods).toEqual([
      { from: '2026-03-02', until: expect.any(String), classId: 'class-1' },
    ]);
    expect(updateData.leavePeriods[0].until).not.toBeNull();
  });

  it('does not touch leavePeriods when soft-deleting a student who is not on_leave', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const studentGet = vi.fn();
    const { db, tx } = buildStudentUpdateDb({
      studentGet,
      canonicalEnrollment: true,
      studentData: { enrollmentStatus: 'active' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('DELETE', 'delete', { id: 'student-1', reason: 'Archived by staff' }),
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const studentRef = db.collection('students').doc('student-1');
    const studentUpdateCall = tx.update.mock.calls.find(([ref]: [any]) => ref === studentRef);
    const [, updateData] = studentUpdateCall;
    expect(updateData).not.toHaveProperty('leavePeriods');
  });
});

describe('POST /api/v1/students/siblings', () => {
  function makeSiblingsDb(
    students: Record<string, { siblingGroupId?: string }>,
    userRole = 'admin'
  ) {
    const userRef = {
      get: vi.fn().mockResolvedValue(makeDoc({ role: userRole, displayName: 'User' })),
    };

    function docFor(id: string) {
      return {
        id,
        get: vi
          .fn()
          .mockResolvedValue(students[id] ? makeDoc({ ...students[id] }) : makeDoc({}, false)),
      };
    }
    const refs: Record<string, any> = {};
    for (const id of Object.keys(students)) refs[id] = docFor(id);

    const studentsCollection: any = {
      doc: vi.fn((id: string) => refs[id] || docFor(id)),
      where: vi.fn((_field: string, _op: string, groupId: string) => ({
        get: vi.fn().mockResolvedValue({
          docs: Object.entries(students)
            .filter(([, data]) => data.siblingGroupId === groupId)
            .map(([id]) => ({ id, ref: refs[id] || docFor(id) })),
        }),
      })),
    };

    const tx: any = {
      get: vi.fn(async (ref: any) => ref.get()),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') return { doc: vi.fn(() => userRef) };
        if (name === 'students') return studentsCollection;
        return {};
      }),
      // Sibling links resolve each id to its canonical profile before writing,
      // and the resolver addresses documents by path. Student paths route to
      // the same refs the collection-style lookups use; nothing else exists,
      // which is the ordinary case (no alias, no tombstone).
      doc: vi.fn((path: string) => {
        const [collectionName, id] = [
          path.slice(0, path.indexOf('/')),
          path.slice(path.indexOf('/') + 1),
        ];
        if (collectionName === 'students') return refs[id] || docFor(id);
        return { id, get: vi.fn().mockResolvedValue(makeDoc({}, false)) };
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    return { db, tx };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@nancy.com',
    } as any);
  });

  it('rejects an accounting token with 403 before handleSiblings is called', async () => {
    const { db } = makeSiblingsDb({ 'stu-1': {}, 'stu-2': {} }, 'accounting');
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'siblings' },
        body: { op: 'link', studentId: 'stu-1', siblingId: 'stu-2' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('clears siblingGroupId on both documents when unlinking a two-member group', async () => {
    const { db, tx } = makeSiblingsDb({
      'stu-1': { siblingGroupId: 'g1' },
      'stu-2': { siblingGroupId: 'g1' },
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'siblings' },
        body: { op: 'unlink', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const updatedIds = tx.update.mock.calls.map((call: any[]) => call[0].id).sort();
    expect(updatedIds).toEqual(['stu-1', 'stu-2']);
    for (const call of tx.update.mock.calls) {
      expect(call[1]).toMatchObject({ siblingGroupId: expect.anything() });
    }
  });

  it('rewrites every document in the losing group on a confirmed merge, not only the clicked sibling', async () => {
    const { db, tx } = makeSiblingsDb({
      'stu-1': { siblingGroupId: 'g1' },
      'stu-2': { siblingGroupId: 'g2' },
      'stu-3': { siblingGroupId: 'g2' },
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'siblings' },
        body: { op: 'link', studentId: 'stu-1', siblingId: 'stu-2', confirmMerge: true },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const updatedIds = tx.update.mock.calls.map((call: any[]) => call[0].id).sort();
    expect(updatedIds).toEqual(['stu-2', 'stu-3']);
  });

  it('writes exactly one audit per changed student with the real before/after group ids', async () => {
    const { writeAuditLog } = await import('../../server/api/lib/logging/auditLog.js');
    const { db } = makeSiblingsDb({ 'stu-1': {}, 'stu-2': {} });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'siblings' },
        body: { op: 'link', studentId: 'stu-1', siblingId: 'stu-2' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledTimes(2);
    const documentIds = vi
      .mocked(writeAuditLog)
      .mock.calls.map((call: any[]) => call[1].documentId)
      .sort();
    expect(documentIds).toEqual(['stu-1', 'stu-2']);
    for (const call of vi.mocked(writeAuditLog).mock.calls) {
      const changes = call[1].changes;
      expect(changes.siblingGroupId.before).toBeNull();
      expect(typeof changes.siblingGroupId.after).toBe('string');
    }
  });

  it('returns 409/merge_confirmation_required without writes or audits when merge is not confirmed', async () => {
    const { writeAuditLog } = await import('../../server/api/lib/logging/auditLog.js');
    const { db, tx } = makeSiblingsDb({
      'stu-1': { siblingGroupId: 'g1' },
      'stu-2': { siblingGroupId: 'g2' },
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'siblings' },
        body: { op: 'link', studentId: 'stu-1', siblingId: 'stu-2' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ errorCode: 'merge_confirmation_required' });
    expect(tx.update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/students/course-enrollment', () => {
  it.each(['admin', 'office'])('admits %s to the correction handler', async (role) => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: `${role}-1`,
      email: `${role}@test`,
    } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue(makeDoc({ role })),
        })),
      })),
    } as any);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'course-enrollment' },
        body: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(courseEnrollmentHandlerMock).toHaveBeenCalledTimes(1);
  });

  it.each(['accounting', 'teacher'])('rejects %s before the correction handler', async (role) => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: `${role}-1`,
      email: `${role}@test`,
    } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue(makeDoc({ role })),
        })),
      })),
    } as any);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'course-enrollment' },
        body: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(courseEnrollmentHandlerMock).not.toHaveBeenCalled();
  });
});

// The closed-course join decision lets the office pick the date a student
// entered a course that has already finished. These cover the server half of
// that contract: an explicit date is honoured and validated, an absent one still
// clamps so the Excel import and reset-course paths keep working.
describe('explicit joinedAt on class assignment', () => {
  const endedCourse = {
    teacherId: 'teacher-2',
    name: 'Ended Course',
    startDate: '2026-01-05',
    endDate: '2026-03-31',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    mockVerifiedContext('admin', 'admin-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sourceEnrollmentId = makeStudentCourseEnrollmentId('student-1', 'class-1', '2026-01-05');
  const sourceEnrollmentData = {
    id: sourceEnrollmentId,
    studentId: 'student-1',
    classId: 'class-1',
    termStart: '2026-01-05',
    termEnd: null,
    status: 'active',
    joinedAt: '2026-01-05',
    endedAt: null,
    statusReason: null,
    source: 'system',
    confidence: 'confirmed',
    statusChangedAt: '2026-01-05T00:00:00.000Z',
    statusChangedBy: 'seed',
    confirmedAt: '2026-01-05T00:00:00.000Z',
    confirmedBy: 'seed',
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
  };

  // Transfer now requires a real open enrollment backing the student's
  // classId -- that requirement is the whole point of routing class changes
  // through enrollment authority instead of trusting the profile field.
  function enrollmentCollection() {
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: sourceEnrollmentId,
            exists: true,
            ref: { path: `student_course_enrollments/${sourceEnrollmentId}` },
            data: () => sourceEnrollmentData,
          },
        ],
        empty: false,
      }),
      doc: vi.fn((id: string) => ({
        id,
        path: `student_course_enrollments/${id}`,
        get: vi.fn().mockResolvedValue(
          id === sourceEnrollmentId
            ? { id, exists: true, data: () => sourceEnrollmentData }
            : { id, exists: false, data: () => ({}) }
        ),
      })),
    };
    return query;
  }

  function enrollmentWrite(tx: { create: any; update: any }) {
    return [...tx.create.mock.calls, ...tx.update.mock.calls]
      .map(([, data]) => data)
      .find((data) => data && 'termStart' in data && 'joinedAt' in data);
  }

  const storedStudent = {
    name: 'Nguyen Van A',
    dob: '2014-05-01',
    contact: '0900000000',
    classId: 'class-1',
    teacherId: 'teacher-1',
    studentId: 'HS260001',
    enrollmentStatus: 'active',
  };

  function buildAssignmentDb() {
    // handleTransfer reads the student before opening its transaction, so this
    // has to resolve to a real document; handleUpdate never touches it.
    const studentRef = {
      id: 'student-1',
      get: vi.fn().mockResolvedValue(makeDoc(storedStudent)),
      update: vi.fn(),
    };
    const originalClassRef = {
      id: 'class-1',
      get: vi.fn().mockResolvedValue(makeDoc({ teacherId: 'teacher-1' })),
      update: vi.fn(),
    };
    const endedClassRef = {
      id: 'class-ended',
      get: vi.fn().mockResolvedValue(makeDoc(endedCourse)),
      update: vi.fn(),
    };
    const targetLedgerRef = { id: 'ledger-1', get: vi.fn().mockResolvedValue(makeDoc({}, false)) };
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      doc: vi.fn((id: string) =>
        id === 'student-1' ? studentRef : { id, get: vi.fn().mockResolvedValue(makeDoc({}, false)) }
      ),
    };
    const emptyQuery: any = {
      where: vi.fn(() => emptyQuery),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === studentRef) return makeDoc(storedStudent);
        if (typeof target?.get === 'function') return target.get();
        return { exists: false, empty: true, docs: [] };
      }),
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ role: 'admin', displayName: 'Admin' })),
            })),
          };
        }
        if (name === 'students') return studentsQuery;
        if (name === 'classes') {
          return {
            doc: vi.fn((id: string) => (id === 'class-1' ? originalClassRef : endedClassRef)),
          };
        }
        if (name === 'student_course_enrollments') return enrollmentCollection();
        if (name === 'course_fee_ledgers') {
          return { ...emptyQuery, doc: vi.fn(() => targetLedgerRef) };
        }
        if (name === 'payment_requests') return emptyQuery;
        if (name === 'admissions_history') return { doc: vi.fn(() => ({ id: 'history-1' })) };
        if (name === 'student_progression_events') {
          return {
            doc: vi.fn((id: string) => ({
              id,
              path: `student_progression_events/${id}`,
              get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            })),
          };
        }
        return {};
      }),
      // Path-addressed reads: maintenance state, aliases, and the canonical
      // resolver's own profile lookup all arrive through db.doc rather than
      // db.collection(...).doc(...), so they have to route to the same
      // studentRef the collection-style lookups use.
      doc: vi.fn((path: string) => {
        if (path === 'students/student-1') return studentRef;
        return { path, get: vi.fn().mockResolvedValue(makeDoc({}, false)) };
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    return { db, tx, studentRef };
  }

  const updateBody = {
    id: 'student-1',
    name: 'Nguyen Van A',
    dob: '2014-05-01',
    contact: '0900000000',
    classId: 'class-ended',
    studentId: 'HS260001',
  };

  // The generic update used to open an enrollment in the requested class,
  // which meant a profile-field write could move a child between courses
  // without closing the source enrollment or rolling the ledger. It now refuses
  // and points at the transfer API, which the following two tests still cover.
  it.each([
    ['with an explicit joinedAt', { joinedAt: '2026-02-10' }],
    ['with no joinedAt at all', {}],
    ['with a joinedAt outside the term', { joinedAt: '2026-04-15' }],
  ])('update refuses to move a student to another class %s', async (_label, extra) => {
    const { db, tx } = buildAssignmentDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(createReq('PUT', 'update', { ...updateBody, ...extra }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: expect.stringContaining('STUDENT_CLASS_CHANGE_REQUIRES_PROGRESSION'),
    });
    expect(enrollmentWrite(tx)).toBeUndefined();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('transfer honours an explicit joinedAt in both records', async () => {
    const { db, tx, studentRef } = buildAssignmentDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      createReq('POST', 'transfer', {
        id: 'student-1',
        targetClassId: 'class-ended',
        joinedAt: '2026-02-10',
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(enrollmentWrite(tx)).toMatchObject({
      classId: 'class-ended',
      termStart: '2026-01-05',
      joinedAt: '2026-02-10',
    });
    const studentUpdate = tx.update.mock.calls.find(([ref]) => ref === studentRef)?.[1] as Record<
      string,
      unknown
    >;
    expect(studentUpdate.courseJoins).toEqual([
      { classId: 'class-ended', termStart: '2026-01-05', joinedAt: '2026-02-10' },
    ]);
  });

  it('transfer rejects a joinedAt outside the target course term', async () => {
    const { db } = buildAssignmentDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      createReq('POST', 'transfer', {
        id: 'student-1',
        targetClassId: 'class-ended',
        joinedAt: '2026-04-15',
      }),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: 'joinedAt must fall between 2026-01-05 and 2026-03-31',
    });
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
