import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/zalo/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { getZaloConfig, sendZaloZNSMessage } from '../../server/api/lib/zalo/zaloHelper.js';
import {
  checkRateLimit,
  isDuplicateWithinWindow,
  markRecord,
} from '../../server/api/lib/auth/rateLimit.js';
import { writeOptionalAuditLog } from '../../server/api/lib/logging/auditLog.js';
import {
  createDocumentStoreTransactionHarness,
  makeDocumentStoreDocSnapshot,
  makeDocumentStoreQuerySnapshot,
} from '../../server/api/lib/documentStore/testDocumentStoreMocks.js';
import {
  assertCourseClosingClassApproved,
  assertCourseClosingSendAllowed,
  CourseClosingAlreadySentError,
  CourseClosingError,
} from '../../server/api/classes/helpers/courseClosing.js';
import { createInMemoryDocumentStore } from '../../test-utils/inMemoryDocumentStore.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../../server/api/lib/maintenance/studentIdentityMaintenance.js';
import { dispatchZaloBotRoute } from '../../server/api/zalo-bot/routeHandler.js';

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
  setCorsHeaders: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../../server/api/lib/zalo/zaloHelper.js', () => ({
  getZaloConfig: vi.fn(() => ({
    appId: 'app-id',
    appSecret: 'app-secret',
    oaId: 'oa-id',
    znsTemplateId: 'absence-template',
    znsEvalTemplateId: 'eval-template',
    znsStaffTemplateId: 'staff-template',
    znsPaymentTemplateId: 'payment-template',
    znsTuitionNoticeTemplateId: 'tuition-notice-template',
    znsNextCourseTuitionTemplateId: 'next-course-tuition-template',
    znsRankTemplateId: 'rank-template',
  })),
  sendZaloZNSMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
  checkZaloConnection: vi.fn().mockResolvedValue({ configured: true, connected: true }),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeOptionalAuditLog: vi.fn(),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 19 }),
  isDuplicateWithinWindow: vi.fn().mockResolvedValue(false),
  markRecord: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/zalo-bot/routeHandler.js', () => ({
  dispatchZaloBotRoute: vi.fn(),
}));

vi.mock('../../server/api/classes/helpers/courseClosing.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../server/api/classes/helpers/courseClosing.js')>();
  return {
    ...actual,
    assertCourseClosingClassApproved: vi.fn(),
    assertCourseClosingSendAllowed: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(assertCourseClosingClassApproved).mockResolvedValue({
    courseId: 'course-1',
    snapshot: { approvalValid: true },
  } as any);
  vi.mocked(verifyAuthContext).mockImplementation(async (req, res, requiredRoles) => {
    const decoded = await verifyAuthToken(req, res, requiredRoles);
    if (!decoded) return null;
    const db = getDb();
    let role = 'admin';
    let name = 'Admin';
    try {
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        role = data.role || role;
        name = data.displayName || data.name || name;
      }
    } catch (err) {
      // Fallback
    }
    return {
      decoded,
      context: {
        uid: decoded.uid,
        email: decoded.email,
        role,
        name,
        studentId: 'student-1',
        classId: 'class-1',
      },
    } as any;
  });
  vi.mocked(assertCourseClosingSendAllowed).mockImplementation(async (db, input) => {
    const [studentSnap, classSnap, evaluationsSnap] = await Promise.all([
      db.collection('students').doc(input.studentId).get(),
      db.collection('classes').doc(input.classId).get(),
      db.collection('evaluations').where('classId', '==', input.classId).get(),
    ]);
    const studentData = studentSnap.data() || {};
    const classData = classSnap.data() || {};
    const evaluationDoc = evaluationsSnap.docs.find(
      (item) =>
        String(item.data()?.studentId || '') === input.studentId &&
        String(item.data()?.evaluationType || 'final') === 'final'
    );
    const finalEvaluationData = evaluationDoc?.data() || {
      classId: input.classId,
      studentId: input.studentId,
      evaluationType: 'final',
      finalScore: 9,
      positivePoints: ['G'.repeat(240)],
      improvementPoints: 'B'.repeat(240),
      rank: 'first',
    };
    return {
      courseId: String(classData.currentCourseId || 'course-1'),
      classData: { id: input.classId, ...classData },
      studentData: { id: input.studentId, ...studentData },
      finalEvaluationData,
      evaluationId: evaluationDoc?.id || 'evaluation-1',
      evaluationVersion:
        evaluationDoc?.updateTime.toDate().toISOString() || '2026-01-01T00:00:00.000Z',
      snapshot: { approvalValid: true } as any,
    };
  });
});

it('dispatches the consolidated Zalo Bot namespace without entering OA/ZNS handlers', async () => {
  const req = { method: 'POST', query: { action: 'bot-webhook' }, headers: {} } as any;
  const res = mockRes();

  await handler(req, res);

  expect(dispatchZaloBotRoute).toHaveBeenCalledWith('webhook', req, res);
  expect(verifyAuthContext).not.toHaveBeenCalled();
});

afterEach(() => {
  vi.useRealTimers();
  resetStudentIdentityMaintenanceCacheForTests();
});

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
  res.end = vi.fn();
  return res;
}

it('refuses tuition notification dispatch before its handler during maintenance', async () => {
  resetStudentIdentityMaintenanceCacheForTests();
  vi.mocked(verifyAuthContext).mockResolvedValue({
    decoded: { uid: 'accounting-1' },
    context: { uid: 'accounting-1', role: 'accounting', name: 'Accounting' },
  } as never);
  const { db } = createInMemoryDocumentStore({
    '_maintenance/student_identity': {
      mode: 'read_only',
      activeRunId: 'run-1',
      migrationActorId: 'migration',
      updatedAt: '2026-08-09T09:00:00.000Z',
      updatedBy: 'operator',
    },
  });
  vi.mocked(getDb).mockReturnValue(db as never);

  const res = mockRes();
  await handler(
    {
      method: 'POST',
      headers: {},
      query: { action: 'notify-tuition-reminder' },
      body: { studentId: 'student-1' },
    } as never,
    res
  );

  expect(res.statusCode).toBe(503);
  expect(res.body).toMatchObject({
    success: false,
    code: 'STUDENT_IDENTITY_MAINTENANCE',
  });
  expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'accounting']);
  expect(sendZaloZNSMessage).not.toHaveBeenCalled();
});

