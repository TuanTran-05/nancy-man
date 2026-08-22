import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCourseEnrollment } from './courseEnrollment.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { enforceDocumentStoreReadBeforeWrite } from '../../../../test-utils/strictDocumentStoreTransaction.js';
import { resetCanonicalStudentReadControlCacheForTests } from '../../lib/student/canonicalStudentReadControl.js';
import { FieldValue } from '@/server/db/documentStore.js';

const auditMocks = vi.hoisted(() => ({
  writeRequiredAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logging/auditLog.js', () => ({
  computeChanges: vi.fn(() => ({ status: { before: 'active', after: 'on_leave' } })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  writeRequiredAuditLog: auditMocks.writeRequiredAuditLog,
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

function response() {
  const res: any = {};
  res.statusCode = 200;
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

function canonicalRecord(status: 'trial' | 'active' | 'on_leave' | 'dropped' = 'active') {
  const id = makeStudentCourseEnrollmentId('stu-1', 'class-1', '2026-07-01');
  return {
    id,
    studentId: 'stu-1',
    classId: 'class-1',
    termStart: '2026-07-01',
    termEnd: '2026-09-30',
    status,
    joinedAt: '2026-07-03',
    endedAt: status === 'dropped' ? '2026-08-01' : null,
    statusReason: status === 'dropped' ? 'Previous drop' : null,
    source: 'backfill',
    confidence: 'inferred',
    statusChangedAt: '2026-07-03T01:00:00.000Z',
    statusChangedBy: 'migration',
    confirmedAt: null,
    confirmedBy: null,
    createdAt: '2026-07-03T01:00:00.000Z',
    updatedAt: '2026-07-03T01:00:00.000Z',
  };
}

function makeDb(
  record = canonicalRecord(),
  maintenance?: Record<string, unknown>,
  readMode: 'legacy_compare' | 'canonical_preferred' | 'canonical_required' =
    'canonical_preferred',
  options: {
    profile?: Record<string, unknown>;
    linkedUsers?: string[];
  } = {}
) {
  const enrollmentRef = {
    id: record.id,
    get: vi.fn().mockResolvedValue({ id: record.id, exists: true, data: () => record }),
  };
  const enrollmentCollection: any = {
    doc: vi.fn(() => enrollmentRef),
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          docs: [{ id: record.id, exists: true, data: () => record }],
        }),
      })),
    })),
  };
  const studentRef = {
    id: 'stu-1',
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () =>
        options.profile ?? {
          classId: 'class-1',
          teacherId: 'teacher-1',
          enrollmentStatus: 'active',
          studentLifecycle: 'enrolled',
        },
    }),
  };
  const linkedUsers = options.linkedUsers ?? [];
  const userRefs = new Map(
    ['student:stu-1', 'parent:stu-1'].map((id) => [
      id,
      {
        id,
        get: vi.fn().mockResolvedValue({ exists: linkedUsers.includes(id), data: () => ({}) }),
      },
    ])
  );
  const tx: any = enforceDocumentStoreReadBeforeWrite({
    get: vi.fn((target: any) => target.get()),
    update: vi.fn(),
    create: vi.fn(),
  });
  const db: any = {
    collection: vi.fn((name: string) => {
      if (name === 'student_course_enrollments') return enrollmentCollection;
      if (name === 'students') return { doc: vi.fn(() => studentRef) };
      if (name === 'users') return { doc: vi.fn((id: string) => userRefs.get(id)) };
      if (name === 'audit_logs') return { add: vi.fn().mockResolvedValue(undefined) };
      return {};
    }),
    // The identity maintenance switch is a direct document read, not a
    // collection query. Absent by default, which is the ordinary case.
    doc: vi.fn((path: string) => ({
      id: path.split('/').at(-1),
      path,
      get: vi.fn().mockResolvedValue(
        path === '_maintenance/student_identity_read_model'
          ? {
              exists: true,
              data: () => ({ schemaVersion: 1, mode: readMode, generation: 1 }),
            }
          : { exists: maintenance !== undefined, data: () => maintenance }
      ),
    })),
    runTransaction: vi.fn(async (callback: (transaction: any) => Promise<void>) => callback(tx)),
  };
  return { db, tx, enrollmentRef, studentRef, userRefs };
}

