import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/attendance/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import type { AuthRole } from '../../server/api/lib/auth/roles.js';
import { getUserRole } from '../../server/api/lib/services/userService.js';
import { writeRequiredAuditLog } from '../../server/api/lib/logging/auditLog.js';
import { touchRealtimeEvent } from '../../server/api/lib/realtime/events.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => 'serverTimestamp') },
}));

vi.mock('../../server/api/lib/http/cors.js', () => ({ handleCorsPreflight: vi.fn(() => false) }));
vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));
vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../server/api/lib/services/userService.js', () => ({ getUserRole: vi.fn() }));
vi.mock('../../server/api/lib/services/classService.js', () => ({
  assertTeacherClassAccess: vi.fn().mockResolvedValue({ teacherId: 'teacher-1' }),
}));
vi.mock('../../server/api/lib/auth/authz.js', () => ({
  assertStudentInClass: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../server/api/lib/admissions/trial.js', () => ({
  refreshTrialReviewStatus: vi.fn().mockResolvedValue({ updated: true, trialSessionCount: 2 }),
}));
vi.mock('../../server/api/lib/documentStore/batchWrites.js', () => ({
  deleteRefsInChunks: vi.fn().mockResolvedValue(1),
}));
vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeRequiredAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));
vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn();
  res.end = vi.fn();
  return res;
}

function docSnap(id: string, data: Record<string, unknown>, exists = true) {
  return { id, exists, data: () => data, ref: { id } };
}

function querySnap(docs: any[] = []) {
  return { docs, empty: docs.length === 0 };
}

function makeDb(options: {
  classData?: Record<string, unknown>;
  sessionData?: Record<string, unknown> | null;
  substituteData?: Record<string, unknown> | null;
}) {
  const classRef = {
    id: 'class-1',
    get: vi.fn().mockResolvedValue(docSnap('class-1', options.classData || {})),
  };
  const sessionRefs = new Map<string, { id: string }>();
  const getSessionRef = (id: string) => {
    if (!sessionRefs.has(id)) sessionRefs.set(id, { id });
    return sessionRefs.get(id)!;
  };
  const substituteQuery: any = {
    where: vi.fn(() => substituteQuery),
    limit: vi.fn(() => substituteQuery),
    get: vi
      .fn()
      .mockResolvedValue(
        querySnap(options.substituteData ? [docSnap('sub-1', options.substituteData)] : [])
      ),
  };
  const tx = {
    get: vi.fn(async (ref: any) => {
      if (ref === classRef) return docSnap('class-1', options.classData || {});
      if (String(ref.id || '').startsWith('class-1_')) {
        return options.sessionData === null
          ? docSnap(ref.id, {}, false)
          : docSnap(ref.id, options.sessionData || {}, true);
      }
      return docSnap('unknown', {}, false);
    }),
    set: vi.fn(),
    update: vi.fn(),
  };
  const db: any = {
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
    collection: vi.fn((name: string) => {
      if (name === 'classes') return { doc: vi.fn(() => classRef) };
      if (name === 'class_sessions') return { doc: vi.fn((id: string) => getSessionRef(id)) };
      if (name === 'substitute_requests') return substituteQuery;
      return { doc: vi.fn(() => ({ id: 'unknown' })) };
    }),
  };
  return { db, tx };
}