it('rejects unauthorized tuition notifications before reading maintenance state', async () => {
  vi.clearAllMocks();
  vi.mocked(verifyAuthContext).mockImplementationOnce(async (_req, res) => {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  });

  const res = mockRes();
  await handler(
    {
      method: 'POST',
      headers: {},
      query: { action: 'notify-tuition-reminder' },
      body: { studentId: 'student-1' },
    } as never,
    res
  );

  expect(res.statusCode).toBe(401);
  expect(getDb).not.toHaveBeenCalled();
  expect(sendZaloZNSMessage).not.toHaveBeenCalled();
});

function doc(data: Record<string, unknown>, exists = true) {
  const id = String(data.id || 'doc-id');
  return makeDocumentStoreDocSnapshot({ id, path: `test/${id}`, data, exists });
}

function makeDb(options: {
  user?: Record<string, unknown>;
  student?: Record<string, unknown>;
  classStudents?: Record<string, unknown>[];
  classData?: Record<string, unknown>;
  evaluations?: Record<string, unknown>[];
  ledger?: Record<string, unknown>;
  ledgers?: Array<Record<string, unknown>>;
  receipt?: Record<string, unknown>;
  zaloNotifications?: Record<string, unknown>[];
}) {
  const transactionHarness = createDocumentStoreTransactionHarness();
  const add = vi.fn().mockResolvedValue({ id: 'log-1' });
  const bulkJobSet = vi.fn().mockResolvedValue(undefined);
  const ledgerUpdate = vi.fn().mockResolvedValue(undefined);
  const allLedgers = options.ledgers ?? (options.ledger ? [options.ledger] : []);
  const ledgerById = new Map<string, Record<string, unknown>>();
  for (const item of allLedgers) {
    const id = String(item.id || '');
    if (id) ledgerById.set(id, item);
  }
  const ledgerUpdates: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const id of ledgerById.keys()) {
    ledgerUpdates[id] = vi.fn(async (data: Record<string, unknown>) => {
      ledgerUpdate(data);
      return undefined;
    });
  }
  function ledgerUpdateSpyFor(id: string) {
    if (!ledgerUpdates[id]) {
      ledgerUpdates[id] = vi.fn(async (data: Record<string, unknown>) => {
        ledgerUpdate(data);
        return undefined;
      });
    }
    return ledgerUpdates[id];
  }
  const ledgerQuery: any = {
    where: vi.fn(() => ledgerQuery),
    get: vi.fn().mockResolvedValue(makeDocumentStoreQuerySnapshot(allLedgers.map((item) => doc(item)))),
  };
  const receiptQuery: any = {
    limit: vi.fn(() => receiptQuery),
    get: vi.fn().mockResolvedValue({
      empty: !options.receipt,
      docs: options.receipt ? [doc(options.receipt)] : [],
    }),
  };
  const classStudentsQuery: any = {
    where: vi.fn(() => classStudentsQuery),
    limit: vi.fn(() => classStudentsQuery),
    get: vi.fn().mockResolvedValue({
      docs: (options.classStudents || (options.student ? [options.student] : [])).map((item) =>
        doc(item)
      ),
    }),
  };
  const evaluationsQuery: any = {
    where: vi.fn(() => evaluationsQuery),
    limit: vi.fn(() => evaluationsQuery),
    get: vi.fn().mockResolvedValue({
      docs: (options.evaluations || []).map((item) => doc(item)),
    }),
  };
  const zaloQuery: any = {
    add,
    where: vi.fn(() => zaloQuery),
    orderBy: vi.fn(() => zaloQuery),
    limit: vi.fn(() => zaloQuery),
    get: vi.fn().mockResolvedValue({
      empty: !options.zaloNotifications?.length,
      size: options.zaloNotifications?.length || 0,
      docs: (options.zaloNotifications || []).map((item) => doc(item)),
    }),
  };

  return {
    add,
    ledgerUpdate,
    ledgerUpdates,
    transactionWrites: transactionHarness.writes,
    db: {
      runTransaction: transactionHarness.runTransaction,
      getAll: vi.fn(async (...refs: Array<{ id: string }>) => {
        const students = options.classStudents || (options.student ? [options.student] : []);
        return refs.map((ref) => {
          const value = students.find((item) => String(item.id || '') === ref.id);
          return doc(value || { id: ref.id }, Boolean(value));
        });
      }),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(doc(options.user || {})) })),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn((id: string) => ({
              id,
              get: vi.fn().mockResolvedValue(doc(options.student || {}, Boolean(options.student))),
            })),
            where: vi.fn(() => classStudentsQuery),
          };
        }
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(doc(options.classData || {}, Boolean(options.classData))),
            })),
          };
        }
        if (name === 'receipts') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc(options.receipt || {}, Boolean(options.receipt))),
            })),
            where: vi.fn(() => receiptQuery),
          };
        }
        if (name === 'course_fee_ledgers') {
          return {
            doc: vi.fn((id: string) => {
              const ledgerData = ledgerById.get(id);
              return {
                get: vi.fn().mockResolvedValue(doc(ledgerData || { id }, Boolean(ledgerData))),
                update: ledgerUpdateSpyFor(id),
              };
            }),
            where: vi.fn(() => ledgerQuery),
          };
        }
        if (name === 'notifications') return { add };
        if (name === 'zalo_notifications') return zaloQuery;
        if (name === 'zalo_bulk_jobs') {
          return { doc: vi.fn(() => ({ id: 'job-1', set: bulkJobSet })) };
        }
        if (name === 'zalo_bulk_job_items') return { add };
        // Class membership is asked of the enrollment now, not of the
        // profile's `classId` projection. Empty here, so these cases still
        // exercise the projection fallback they were written against.
        return {
          doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(doc({})) })),
          where: vi.fn(function self(this: unknown) {
            return { where: self, get: vi.fn().mockResolvedValue({ docs: [], empty: true }) };
          }),
        };
      }),
    },
  };
}

