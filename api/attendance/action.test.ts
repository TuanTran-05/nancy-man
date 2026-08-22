import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/attendance/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { refreshTrialReviewStatus } from '../../server/api/lib/admissions/trial.js';
import { getUserRole } from '../../server/api/lib/services/userService.js';
import { assertTeacherClassAccess } from '../../server/api/lib/services/classService.js';
import { assertStudentInClass } from '../../server/api/lib/auth/authz.js';
import { commitWriteOperationsInChunks } from '../../server/api/lib/documentStore/batchWrites.js';
import { writeRequiredAuditLog } from '../../server/api/lib/logging/auditLog.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    delete: vi.fn(() => 'deleteField'),
    increment: vi.fn((value: number) => ({ __op: 'increment', value })),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/api/lib/services/userService.js', () => ({
  getUserRole: vi.fn().mockResolvedValue('teacher'),
}));

vi.mock('../../server/api/lib/services/classService.js', () => ({
  assertTeacherClassAccess: vi
    .fn()
    .mockResolvedValue({ teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
}));

vi.mock('../../server/api/lib/auth/authz.js', () => ({
  assertStudentInClass: vi.fn().mockResolvedValue({ studentLifecycle: 'trial' }),
}));

vi.mock('../../server/api/lib/admissions/trial.js', () => ({
  refreshTrialReviewStatus: vi.fn().mockResolvedValue({ updated: true, trialSessionCount: 2 }),
}));

vi.mock('../../server/api/lib/documentStore/batchWrites.js', () => ({
  deleteRefsInChunks: vi.fn().mockResolvedValue(1),
  commitWriteOperationsInChunks: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeRequiredAuditLog: vi.fn().mockResolvedValue(undefined),
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

function attendanceRef(data: Record<string, unknown> | null = null) {
  const ref = {
    path: 'attendance/class-1_student-1_2026-05-25',
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  return Object.assign(ref, {
    get: vi.fn().mockResolvedValue({
      exists: data !== null,
      data: () => data || {},
      ref,
    }),
  });
}

function attendanceDb(
  ref: ReturnType<typeof attendanceRef>,
  events: string[] = [],
  studentData: Record<string, unknown> = { classId: 'class-1', studentLifecycle: 'trial' }
) {
  const maintenanceData = {
    mode: 'normal',
    activeRunId: null,
    migrationActorId: null,
    updatedAt: '2026-08-09T09:00:00.000Z',
    updatedBy: 'operator',
  };
  const maintenanceRef = {
    path: '_maintenance/student_identity',
    get: vi.fn(async () => ({ exists: true, data: () => maintenanceData })),
  };
  const studentRef = {
    get: vi.fn(async () => ({
      exists: true,
      data: () => ({ classId: 'class-1', studentLifecycle: 'trial', ...studentData }),
    })),
  };
  const realtimeRef = {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  };
  const tx = {
    get: vi.fn((target: { path?: string; get?: () => Promise<unknown> }) => {
      events.push(`tx.get:${String(target.path || 'unknown')}`);
      if (target === maintenanceRef) {
        return Promise.resolve({
          exists: true,
          data: () => maintenanceData,
        });
      }
      return target.get?.();
    }),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    doc: vi.fn((path: string) => (path === maintenanceRef.path ? maintenanceRef : { path })),
    collection: vi.fn((name: string) => {
      if (name === 'students') return { doc: vi.fn(() => studentRef) };
      if (name === 'realtime_events') return { doc: vi.fn(() => realtimeRef) };
      return { doc: vi.fn(() => ref) };
    }),
    getAll: vi.fn(async (...refs: any[]) => {
      return refs.map(() => ({ exists: false, data: () => ({}) }));
    }),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };
  return { db, tx };
}

function mockVerifiedContext(
  role: 'admin' | 'teacher' | 'office' = 'teacher',
  uid = role === 'teacher' ? 'teacher-1' : `${role}-1`
) {
  vi.mocked(verifyAuthContext).mockResolvedValue({
    decoded: { uid, email: `${uid}@example.test` } as any,
    context: {
      uid,
      email: `${uid}@example.test`,
      role,
      name: `${role} user`,
    },
  });
}

function createReq(method: string, action: string, body: Record<string, unknown>) {
  return {
    method,
    headers: {},
    query: { action },
    body,
  } as any;
}

function buildAttendanceDb(options: {
  classDoc: { exists: boolean; data: () => any };
  studentDoc: { exists: boolean; data: () => any };
  attendanceDoc: { exists: boolean; data: () => any };
}) {
  vi.mocked(assertTeacherClassAccess).mockResolvedValue(options.classDoc.data());
  vi.mocked(assertStudentInClass).mockResolvedValue(options.studentDoc.data());
  const ref = attendanceRef(options.attendanceDoc.exists ? options.attendanceDoc.data() : null);
  const { db } = attendanceDb(ref, [], options.studentDoc.data());
  return db;
}

function buildBulkAttendanceDb(options: {
  classDoc: { exists: boolean; data: () => any };
  students: Array<{ id: string; data: any }>;
  attendance?: Record<string, Record<string, unknown>>;
}) {
  vi.mocked(assertTeacherClassAccess).mockResolvedValue(options.classDoc.data());
  const events: string[] = [];
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const batchSet = vi.fn((target: { path: string }, data: Record<string, unknown>) => {
    events.push(`batch.set:${target.path}`);
    writes.push({ path: target.path, data });
  });
  const batchCommit = vi.fn(async () => {
    events.push('batch.commit');
  });
  const batch = {
    set: batchSet,
    commit: batchCommit,
  };
  const maintenanceData = {
    mode: 'normal',
    activeRunId: null,
    migrationActorId: null,
    updatedAt: '2026-08-09T09:00:00.000Z',
    updatedBy: 'operator',
  };
  const maintenanceRef = {
    path: '_maintenance/student_identity',
    get: vi.fn(async () => ({ exists: true, data: () => maintenanceData })),
  };
  const docRefMock = (id: string) => ({
    id,
    path: `attendance/${id}`,
  });
  const docMocks = new Map();
  const getDocMock = (id: string) => {
    if (!docMocks.has(id)) {
      docMocks.set(id, docRefMock(id));
    }
    return docMocks.get(id);
  };
  const studentsMap = new Map(options.students.map((s) => [s.id, s.data]));
  const db = {
    doc: vi.fn((path: string) => (path === maintenanceRef.path ? maintenanceRef : { path })),
    batch: vi.fn(() => batch),
    collection: vi.fn((name: string) => {
      if (name === 'students') {
        return {
          doc: vi.fn((id: string) => ({
            id,
            path: `students/${id}`,
          })),
        };
      }
      if (name === 'attendance') {
        return {
          doc: vi.fn(getDocMock),
        };
      }
      if (name === 'realtime_events') {
        return {
          doc: vi.fn(() => ({ set: vi.fn().mockResolvedValue(undefined) })),
        };
      }
      return {
        doc: vi.fn((id: string) => ({ id, path: `${name}/${id}` })),
      };
    }),
    getAll: vi.fn(async (...refs: any[]) => {
      return refs.map((ref) => {
        const studentId = ref.id;
        const exists = studentsMap.has(studentId);
        const data = studentsMap.get(studentId);
        return {
          id: studentId,
          exists,
          data: () => data,
        };
      });
    }),
    runTransaction: vi.fn(async (callback: any) =>
      callback({
        get: vi.fn(async (target: { path: string }) => {
          events.push(`tx.get:${target.path}`);
          if (target === maintenanceRef) {
            return { exists: true, data: () => maintenanceData };
          }
          if (target.path.startsWith('attendance/')) {
            const data = options.attendance?.[target.path];
            return { exists: Boolean(data), data: () => data || {} };
          }
          throw new Error(`Unexpected transaction read: ${target.path}`);
        }),
        set: vi.fn((target: { path: string }, data: Record<string, unknown>) => {
          events.push(`tx.set:${target.path}`);
          writes.push({ path: target.path, data });
        }),
      })
    ),
  };
  return { db, events, writes };
}

describe('/api/v1/attendance trial review integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifiedContext('teacher', 'teacher-1');
  });

  it('refreshes trial review status after setting attendance to present', async () => {
    const ref = attendanceRef();
    const { db } = attendanceDb(ref);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'toggle' },
        body: {
          classId: 'class-1',
          studentId: 'student-1',
          date: '2026-05-25',
          status: 'present',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(refreshTrialReviewStatus).toHaveBeenCalledWith(expect.anything(), 'student-1', {
      uid: 'teacher-1',
      role: 'teacher',
    });
  });

  it('refreshes trial review status after cycling attendance', async () => {
    const ref = attendanceRef({ status: 'present' });
    const { db } = attendanceDb(ref);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'cycle' },
        body: { classId: 'class-1', studentId: 'student-1', date: '2026-05-25' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(refreshTrialReviewStatus).toHaveBeenCalledWith(expect.anything(), 'student-1', {
      uid: 'teacher-1',
      role: 'teacher',
    });
  });

  it('writes toggle changes inside a DocumentStore transaction', async () => {
    const ref = attendanceRef();
    const { db, tx } = attendanceDb(ref);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'toggle' },
        body: {
          classId: 'class-1',
          studentId: 'student-1',
          date: '2026-05-25',
          status: 'present',
        },
      } as any,
      res
    );

    expect(db.runTransaction).toHaveBeenCalledOnce();
    expect(tx.set).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-25',
        status: 'present',
      }),
      { merge: true }
    );
  });

  it('reads student-identity maintenance before toggle business reads', async () => {
    const events: string[] = [];
    const ref = attendanceRef();
    const { db } = attendanceDb(ref, events);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'toggle' },
        body: {
          classId: 'class-1',
          studentId: 'student-1',
          date: '2026-05-25',
          status: 'present',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(events).toEqual([
      'tx.get:_maintenance/student_identity',
      'tx.get:attendance/class-1_student-1_2026-05-25',
    ]);
  });

  it('rejects future attendance dates before writing', async () => {
    const ref = attendanceRef();
    const { db } = attendanceDb(ref);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'toggle' },
        body: {
          classId: 'class-1',
          studentId: 'student-1',
          date: '2999-01-01',
          status: 'present',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(refreshTrialReviewStatus).not.toHaveBeenCalled();
  });

  it('rejects attendance dates outside the class course range', async () => {
    vi.mocked(assertTeacherClassAccess).mockResolvedValueOnce({
      teacherId: 'teacher-1',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    } as any);
    const ref = attendanceRef();
    const { db } = attendanceDb(ref);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'toggle' },
        body: {
          classId: 'class-1',
          studentId: 'student-1',
          date: '2026-04-30',
          status: 'present',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(refreshTrialReviewStatus).not.toHaveBeenCalled();
  });

  it('allows editing attendance inside an archived course term', async () => {
    vi.mocked(assertTeacherClassAccess).mockResolvedValueOnce({
      id: 'class-1',
      teacherId: 'teacher-1',
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      terms: [
        {
          id: 'course-old',
          startDate: '2026-01-05',
          endDate: '2026-05-31',
          daysOfWeek: [1, 3],
        },
      ],
    } as any);
    const ref = attendanceRef({ status: 'absent', teacherId: 'teacher-1' });
    const { db, tx } = attendanceDb(ref, [], { classId: 'class-1' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-03-02',
        status: 'present',
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({ status: 'present' })
    );
  });

  it('computes and writes cycle changes inside a DocumentStore transaction', async () => {
    const ref = attendanceRef({ status: 'present' });
    const { db, tx } = attendanceDb(ref);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'cycle' },
        body: { classId: 'class-1', studentId: 'student-1', date: '2026-05-25' },
      } as any,
      res
    );

    expect(db.runTransaction).toHaveBeenCalledOnce();
    expect(tx.update).toHaveBeenCalledWith(ref, expect.objectContaining({ status: 'absent' }));
  });

  it('refreshes the affected student after deleting an attendance record', async () => {
    const ref = attendanceRef({ classId: 'class-1', studentId: 'student-1' });
    mockVerifiedContext('admin', 'teacher-1');
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => ({ doc: vi.fn(() => ref) })),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'DELETE',
        headers: {},
        query: { action: 'delete-record', id: 'attendance-1' },
        body: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(refreshTrialReviewStatus).toHaveBeenCalledWith(expect.anything(), 'student-1', {
      uid: 'teacher-1',
      role: 'admin',
    });
  });

  it('allows teachers with class access to delete an attendance record', async () => {
    const ref = attendanceRef({ classId: 'class-1', studentId: 'student-1' });
    mockVerifiedContext('teacher', 'teacher-1');
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ref) })),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'DELETE',
        headers: {},
        query: { action: 'delete-record', id: 'attendance-1' },
        body: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assertTeacherClassAccess).toHaveBeenCalledWith(db, 'class-1', 'teacher-1', 'teacher');
    expect(ref.update).toHaveBeenCalledWith(
      expect.objectContaining({
        isVoided: true,
        voidedBy: 'teacher-1',
        voidReason: 'Voided by staff',
      })
    );
    expect(ref.delete).not.toHaveBeenCalled();
    expect(refreshTrialReviewStatus).toHaveBeenCalledWith(expect.anything(), 'student-1', {
      uid: 'teacher-1',
      role: 'teacher',
    });
  });

  it('refreshes each affected student after deleting attendance dates', async () => {
    const attendanceDoc = {
      ref: { path: 'attendance/record-1', parent: { id: 'attendance' } },
      data: () => ({ classId: 'class-1', studentId: 'student-1' }),
    };
    const db = {
      collection: vi.fn((name: string) => ({
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ docs: name === 'attendance' ? [attendanceDoc] : [] }),
          })),
        })),
      })),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'delete-dates' },
        body: { classId: 'class-1', dates: ['2026-05-25'] },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(commitWriteOperationsInChunks).toHaveBeenCalledWith(
      db,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'update',
          ref: attendanceDoc.ref,
          data: expect.objectContaining({
            isVoided: true,
            voidedBy: 'teacher-1',
            voidReason: 'Voided by staff',
          }),
        }),
      ])
    );
    expect(refreshTrialReviewStatus).toHaveBeenCalledWith(expect.anything(), 'student-1', {
      uid: 'teacher-1',
      role: 'teacher',
    });
  });

  it('does not refresh trial status for non-trial attendance toggle', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const db = buildAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      studentDoc: {
        exists: true,
        data: () => ({ classId: 'class-1', teacherId: 'teacher-1', studentLifecycle: 'enrolled' }),
      },
      attendanceDoc: { exists: false, data: () => undefined },
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-12',
        status: 'present',
      }),
      res as any
    );

    expect(refreshTrialReviewStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('refreshes trial status for trial attendance toggle', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const db = buildAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      studentDoc: {
        exists: true,
        data: () => ({ classId: 'class-1', teacherId: 'teacher-1', studentLifecycle: 'trial' }),
      },
      attendanceDoc: { exists: false, data: () => undefined },
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-12',
        status: 'present',
      }),
      res as any
    );

    expect(refreshTrialReviewStatus).toHaveBeenCalledWith(db, 'student-1', {
      uid: 'teacher-1',
      role: 'teacher',
    });
  });

  it('bulk marks multiple students present with one class access and one audit', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const { db, events, writes } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      students: [
        {
          id: 'student-1',
          data: { classId: 'class-1', teacherId: 'teacher-1', studentLifecycle: 'enrolled' },
        },
        {
          id: 'student-2',
          data: { classId: 'class-1', teacherId: 'teacher-1', studentLifecycle: 'enrolled' },
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-05-12',
        status: 'present',
        studentIds: ['student-1', 'student-2'],
      }),
      res as any
    );

    expect(events).toEqual([
      'tx.get:_maintenance/student_identity',
      'tx.get:attendance/class-1_student-1_2026-05-12',
      'tx.get:attendance/class-1_student-2_2026-05-12',
      'tx.set:attendance/class-1_student-1_2026-05-12',
      'tx.set:attendance/class-1_student-2_2026-05-12',
    ]);
    expect(writes.map((write) => write.path)).toEqual([
      'attendance/class-1_student-1_2026-05-12',
      'attendance/class-1_student-2_2026-05-12',
    ]);
    expect(refreshTrialReviewStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        updatedCount: 2,
        studentIds: ['student-1', 'student-2'],
      })
    );
  });

  it('bulk attendance rejects students outside the class', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const { db } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      students: [{ id: 'student-1', data: { classId: 'other-class', teacherId: 'teacher-1' } }],
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-05-12',
        status: 'present',
        studentIds: ['student-1'],
      }),
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('bulk attendance rejects payload exceeding max student IDs limit (100)', async () => {
    mockVerifiedContext('teacher', 'teacher-1');
    const { db } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      students: [],
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    const studentIds = Array.from({ length: 101 }, (_, i) => `student-${i}`);

    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-05-12',
        status: 'present',
        studentIds,
      }),
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('/api/v1/attendance student attendance authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Office is an academic-records manager: assertTeacherClassAccess grants it every
  // class via canManageAcademicRecords, and the frontend renders the attendance tab
  // interactively for office. The route gate must include 'office' so those writes
  // are not silently rejected with 403.
  it('permits the office role to mark student attendance', async () => {
    mockVerifiedContext('office', 'office-1');
    const ref = attendanceRef();
    const { db } = attendanceDb(ref);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'toggle' },
        body: {
          classId: 'class-1',
          studentId: 'student-1',
          date: '2026-05-25',
          status: 'present',
        },
      } as any,
      res
    );

    expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'admin',
      'teacher',
      'office',
    ]);
    expect(res.statusCode).toBe(201);
  });
});