describe('/api/v1/teacher-attendance/mark', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@test.com',
    } as any);
    vi.mocked(getUserRole).mockResolvedValue('office');
    vi.mocked(verifyAuthContext).mockImplementation(async (_req, res, allowedRoles) => {
      const role = (await getUserRole({} as any, 'office-uid')) as AuthRole;
      if (allowedRoles?.length && !allowedRoles.includes(role)) {
        res.status(403).json({ success: false, error: 'Unauthorized' });
        return null;
      }
      return {
        decoded: { uid: 'office-uid', email: 'office@test.com' } as any,
        context: {
          uid: 'office-uid',
          email: 'office@test.com',
          role,
          name: 'Office User',
        },
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects teacher role', async () => {
    vi.mocked(getUserRole).mockResolvedValue('teacher');
    vi.mocked(getDb).mockReturnValue({} as any);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'mark', resource: 'teacher-attendance' },
        body: { classId: 'class-1', date: '2026-06-01', status: 'present' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });

  it('creates a class session when marking a scheduled virtual session present', async () => {
    const { db, tx } = makeDb({
      classData: {
        teacherId: 'teacher-1',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        daysOfWeek: [1],
        salaryPerSession: 200000,
      },
      sessionData: null,
    });
    vi.mocked(getDb).mockReturnValue(db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'mark', resource: 'teacher-attendance' },
        body: { classId: 'class-1', date: '2026-06-01', status: 'present' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'class-1_2026-06-01' }),
      expect.objectContaining({
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-01',
        status: 'taught',
        salaryPerSession: 200000,
        teacherAttendanceStatus: 'present',
        teacherAttendanceMarkedBy: 'office-uid',
        teacherAttendanceMarkedByRole: 'office',
        teacherAttendanceSource: 'office_admin',
      }),
      { merge: true }
    );
    expect(writeRequiredAuditLog).toHaveBeenCalled();
    expect(touchRealtimeEvent).toHaveBeenCalledWith('teacher-attendance');
    expect(touchRealtimeEvent).toHaveBeenCalledWith('payroll');
  });

  it('preserves makeup status and writes substitute teacher id', async () => {
    const { db, tx } = makeDb({
      classData: {
        teacherId: 'teacher-1',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        daysOfWeek: [1],
        salaryPerSession: 200000,
      },
      sessionData: {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-05',
        status: 'makeup',
        salaryPerSession: 200000,
      },
      substituteData: {
        classId: 'class-1',
        date: '2026-06-05',
        status: 'accepted',
        substituteTeacherId: 'teacher-2',
      },
    });
    vi.mocked(getDb).mockReturnValue(db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'mark', resource: 'teacher-attendance' },
        body: { classId: 'class-1', date: '2026-06-05', status: 'present' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'class-1_2026-06-05' }),
      expect.objectContaining({
        teacherId: 'teacher-2',
        teacherAttendanceStatus: 'present',
      })
    );
    expect(tx.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'taught' })
    );
  });

  it('rejects cancelled sessions', async () => {
    const { db } = makeDb({
      classData: {
        teacherId: 'teacher-1',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        daysOfWeek: [1],
      },
      sessionData: {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-01',
        status: 'cancelled',
      },
    });
    vi.mocked(getDb).mockReturnValue(db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'mark', resource: 'teacher-attendance' },
        body: { classId: 'class-1', date: '2026-06-01', status: 'absent' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/cancelled/i);
  });

  it('rejects creating teacher attendance for a non-scheduled class date', async () => {
    const { db, tx } = makeDb({
      classData: {
        teacherId: 'teacher-1',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        daysOfWeek: [1],
        salaryPerSession: 200000,
      },
      sessionData: null,
    });
    vi.mocked(getDb).mockReturnValue(db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'mark', resource: 'teacher-attendance' },
        body: { classId: 'class-1', date: '2026-06-02', status: 'present' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/scheduled class date/i);
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('rejects marking an existing non-makeup session on a non-scheduled date', async () => {
    const { db, tx } = makeDb({
      classData: {
        teacherId: 'teacher-1',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        daysOfWeek: [1],
        salaryPerSession: 200000,
      },
      sessionData: {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-05',
        status: 'taught',
        salaryPerSession: 200000,
      },
    });
    vi.mocked(getDb).mockReturnValue(db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'mark', resource: 'teacher-attendance' },
        body: { classId: 'class-1', date: '2026-06-05', status: 'present' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/scheduled class date/i);
    expect(tx.update).not.toHaveBeenCalled();
  });
});