function request(body: unknown, method = 'POST'): any {
  return {
    method,
    body,
    headers: { 'user-agent': 'test-agent' },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

describe('handleCourseEnrollment', () => {
  beforeEach(() => {
    auditMocks.writeRequiredAuditLog.mockClear();
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('rejects non-POST requests', async () => {
    const res = response();
    await handleCourseEnrollment(request({}, 'GET'), res, makeDb().db, { uid: 'admin-1' }, {
      role: 'admin',
      name: 'Admin',
    });
    expect(res.statusCode).toBe(405);
  });

  it('rejects an invalid payload', async () => {
    const res = response();
    await handleCourseEnrollment(request({ status: 'active' }), res, makeDb().db, { uid: 'admin-1' }, {
      role: 'admin',
      name: 'Admin',
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows Admin/Office corrections and marks the record manual/confirmed', async () => {
    const { db, tx } = makeDb();
    const res = response();
    const record = canonicalRecord();
    await handleCourseEnrollment(
      request({
        enrollmentId: record.id,
        status: 'on_leave',
        joinedAt: record.joinedAt,
        endedAt: null,
        statusReason: 'Family leave',
      }),
      res,
      db,
      { uid: 'office-1' },
      { role: 'office', name: 'Office' }
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: record.id }),
      expect.objectContaining({
        source: 'manual',
        confidence: 'confirmed',
        status: 'on_leave',
      })
    );
    expect(auditMocks.writeRequiredAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'enrollment_correction',
        collection: 'student_course_enrollments',
        documentId: record.id,
      }),
      'student_enrollment'
    );
  });

  it('rejects Accounting even when the handler is called directly', async () => {
    const res = response();
    await handleCourseEnrollment(request({}), res, makeDb().db, { uid: 'accounting-1' }, {
      role: 'accounting',
      name: 'Accounting',
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes nothing while identity maintenance is read_only', async () => {
    const record = canonicalRecord();
    const { db, tx } = makeDb(record, {
      mode: 'read_only',
      activeRunId: 'run-1',
      migrationActorId: 'merge-bot',
    });
    const res = response();

    await handleCourseEnrollment(
      request({
        enrollmentId: record.id,
        status: 'on_leave',
        joinedAt: record.joinedAt,
        endedAt: null,
        statusReason: 'Family leave',
      }),
      res,
      db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(503);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('deletes legacy relationship fields after a correction in canonical_required', async () => {
    const record = canonicalRecord();
    const { db, tx, studentRef } = makeDb(record, undefined, 'canonical_required');
    const res = response();

    await handleCourseEnrollment(
      request({
        enrollmentId: record.id,
        status: 'on_leave',
        joinedAt: record.joinedAt,
        endedAt: null,
        statusReason: 'Family leave',
      }),
      res,
      db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    const studentUpdate = tx.update.mock.calls.find(([ref]: any[]) => ref === studentRef)?.[1];
    expect(studentUpdate).toEqual(
      expect.objectContaining({
        classId: FieldValue.delete(),
        teacherId: FieldValue.delete(),
        enrollmentStatus: FieldValue.delete(),
      })
    );
  });

  it('promotes the unique canonical trial row and synchronizes clean profile and linked users', async () => {
    const record = canonicalRecord('trial');
    const { db, tx, studentRef, userRefs } = makeDb(
      record,
      undefined,
      'canonical_required',
      {
        profile: { studentLifecycle: 'trial' },
        linkedUsers: ['student:stu-1', 'parent:stu-1'],
      }
    );
    const res = response();

    await handleCourseEnrollment(
      request({
        enrollmentId: record.id,
        status: 'active',
        joinedAt: record.joinedAt,
        endedAt: null,
        statusReason: 'Trial accepted manually',
      }),
      res,
      db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({
        studentLifecycle: 'enrolled',
        currentEnrollmentId: record.id,
        classId: FieldValue.delete(),
        teacherId: FieldValue.delete(),
        enrollmentStatus: FieldValue.delete(),
      })
    );
    for (const ref of userRefs.values()) {
      expect(tx.update).toHaveBeenCalledWith(
        ref,
        expect.objectContaining({
          classId: FieldValue.delete(),
          teacherId: FieldValue.delete(),
          enrollmentStatus: FieldValue.delete(),
        })
      );
    }
  });

  it('adopts a closed row when the correction makes it the unique canonical open enrollment', async () => {
    const record = canonicalRecord('dropped');
    const { db, tx, studentRef } = makeDb(record, undefined, 'canonical_required', {
      profile: { studentLifecycle: 'archived' },
    });

    await handleCourseEnrollment(
      request({
        enrollmentId: record.id,
        status: 'active',
        joinedAt: record.joinedAt,
        endedAt: null,
        statusReason: 'Administrative restoration',
      }),
      response(),
      db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(tx.update).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({
        studentLifecycle: 'enrolled',
        currentEnrollmentId: record.id,
      })
    );
  });

  it('keeps the current legacy projection after a correction in canonical_preferred', async () => {
    const record = canonicalRecord();
    const { db, tx, studentRef } = makeDb(record, undefined, 'canonical_preferred');
    const res = response();

    await handleCourseEnrollment(
      request({
        enrollmentId: record.id,
        status: 'on_leave',
        joinedAt: record.joinedAt,
        endedAt: null,
        statusReason: 'Family leave',
      }),
      res,
      db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({ classId: 'class-1', enrollmentStatus: 'on_leave' })
    );
  });

  it('returns 503 when required audit logging fails', async () => {
    auditMocks.writeRequiredAuditLog.mockRejectedValueOnce(
      Object.assign(new Error('audit down'), { statusCode: 503 })
    );
    const record = canonicalRecord();
    const res = response();
    await handleCourseEnrollment(
      request({
        enrollmentId: record.id,
        status: 'on_leave',
        joinedAt: record.joinedAt,
        endedAt: null,
        statusReason: 'Audit failure test',
      }),
      res,
      makeDb().db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );
    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
  });
});