describe('/api/v1/attendance session eligibility write protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifiedContext('teacher', 'teacher-1');
  });

  it('rejects an ordinary create before joinedAt', async () => {
    const ref = attendanceRef();
    const { db } = attendanceDb(ref, [], {
      classId: 'class-1',
      courseJoins: [{ classId: 'class-1', termStart: '2026-01-01', joinedAt: '2026-05-20' }],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
        status: 'present',
      }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'attendance_ineligible',
      eligibility: 'not_enrolled',
    });
  });

  it('allows an audited individual override but never a bulk override', async () => {
    const ref = attendanceRef();
    const { db } = attendanceDb(ref, [], {
      classId: 'class-1',
      leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
        status: 'present',
        eligibilityOverride: true,
        overrideReason: 'Attended this one lesson during approved leave',
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(writeRequiredAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          eligibilityOverride: true,
          overrideReason: 'Attended this one lesson during approved leave',
          eligibility: 'on_leave',
        }),
      }),
      'attendance_correction'
    );
  });

  it('rejects an override on an eligible cell or existing record as unnecessary', async () => {
    const ref = attendanceRef();
    const { db } = attendanceDb(ref, [], { classId: 'class-1' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
        status: 'present',
        eligibilityOverride: true,
        overrideReason: 'Unnecessary override on eligible session',
      }),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Attendance eligibility override is not required',
    });
  });

  it('cycle create rejects ineligible eligibility', async () => {
    const ref = attendanceRef();
    const { db } = attendanceDb(ref, [], {
      classId: 'class-1',
      leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'cycle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
      }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'attendance_ineligible',
      eligibility: 'on_leave',
    });
  });

  it('allows editing an existing real record even if session is currently ineligible', async () => {
    const ref = attendanceRef({ status: 'present', teacherId: 'teacher-1' });
    const { db } = attendanceDb(ref, [], {
      classId: 'class-1',
      leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
        status: 'late',
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: 'late',
    });
  });

  it('does not treat a voided record as real when toggling an ineligible cell', async () => {
    const ref = attendanceRef({ status: 'present', isVoided: true });
    const { db, tx } = attendanceDb(ref, [], {
      classId: 'class-1',
      leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
        status: 'late',
      }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'attendance_ineligible',
      eligibility: 'on_leave',
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('does not treat a voided record as real when cycling an ineligible cell', async () => {
    const ref = attendanceRef({ status: 'present', isVoided: true });
    const { db, tx } = attendanceDb(ref, [], {
      classId: 'class-1',
      leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'cycle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
      }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('resurrects a voided record on an eligible cell without retaining void markers', async () => {
    const ref = attendanceRef({
      status: 'absent',
      isVoided: true,
      voidedAt: '2026-05-11T00:00:00.000Z',
      voidedBy: 'admin-1',
      voidReason: 'Wrong date',
    });
    const { db, tx } = attendanceDb(ref, [], { classId: 'class-1' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'toggle', {
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-05-10',
        status: 'present',
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(tx.set).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({
        status: 'present',
        isVoided: false,
        voidedAt: 'deleteField',
        voidedBy: 'deleteField',
        voidReason: 'deleteField',
      }),
      { merge: true }
    );
  });

  it('bulk writes only eligible IDs and returns categorized skips', async () => {
    const { db } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ id: 'class-1', teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      students: [
        { id: 's1', data: { classId: 'class-1' } },
        { id: 's2', data: { classId: 'class-1', leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }] } },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-05-10',
        status: 'present',
        studentIds: ['s1', 's2'],
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      updatedCount: 1,
      studentIds: ['s1'],
      status: 'present',
      skipped: {
        not_enrolled: [],
        on_leave: ['s2'],
      },
    });
  });

  it('bulk updates attendance inside an archived course term', async () => {
    const { db, writes } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({
          id: 'class-1',
          teacherId: 'teacher-1',
          startDate: '2026-08-01',
          endDate: '2026-12-31',
          terms: [
            {
              id: 'course-old',
              startDate: '2026-01-05',
              endDate: '2026-05-31',
              daysOfWeek: [1, 3],
            },
          ],
        }),
      },
      students: [{ id: 's1', data: { classId: 'class-1' } }],
      attendance: {
        'attendance/class-1_s1_2026-03-02': {
          status: 'absent',
          classId: 'class-1',
          studentId: 's1',
          date: '2026-03-02',
        },
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-03-02',
        status: 'present',
        studentIds: ['s1'],
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ updatedCount: 1, studentIds: ['s1'] });
    expect(writes).toEqual([
      expect.objectContaining({
        path: 'attendance/class-1_s1_2026-03-02',
        data: expect.objectContaining({ status: 'present' }),
      }),
    ]);
  });

  it('bulk updates an existing real record even when metadata is now ineligible', async () => {
    const existingPath = 'attendance/class-1_s2_2026-05-10';
    const { db, writes } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ id: 'class-1', teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      students: [
        {
          id: 's2',
          data: {
            classId: 'class-1',
            leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
          },
        },
      ],
      attendance: {
        [existingPath]: { status: 'absent', classId: 'class-1', studentId: 's2', date: '2026-05-10' },
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-05-10',
        status: 'present',
        studentIds: ['s2'],
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      updatedCount: 1,
      studentIds: ['s2'],
      status: 'present',
      skipped: { not_enrolled: [], on_leave: [] },
    });
    expect(writes).toEqual([
      expect.objectContaining({ path: existingPath, data: expect.objectContaining({ status: 'present' }) }),
    ]);
  });

  it('bulk skips a voided record when its cell is ineligible', async () => {
    const voidedPath = 'attendance/class-1_s2_2026-05-10';
    const { db, writes } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ id: 'class-1', teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      students: [{
        id: 's2',
        data: {
          classId: 'class-1',
          leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }],
        },
      }],
      attendance: {
        [voidedPath]: { status: 'absent', isVoided: true },
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-05-10',
        status: 'present',
        studentIds: ['s2'],
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      updatedCount: 0,
      studentIds: [],
      status: 'present',
      skipped: { not_enrolled: [], on_leave: ['s2'] },
    });
    expect(writes).toEqual([]);
  });

  it('succeeds with updatedCount 0 when all students are skipped in bulk', async () => {
    const { db } = buildBulkAttendanceDb({
      classDoc: {
        exists: true,
        data: () => ({ id: 'class-1', teacherId: 'teacher-1', startDate: '2026-01-01', endDate: '2026-12-31' }),
      },
      students: [
        { id: 's1', data: { classId: 'class-1', leavePeriods: [{ classId: 'class-1', from: '2026-05-01', until: '2026-05-15' }] } },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      createReq('POST', 'bulk-toggle', {
        classId: 'class-1',
        date: '2026-05-10',
        status: 'present',
        studentIds: ['s1'],
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      updatedCount: 0,
      studentIds: [],
      status: 'present',
      skipped: {
        not_enrolled: [],
        on_leave: ['s1'],
      },
    });
  });
});