describe('Zalo notification API canonical recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19 });
    vi.mocked(isDuplicateWithinWindow).mockResolvedValue(false);
    vi.mocked(markRecord).mockResolvedValue(undefined);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
  });

  it.each([
    ['notify-evaluation', 'evaluation'],
    ['notify-rank-achievement', 'rank'],
    ['notify-tuition-notice', 'tuition'],
  ] as const)('rejects %s before approval', async (action, type) => {
    const { db } = makeDb({ user: { role: 'office', displayName: 'Office' } });
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assertCourseClosingSendAllowed).mockRejectedValueOnce(
      new CourseClosingError(
        409,
        'COURSE_CLOSING_NOT_APPROVED',
        'Course closing approval is required before sending',
        { approvalValid: false } as any
      )
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action },
        body: { studentId: 'stu-1', classId: 'class-1' },
      } as any,
      res
    );

    expect(assertCourseClosingSendAllowed).toHaveBeenCalledWith(db, {
      classId: 'class-1',
      studentId: 'stu-1',
      type,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'COURSE_CLOSING_NOT_APPROVED',
      courseClosing: { approvalValid: false },
    });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['COURSE_CLOSING_STALE', 'Course closing approval is stale'],
    ['COURSE_CLOSING_STUDENT_EXEMPT', 'Student is exempt from course closing'],
  ] as const)('preserves the %s guard response without contacting Zalo', async (code, message) => {
    const { db } = makeDb({ user: { role: 'office', displayName: 'Office' } });
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assertCourseClosingSendAllowed).mockRejectedValueOnce(
      new CourseClosingError(409, code, message, { approvalValid: false } as any)
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: { studentId: 'stu-1', classId: 'class-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ success: false, errorCode: code });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('ignores forged evaluation content and logs exact canonical evidence', async () => {
    const { db, add } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        currentCourseId: 'course-canonical',
        endDate: '2026-07-18',
      },
      evaluations: [
        {
          id: 'evaluation-canonical',
          classId: 'class-1',
          studentId: 'stu-1',
          evaluationType: 'final',
          finalScore: 8,
          positivePoints: ['Canonical strength'],
          improvementPoints: 'Canonical improvement',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          finalGrade: '10',
          good: 'Forged strength',
          bad: 'Forged improvement',
          courseEndDate: '2000-01-01',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'eval-template',
      expect.objectContaining({
        course_end_date: '18/07/2026',
        final_grade: '8',
        good: 'Canonical strength',
        bad: 'Canonical improvement',
      }),
      '84384072314',
      expect.any(String)
    );
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        courseId: 'course-canonical',
        evaluationId: 'evaluation-canonical',
        evaluationVersion: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  it('preserves the existing duplicate evaluation response without contacting Zalo', async () => {
    const { db } = makeDb({ user: { role: 'office', displayName: 'Office' } });
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assertCourseClosingSendAllowed).mockRejectedValueOnce(
      new CourseClosingAlreadySentError('evaluation', {
        courseId: 'course-1',
        classData: { id: 'class-1', name: 'Class 1', endDate: '2026-07-18' },
        studentData: { id: 'stu-1', name: 'Student 1', classId: 'class-1' },
        finalEvaluationData: { id: 'eval-1', date: '2026-07-18' },
        evaluationId: 'eval-1',
        evaluationVersion: 'v1',
        snapshot: {} as any,
      })
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: { studentId: 'stu-1', classId: 'class-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, alreadySent: true }));
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('records failed canonical evaluation evidence without advancing the send marker', async () => {
    vi.mocked(sendZaloZNSMessage).mockResolvedValueOnce({
      success: false,
      error: 'temporary gateway failure',
    } as any);
    const { db, add } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        currentCourseId: 'course-canonical',
        endDate: '2026-07-18',
      },
      evaluations: [
        {
          id: 'evaluation-canonical',
          classId: 'class-1',
          studentId: 'stu-1',
          evaluationType: 'final',
          finalScore: 8,
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: { studentId: 'stu-1', classId: 'class-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(502);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        courseId: 'course-canonical',
        evaluationId: 'evaluation-canonical',
        evaluationVersion: '2026-01-01T00:00:00.000Z',
      })
    );
    expect(markRecord).not.toHaveBeenCalled();
  });

  it('ignores forged absence recipient fields and sends to the canonical student contact', async () => {
    const { db } = makeDb({
      user: { role: 'admin', displayName: 'Admin' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: { id: 'class-1', name: 'Canonical Class', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-absence' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          studentName: 'Forged Student',
          phone: '84999999999',
          date: '2026-05-17',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'absence-template',
      expect.objectContaining({
        student_name: 'Canonical Student',
        student_id: 'HS001',
      }),
      '84384072314',
      'edutrack_abs_stu-1_2026-05-17'
    );
  });

  it('ignores a forged rank and sends the current evaluation rank', async () => {
    const { db, add } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        currentCourseId: 'course-canonical',
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-rank-achievement' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          rank: 'second',
          studentName: 'Forged Student',
          phone: '84999999999',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'rank-template',
      expect.objectContaining({
        student_name: 'Canonical Student',
        student_code: 'HS001',
        rank: 'HẠNG NHẤT',
        discount: '10%',
      }),
      '84384072314',
      expect.stringMatching(/^edutrack_rank_stu-1_/)
    );
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        rank: 'first',
        courseId: 'course-canonical',
        evaluationId: 'evaluation-1',
        evaluationVersion: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  it('returns a clear error when rank template is not configured', async () => {
    const { db } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: { id: 'class-1', name: 'Canonical Class', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    const { getZaloConfig } = await import('../../server/api/lib/zalo/zaloHelper.js');
    vi.mocked(getZaloConfig).mockReturnValueOnce({
      appId: 'app-id',
      appSecret: 'app-secret',
      oaId: 'oa-id',
      znsTemplateId: 'absence-template',
      znsOtpTemplateId: 'otp-template',
      znsEvalTemplateId: 'eval-template',
      znsStaffTemplateId: 'staff-template',
      znsPaymentTemplateId: 'payment-template',
      znsTuitionNoticeTemplateId: 'tuition-notice-template',
      znsNextCourseTuitionTemplateId: 'next-course-tuition-template',
      znsRankTemplateId: '',
      initialAccessToken: '',
      refreshToken: '',
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-rank-achievement' },
        body: { studentId: 'stu-1', classId: 'class-1', rank: 'first' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('rank');
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('returns full Zalo log summaries for admin users', async () => {
    const logQuery: any = {
      orderBy: vi.fn(() => logQuery),
      limit: vi.fn(() => logQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: 'zalo-1',
            data: () => ({
              type: 'absence',
              status: 'sent',
              studentId: 'stu-1',
              studentName: 'Canonical Student',
              phone: '84384072314',
              classId: 'class-1',
              createdAt: '2026-05-26T08:00:00.000Z',
            }),
          },
        ],
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc({ role: 'admin', displayName: 'Admin' })),
            })),
          };
        }
        if (name === 'zalo_notifications') return logQuery;
        if (name === 'students' || name === 'classes') {
          return { get: vi.fn().mockResolvedValue({ docs: [] }) };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'zalo-log-summary' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.logs[0]).toMatchObject({
      id: 'zalo-1',
      studentName: 'Canonical Student',
      phone: '84384072314',
    });
    expect(JSON.stringify(res.body)).toContain('84384072314');
  });

  it('returns redacted Zalo log summaries for accounting users', async () => {
    const logQuery: any = {
      orderBy: vi.fn(() => logQuery),
      limit: vi.fn(() => logQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: 'zalo-1',
            data: () => ({
              type: 'absence',
              status: 'sent',
              studentId: 'stu-1',
              studentName: 'Canonical Student',
              phone: '84384072314',
              classId: 'class-1',
              createdAt: '2026-05-26T08:00:00.000Z',
            }),
          },
        ],
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(doc({ role: 'accounting', displayName: 'Accounting' })),
            })),
          };
        }
        if (name === 'zalo_notifications') return logQuery;
        if (name === 'students' || name === 'classes') {
          return { get: vi.fn().mockResolvedValue({ docs: [] }) };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'zalo-log-summary' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.logs[0]).toMatchObject({
      id: 'zalo-1',
      studentName: 'C*** S***',
      phoneMasked: '84***314',
    });
    expect(JSON.stringify(res.body)).not.toContain('84384072314');
  });

  it('returns Zalo send counts after checking teacher class access', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@test.com',
    } as any);
    const countQuery: any = {
      where: vi.fn(() => countQuery),
      limit: vi.fn(() => countQuery),
      get: vi.fn().mockResolvedValue({ size: 1 }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc({ role: 'teacher', displayName: 'Teacher' })),
            })),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  doc({ id: 'stu-1', classId: 'class-1', teacherId: 'teacher-1' })
                ),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc({ id: 'class-1', teacherId: 'teacher-1' })),
            })),
          };
        }
        if (name === 'zalo_notifications') return countQuery;
        // Class membership comes from enrollments now; empty here so the case
        // still exercises the profile-projection fallback it was written for.
        return {
          doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(doc({})) })),
          where: vi.fn(function self(this: unknown) {
            return { where: self, get: vi.fn().mockResolvedValue({ docs: [], empty: true }) };
          }),
        };
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {
          action: 'zalo-send-count',
          studentId: 'stu-1',
          classId: 'class-1',
          type: 'absence',
          context: '2026-05-26',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, allowed: true, currentCount: 1, max: 2 });
    expect(countQuery.where).toHaveBeenCalledWith('studentId', '==', 'stu-1');
    expect(countQuery.where).toHaveBeenCalledWith('date', '==', '2026-05-26');
  });

  it('uses verified auth context for message actions without an extra user lookup', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValueOnce({
      decoded: { uid: 'teacher-1', email: 'teacher@test.com' } as any,
      context: {
        uid: 'teacher-1',
        email: 'teacher@test.com',
        role: 'teacher',
        name: 'Teacher One',
        teacherId: 'teacher-1',
      },
    } as any);
    vi.mocked(verifyAuthToken).mockClear();

    const countQuery: any = {
      where: vi.fn(() => countQuery),
      limit: vi.fn(() => countQuery),
      get: vi.fn().mockResolvedValue({ size: 0 }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          throw new Error('users collection should not be read after verifyAuthContext');
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  doc({ id: 'stu-1', classId: 'class-1', teacherId: 'teacher-1' })
                ),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc({ id: 'class-1', teacherId: 'teacher-1' })),
            })),
          };
        }
        if (name === 'zalo_notifications') return countQuery;
        // Class membership comes from enrollments now; empty here so the case
        // still exercises the profile-projection fallback it was written for.
        return {
          doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(doc({})) })),
          where: vi.fn(function self(this: unknown) {
            return { where: self, get: vi.fn().mockResolvedValue({ docs: [], empty: true }) };
          }),
        };
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {
          action: 'zalo-send-count',
          studentId: 'stu-1',
          classId: 'class-1',
          type: 'evaluation',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), res, [
      'admin',
      'teacher',
      'parent',
      'accounting',
      'office',
    ]);
    expect(verifyAuthToken).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalledWith('users');
  });

  it('does not expose Zalo gateway diagnostics when an absence send fails', async () => {
    vi.mocked(sendZaloZNSMessage).mockResolvedValueOnce({
      success: false,
      error: 'access_token=secret-token upstream stack trace',
    } as any);
    const { db, add } = makeDb({
      user: { role: 'admin', displayName: 'Admin' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: { id: 'class-1', name: 'Canonical Class', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-absence' },
        body: { studentId: 'stu-1', classId: 'class-1', date: '2026-05-17' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'gateway_error',
      error: 'Failed to send Zalo notification',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
    expect(JSON.stringify(res.body)).not.toContain('upstream stack trace');
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'access_token=[REDACTED] upstream stack trace',
      })
    );
  });

  it('rate limits server-side Zalo sends before contacting the gateway', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0 });
    const { db } = makeDb({
      user: { role: 'admin', displayName: 'Admin' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: { id: 'class-1', name: 'Canonical Class', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-absence' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          date: '2026-05-17',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual(
      expect.objectContaining({ success: false, errorCode: 'rate_limited' })
    );
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('deduplicates repeated absence sends within the server window', async () => {
    vi.mocked(isDuplicateWithinWindow).mockResolvedValueOnce(true);
    const { db } = makeDb({
      user: { role: 'admin', displayName: 'Admin' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: { id: 'class-1', name: 'Canonical Class', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-absence' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          date: '2026-05-17',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, alreadySent: true }));
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(markRecord).not.toHaveBeenCalled();
  });

  it('rejects teacher evaluation sends at the role gate', async () => {
    vi.mocked(verifyAuthToken).mockImplementationOnce(async (_req, res, roles) => {
      expect(roles).toEqual(['admin', 'office']);
      res.status(403).json({ success: false, error: 'Forbidden' });
      return null as any;
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: { studentId: 'stu-1', classId: 'class-1', finalGrade: '9' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('limits evaluation good and bad template fields to 200 characters', async () => {
    const { db } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: { id: 'class-1', name: 'Canonical Class', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          finalGrade: '9',
          good: 'G'.repeat(240),
          bad: 'B'.repeat(240),
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'eval-template',
      expect.objectContaining({
        good: 'G'.repeat(200),
        bad: 'B'.repeat(200),
      }),
      '84384072314',
      expect.any(String)
    );
  });

  it('sends evaluation without also sending the next-course tuition notice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db, ledgerUpdate, add } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
        grade: 3,
        daysOfWeek: [1, 5],
      },
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
        termStart: '2026-02-01',
        termEnd: '2026-04-06',
        tuitionNoticeCount: 0,
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          finalGrade: '9',
          courseEndDate: '06/04/2026',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledTimes(1);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'eval-template',
      expect.objectContaining({
        student_name: 'Canonical Student',
        course_end_date: '06/04/2026',
      }),
      '84384072314',
      expect.any(String)
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
      })
    );
    expect(res.body).not.toHaveProperty('tuitionSent');
    expect(res.body).not.toHaveProperty('tuitionNoticeCount');
    expect(ledgerUpdate).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'evaluation_notice',
        status: 'sent',
      })
    );
  });

  it('does not let an existing tuition notice counter block evaluation sends', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db, ledgerUpdate } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
        grade: 3,
        daysOfWeek: [1, 5],
      },
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
        termStart: '2026-02-01',
        termEnd: '2026-04-06',
        tuitionNoticeCount: 1,
        tuitionNoticeLastSentAt: '2026-05-19T03:00:00.000Z',
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-evaluation' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          finalGrade: '9',
          courseEndDate: '06/04/2026',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledTimes(1);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'eval-template',
      expect.objectContaining({
        student_name: 'Canonical Student',
        course_end_date: '06/04/2026',
      }),
      '84384072314',
      expect.any(String)
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
      })
    );
    expect(res.body).not.toHaveProperty('tuitionAlreadySent');
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('lets office send the next-course tuition notice from class tuitionFee without a ledger', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
        grade: 2,
        daysOfWeek: [1, 5],
      },
      evaluations: [
        {
          id: 'eval-final',
          studentId: 'stu-1',
          classId: 'class-1',
          evaluationType: 'final',
          date: '2026-04-06',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          courseEndDate: '06/04/2026',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'next-course-tuition-template',
      expect.objectContaining({
        previous_end_date: '06/04/2026',
        start_date: '10/04/2026',
        end_date: '01/06/2026',
        amount: 1000000,
        due_date: '24/04/2026',
      }),
      '84384072314',
      expect.stringMatching(/^edutrack_fee_stu-1_/)
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        tuitionAmount: 1000000,
        tuitionDueDate: '24/04/2026',
      })
    );
  });

  it('normalizes formatted tuition fee strings before sending the tuition notice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db, add } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: '1.000.000',
        currentCourseId: 'course-canonical',
      },
      evaluations: [
        {
          id: 'eval-final',
          studentId: 'stu-1',
          classId: 'class-1',
          evaluationType: 'final',
          date: '2026-04-06',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          courseEndDate: '06/04/2026',
          schoolFee: 1,
          paymentDueDate: '01/01/2000',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'next-course-tuition-template',
      expect.objectContaining({
        amount: 1000000,
      }),
      '84384072314',
      expect.stringMatching(/^edutrack_fee_stu-1_/)
    );
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        courseId: 'course-canonical',
      })
    );
  });

  it('prevents next-course tuition notices before final evaluations are complete', async () => {
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'office', displayName: 'Office' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
        enrollmentStatus: 'active',
      },
      classStudents: [
        {
          id: 'stu-1',
          name: 'Canonical Student',
          classId: 'class-1',
          enrollmentStatus: 'active',
        },
      ],
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
      },
      evaluations: [],
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assertCourseClosingSendAllowed).mockRejectedValueOnce(
      new CourseClosingError(
        409,
        'COURSE_CLOSING_EVALUATIONS_INCOMPLETE',
        'Current final evaluation is required before sending',
        { missingEvaluationStudentIds: ['stu-1'] } as any
      )
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          courseEndDate: '06/04/2026',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.errorCode).toBe('COURSE_CLOSING_EVALUATIONS_INCOMPLETE');
    expect(res.body.error).toMatch(/final evaluation/i);
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('lets accounting send only the tuition reminder for an unpaid ledger', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db, ledgerUpdate, add } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
        walletBalance: 0,
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
      },
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 250000,
        discountTotal: 100000,
        status: 'partial',
        termStart: '2026-02-01',
        termEnd: '2026-04-06',
        tuitionReminderCount: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledTimes(1);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'tuition-notice-template',
      expect.objectContaining({
        student_name: 'Canonical Student',
        student_code: 'HS001',
        amount: 650000,
        semester: 'Khóa 01/02 - 06/04',
        due_date: '02/06/2026',
      }),
      '84384072314',
      expect.stringMatching(/^edutrack_fee_stu-1_/)
    );
    const tuitionPayload = vi.mocked(sendZaloZNSMessage).mock.calls[0][1];
    expect(tuitionPayload).not.toHaveProperty('previous_end_date');
    expect(tuitionPayload).not.toHaveProperty('start_date');
    expect(tuitionPayload).not.toHaveProperty('end_date');
    expect(tuitionPayload).not.toHaveProperty('course_end_date');
    expect(tuitionPayload).not.toHaveProperty('school_fee');
    expect(tuitionPayload).not.toHaveProperty('date');
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        tuitionAmount: 650000,
        tuitionDueDate: '02/06/2026',
        tuitionReminderCount: 3,
        semester: 'Khóa 01/02 - 06/04',
        ledgerIds: ['ledger-1'],
      })
    );
    expect(ledgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tuitionReminderCount: expect.any(Object),
        tuitionReminderLastSentBy: 'admin-uid',
        tuitionReminderLastSentByName: 'Accounting',
        tuitionReminderLastAmount: 650000,
        tuitionReminderLastDueDate: '02/06/2026',
      })
    );
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tuition_reminder',
        status: 'sent',
        source: 'accounting_student_debt',
        ledgerIds: ['ledger-1'],
        grossOutstanding: 650000,
        walletBalanceApplied: 0,
        netOutstanding: 650000,
        semester: 'Khóa 01/02 - 06/04',
      })
    );
  });

  it("sends one combined tuition reminder for all of a student's outstanding courses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db, ledgerUpdates } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-new',
        contact: '0384072314',
        walletBalance: 100_000,
      },
      classData: {
        id: 'class-new',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-old',
          studentId: 'stu-1',
          classId: 'class-old',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 100_000,
          discountTotal: 0,
          status: 'partial',
          tuitionReminderCount: 1,
        },
        {
          id: 'ledger-new',
          studentId: 'stu-1',
          classId: 'class-new',
          termStart: '2026-08-27',
          termEnd: '2026-11-09',
          amount: 900_000,
          paidTotal: 0,
          discountTotal: 100_000,
          status: 'unpaid',
          tuitionReminderCount: 2,
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledTimes(1);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'tuition-notice-template',
      expect.objectContaining({
        student_name: 'Canonical Student',
        student_code: 'HS001',
        amount: 1_300_000,
        semester: 'Khóa 27/08 - 09/11, Khóa 22/08 - 09/12',
        due_date: '02/06/2026',
      }),
      '84384072314',
      expect.stringMatching(/^edutrack_fee_stu-1_/)
    );
    expect(ledgerUpdates['ledger-new']).toHaveBeenCalledWith(
      expect.objectContaining({ tuitionReminderLastAmount: 1_300_000 })
    );
    expect(ledgerUpdates['ledger-old']).toHaveBeenCalledWith(
      expect.objectContaining({ tuitionReminderLastAmount: 1_300_000 })
    );
    expect(res.body).toMatchObject({
      success: true,
      tuitionAmount: 1_300_000,
      semester: 'Khóa 27/08 - 09/11, Khóa 22/08 - 09/12',
      ledgerIds: ['ledger-new', 'ledger-old'],
    });
  });

  it('resolves the same combined student-level tuition reminder from a legacy ledgerId', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-new',
        contact: '0384072314',
        walletBalance: 100_000,
      },
      classData: {
        id: 'class-new',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-old',
          studentId: 'stu-1',
          classId: 'class-old',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 100_000,
          discountTotal: 0,
          status: 'partial',
          tuitionReminderCount: 1,
        },
        {
          id: 'ledger-new',
          studentId: 'stu-1',
          classId: 'class-new',
          termStart: '2026-08-27',
          termEnd: '2026-11-09',
          amount: 900_000,
          paidTotal: 0,
          discountTotal: 100_000,
          status: 'unpaid',
          tuitionReminderCount: 2,
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { ledgerId: 'ledger-new' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      semester: 'Khóa 27/08 - 09/11, Khóa 22/08 - 09/12',
      ledgerIds: ['ledger-new', 'ledger-old'],
    });
  });

  it('does not send a tuition reminder when wallet balance covers all outstanding tuition', async () => {
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
        walletBalance: 900_000,
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-1',
          studentId: 'stu-1',
          classId: 'class-1',
          termStart: '2026-08-27',
          termEnd: '2026-11-09',
          amount: 900_000,
          paidTotal: 0,
          discountTotal: 0,
          status: 'unpaid',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, errorCode: 'TUITION_DEBT_EMPTY' });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('does not send a tuition reminder when an indebted ledger is missing its term end date', async () => {
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
        walletBalance: 0,
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-1',
          studentId: 'stu-1',
          classId: 'class-1',
          termStart: '2026-08-27',
          termEnd: '',
          amount: 900_000,
          paidTotal: 0,
          discountTotal: 0,
          status: 'unpaid',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'TUITION_DEBT_TERM_DATES_MISSING',
    });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('does not send a tuition reminder when the complete course list exceeds the template limit', async () => {
    const ledgers = Array.from({ length: 8 }, (_, index) => ({
      id: `ledger-${index + 1}`,
      studentId: 'stu-1',
      classId: 'class-1',
      termStart: `2026-${String(index + 1).padStart(2, '0')}-01`,
      termEnd: `2026-${String(index + 1).padStart(2, '0')}-28`,
      amount: 900_000,
      paidTotal: 0,
      discountTotal: 0,
      status: 'unpaid',
    }));
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
        walletBalance: 0,
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers,
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'TUITION_DEBT_SEMESTER_TOO_LONG',
    });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('does not stamp any ledger when the tuition reminder Zalo send fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));
    vi.mocked(sendZaloZNSMessage).mockResolvedValueOnce({ success: false } as any);

    const { db, ledgerUpdates, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-new',
        contact: '0384072314',
        walletBalance: 100_000,
      },
      classData: {
        id: 'class-new',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-old',
          studentId: 'stu-1',
          classId: 'class-old',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 100_000,
          discountTotal: 0,
          status: 'partial',
          tuitionReminderCount: 1,
        },
        {
          id: 'ledger-new',
          studentId: 'stu-1',
          classId: 'class-new',
          termStart: '2026-08-27',
          termEnd: '2026-11-09',
          amount: 900_000,
          paidTotal: 0,
          discountTotal: 100_000,
          status: 'unpaid',
          tuitionReminderCount: 2,
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(502);
    expect(ledgerUpdates['ledger-new']).not.toHaveBeenCalled();
    expect(ledgerUpdates['ledger-old']).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it("sends the tuition reminder using the student's current class even when the only open debt belongs to a past class", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-current',
        contact: '0384072314',
        walletBalance: 0,
      },
      classData: {
        id: 'class-current',
        name: 'Current Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-old',
          studentId: 'stu-1',
          classId: 'class-old',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 100_000,
          discountTotal: 0,
          status: 'partial',
          tuitionReminderCount: 1,
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, ledgerIds: ['ledger-old'] });
  });

  it('returns student not found before calculating an empty debt snapshot', async () => {
    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'missing-student' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: 'Student not found' });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('uses a debt class when a legacy student has no current class', async () => {
    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: '',
        contact: '0384072314',
        walletBalance: 0,
      },
      classData: {
        id: 'class-old',
        name: 'Past Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-old',
          studentId: 'stu-1',
          classId: 'class-old',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 100_000,
          status: 'partial',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, ledgerIds: ['ledger-old'] });
  });

  it('rejects an invalid canonical student phone before contacting Zalo', async () => {
    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: 'not-a-phone',
        walletBalance: 0,
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-1',
          studentId: 'stu-1',
          classId: 'class-1',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 0,
          status: 'unpaid',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: 'Student contact is invalid' });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('returns a configuration error when the debt reminder template is missing', async () => {
    vi.mocked(getZaloConfig).mockReturnValueOnce({
      appId: 'app-id',
      appSecret: 'app-secret',
      oaId: 'oa-id',
      znsTemplateId: 'absence-template',
      znsOtpTemplateId: 'otp-template',
      znsEvalTemplateId: 'eval-template',
      znsStaffTemplateId: 'staff-template',
      znsPaymentTemplateId: 'payment-template',
      znsTuitionNoticeTemplateId: '',
      znsNextCourseTuitionTemplateId: 'next-course-tuition-template',
      znsRankTemplateId: 'rank-template',
      initialAccessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
        walletBalance: 0,
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledgers: [
        {
          id: 'ledger-1',
          studentId: 'stu-1',
          classId: 'class-1',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 0,
          status: 'unpaid',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'tuition_template_not_configured',
      error: 'ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID is not configured',
    });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('lets accounting send the next-course tuition notice and update its counter only once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db, ledgerUpdate, add } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
        grade: 3,
        daysOfWeek: [1, 5],
      },
      evaluations: [
        {
          id: 'eval-final',
          studentId: 'stu-1',
          classId: 'class-1',
          evaluationType: 'final',
          date: '2026-04-06',
        },
      ],
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 1000000,
        discountTotal: 0,
        status: 'paid',
        termEnd: '2026-04-06',
        tuitionReminderCount: 2,
        tuitionNoticeCount: 0,
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledTimes(1);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'next-course-tuition-template',
      expect.objectContaining({
        student_name: 'Canonical Student',
        student_code: 'HS001',
        previous_end_date: '06/04/2026',
        start_date: '10/04/2026',
        end_date: '01/06/2026',
        amount: 1000000,
        due_date: '24/04/2026',
      }),
      '84384072314',
      expect.stringMatching(/^edutrack_fee_stu-1_/)
    );
    const tuitionPayload = vi.mocked(sendZaloZNSMessage).mock.calls[0][1];
    expect(tuitionPayload).not.toHaveProperty('course_end_date');
    expect(tuitionPayload).not.toHaveProperty('school_fee');
    expect(tuitionPayload).not.toHaveProperty('date');
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        tuitionAmount: 1000000,
        tuitionDueDate: '24/04/2026',
        tuitionNoticeCount: 1,
      })
    );
    expect(ledgerUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = ledgerUpdate.mock.calls[0][0];
    expect(updatePayload).toEqual(
      expect.objectContaining({
        tuitionNoticeCount: expect.any(Object),
        tuitionNoticeLastSentBy: 'admin-uid',
        tuitionNoticeLastSentByName: 'Accounting',
        tuitionNoticeLastSource: 'accounting',
        tuitionNoticeLastAmount: 1000000,
        tuitionNoticeLastDueDate: '24/04/2026',
      })
    );
    expect(updatePayload).not.toHaveProperty('tuitionReminderCount');
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tuition_notice',
        status: 'sent',
      })
    );
  });

  it('schedules the tuition notice audit only after the success response is written', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T03:00:00Z'));

    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
        grade: 3,
        daysOfWeek: [1, 5],
      },
      evaluations: [
        {
          id: 'eval-final',
          studentId: 'stu-1',
          classId: 'class-1',
          evaluationType: 'final',
          date: '2026-04-06',
        },
      ],
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
        termEnd: '2026-04-06',
        tuitionNoticeCount: 0,
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    let responseWasWrittenBeforeAudit = false;
    vi.mocked(writeOptionalAuditLog).mockImplementation(() => {
      responseWasWrittenBeforeAudit = res.json.mock.calls.length > 0;
    });

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(writeOptionalAuditLog).toHaveBeenCalledTimes(1);
    expect(responseWasWrittenBeforeAudit).toBe(true);
  });

  it('prevents accounting from sending the next-course tuition notice twice for one ledger course', async () => {
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
      },
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 1000000,
        discountTotal: 0,
        status: 'paid',
        termEnd: '2026-04-06',
        tuitionNoticeCount: 1,
        tuitionNoticeLastSentAt: '2026-05-19T03:00:00.000Z',
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        alreadySent: true,
        tuitionNoticeCount: 1,
      })
    );
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('prevents accounting from sending tuition notice when office already sent without a ledger', async () => {
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-02-01',
        endDate: '2026-04-06',
        tuitionFee: 1000000,
      },
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
        termEnd: '2026-04-06',
        tuitionNoticeCount: 0,
      },
      zaloNotifications: [
        {
          id: 'zalo-prev',
          studentId: 'stu-1',
          classId: 'class-1',
          type: 'next_course_tuition',
          status: 'sent',
          amount: 1000000,
          courseEndDate: '2026-04-06',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        alreadySent: true,
      })
    );
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('allows accounting to send a new-course tuition notice when only old-course logs exist', async () => {
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        tuitionFee: 1000000,
        terms: [
          {
            id: 'term-old',
            startDate: '2026-05-01',
            endDate: '2026-05-31',
          },
        ],
      },
      evaluations: [
        {
          id: 'eval-current-final',
          studentId: 'stu-1',
          classId: 'class-1',
          evaluationType: 'final',
          date: '2026-06-30',
        },
      ],
      ledger: {
        id: 'ledger-2',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
        termStart: '2026-06-01',
        termEnd: '2026-06-30',
        tuitionNoticeCount: 0,
      },
      zaloNotifications: [
        {
          id: 'zalo-old-course',
          studentId: 'stu-1',
          classId: 'class-1',
          type: 'next_course_tuition',
          status: 'sent',
          amount: 1000000,
          courseEndDate: '2026-05-31',
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-notice' },
        body: { ledgerId: 'ledger-2' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true }));
    expect(sendZaloZNSMessage).toHaveBeenCalledTimes(1);
    expect(ledgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tuitionNoticeCount: expect.anything(),
        tuitionNoticeLastSource: 'accounting',
      })
    );
  });

  it('does not send tuition reminder when the ledger has no remaining tuition', async () => {
    const { db, ledgerUpdate } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Canonical Class',
        teacherId: 'teacher-1',
      },
      ledger: {
        id: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 1000000,
        paidTotal: 1000000,
        discountTotal: 0,
        status: 'paid',
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-tuition-reminder' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('resolves payment confirmation data from the canonical receipt', async () => {
    const { db } = makeDb({
      user: { role: 'accounting', displayName: 'Accounting' },
      student: {
        id: 'stu-1',
        name: 'Canonical Student',
        code: 'HS001',
        contact: '0384072314',
      },
      classData: {
        id: 'class-1',
        name: 'Course A',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      },
      receipt: {
        id: 'receipt-1',
        receiptNo: 'PT-260517-001',
        studentId: 'stu-1',
        classId: 'class-1',
        amountReceived: 500000,
        receivedDate: '2026-05-17',
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'notify-payment-confirm' },
        body: {
          receiptNo: 'PT-260517-001',
          studentName: 'Forged',
          phone: '84999999999',
          amount: 1,
          paymentDate: '01/01/2000',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'payment-template',
      expect.objectContaining({
        ten_hoc_vien: 'Canonical Student',
        so_tien: 500000,
        ngay_thanh_toan: '17/05/2026',
      }),
      '84384072314',
      'edutrack_pay_PT-260517-001'
    );
  });
});

describe('App notification API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@test.com',
    } as any);
  });

  it('creates in-app notifications without undefined optional fields or Zalo sends', async () => {
    const { db, add } = makeDb({
      user: { role: 'teacher', displayName: 'Teacher' },
      student: { id: 'stu-1', name: 'Student 1', classId: 'class-1', contact: '0384072314' },
      classData: { id: 'class-1', name: 'Class 1', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'send-notification' },
        body: {
          studentId: 'stu-1',
          title: 'Nhắc nộp bài',
          message: 'Em còn thiếu bài tập.',
          type: 'missing_assignment',
          classId: 'class-1',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledOnce();
    const notificationPayload = add.mock.calls[0][0] as Record<string, unknown>;
    expect(notificationPayload).not.toHaveProperty('templateKey');
    expect(notificationPayload).not.toHaveProperty('contextDate');
  });

  it('rejects notifications for students outside the authorized class', async () => {
    const { db, add } = makeDb({
      user: { role: 'teacher', displayName: 'Teacher' },
      student: { id: 'stu-foreign', name: 'Foreign Student', classId: 'class-2' },
      classData: { id: 'class-1', name: 'Class 1', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'send-notification' },
        body: {
          studentId: 'stu-foreign',
          title: 'Nhắc nộp bài',
          message: 'Em còn thiếu bài tập.',
          type: 'missing_assignment',
          classId: 'class-1',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('Disabled chat actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'teacher-1', email: 'teacher@test.com' } as any,
      context: { uid: 'teacher-1', role: 'teacher', name: 'Teacher One' },
    });
    vi.mocked(getDb).mockReturnValue({} as any);
  });

  it.each(['create-conversation', 'send-message', 'mark-read', 'repair-conversation'])(
    'returns 410 for %s',
    async (action) => {
      const res = mockRes();
      await handler(
        {
          method: 'POST',
          headers: {},
          query: { action },
          body: {},
        } as any,
        res
      );

      expect(res.statusCode).toBe(410);
      expect(res.body).toMatchObject({ success: false, error: 'Messaging has been removed' });
    }
  );

  it('routes bulk notification jobs through one authenticated request', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'office-1' } as any,
      context: { uid: 'office-1', role: 'office', name: 'Office One' },
    });
    vi.mocked(getDb).mockReturnValue(
      makeDb({
        student: { id: 'student-1', classId: 'class-1' },
        classData: { id: 'class-1', name: 'Class One', teacherId: 'teacher-1' },
      }).db as any
    );

    const response = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'bulk-notification-job' },
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }],
        },
        headers: { authorization: 'Bearer token' },
      } as any,
      response as any
    );

    expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), response, [
      'admin',
      'office',
      'accounting',
    ]);
  });

  it('creates no bulk job when the class approval is stale', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'office-1' } as any,
      context: { uid: 'office-1', role: 'office', name: 'Office One' },
    });
    const { db } = makeDb({
      student: { id: 'student-1', classId: 'class-1' },
      classData: { id: 'class-1', name: 'Class One', teacherId: 'teacher-1' },
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assertCourseClosingClassApproved).mockRejectedValueOnce(
      new CourseClosingError(409, 'COURSE_CLOSING_STALE', 'Course closing approval is stale', {
        approvalValid: false,
      } as any)
    );

    const response = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'bulk-notification-job' },
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }],
        },
        headers: { authorization: 'Bearer token' },
      } as any,
      response
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: 'COURSE_CLOSING_STALE',
    });
    expect(db.collection).not.toHaveBeenCalledWith('zalo_bulk_jobs');
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });
});
