import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBulkNotificationJob } from './bulkNotificationJobs.js';
import { sendZaloZNSMessage } from '../../lib/zalo/zaloHelper.js';
import { logZaloNotification, markZaloSendRecord } from '../helpers/zaloBaseHelpers.js';
import { sendTrackedNextCourseTuitionNotice } from '../helpers/tuitionNotices.js';
import {
  assertCourseClosingClassApproved,
  assertCourseClosingSendAllowed,
  CourseClosingAlreadySentError,
  CourseClosingError,
} from '../../classes/helpers/courseClosing.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';

const assertTeacherClassAccess = vi.fn();

vi.mock('../../lib/services/classService.js', () => ({
  assertTeacherClassAccess: (...args: unknown[]) => assertTeacherClassAccess(...args),
}));

vi.mock('../../lib/zalo/zaloHelper.js', () => ({
  getZaloConfig: vi.fn(() => ({
    appId: 'app-id',
    appSecret: 'app-secret',
    znsEvalTemplateId: 'eval-template',
    znsRankTemplateId: 'rank-template',
    znsNextCourseTuitionTemplateId: 'tuition-template',
  })),
  sendZaloZNSMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'bulk-msg-1' }),
}));

vi.mock('../helpers/zaloBaseHelpers.js', async () => {
  const actual = await vi.importActual<typeof import('../helpers/zaloBaseHelpers.js')>(
    '../helpers/zaloBaseHelpers.js'
  );
  return {
    ...actual,
    logZaloNotification: vi.fn().mockResolvedValue(undefined),
    markZaloSendRecord: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../helpers/tuitionNotices.js', () => ({
  sendTrackedNextCourseTuitionNotice: vi.fn().mockResolvedValue({
    success: true,
    messageId: 'tuition-msg-1',
    amount: 1_000_000,
    paymentDueDate: '24/07/2026',
  }),
}));

vi.mock('../../classes/helpers/courseClosing.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../classes/helpers/courseClosing.js')>();
  return {
    ...actual,
    assertCourseClosingClassApproved: vi.fn(),
    assertCourseClosingSendAllowed: vi.fn(),
  };
});

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

function responseMock() {
  const response: any = { statusCode: 200 };
  response.status = vi.fn((statusCode: number) => {
    response.statusCode = statusCode;
    return response;
  });
  response.json = vi.fn((body: unknown) => {
    response.body = body;
    return response;
  });
  return response;
}

function canonicalContext(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
    courseId: 'course-1',
    classData: {
      id: 'class-1',
      name: 'Canonical Class',
      endDate: '2026-07-18',
      tuitionFee: 1_000_000,
    },
    studentData: {
      id: studentId,
      name: `Canonical ${studentId}`,
      code: `CODE-${studentId}`,
      classId: 'class-1',
      contact: '0900000001',
    },
    finalEvaluationData: {
      studentId,
      classId: 'class-1',
      evaluationType: 'final',
      finalScore: 8,
      positivePoints: ['Canonical strength'],
      improvementPoints: 'Canonical improvement',
      rank: 'first',
    },
    evaluationId: `evaluation-${studentId}`,
    evaluationVersion: `version-${studentId}`,
    snapshot: { approvalValid: true },
    ...overrides,
  } as any;
}

function createZaloBulkJobDbMock(options: {
  recipients: Record<string, unknown>[];
  ledgers?: Record<string, Record<string, unknown>>;
}) {
  const jobItemAdd = vi.fn().mockResolvedValue({ id: 'item-1' });
  const jobDocSet = vi.fn().mockResolvedValue(undefined);
  const jobDoc = vi.fn(() => ({ id: 'job-1', set: jobDocSet }));
  const collection = vi.fn((name: string) => {
    if (name === 'zalo_bulk_jobs') return { doc: jobDoc };
    if (name === 'zalo_bulk_job_items') return { add: jobItemAdd };
    if (name === 'course_fee_ledgers') {
      return {
        doc: (id: string) => ({
          id,
          get: vi.fn().mockResolvedValue({
            id,
            exists: Boolean(options.ledgers?.[id]),
            data: () => options.ledgers?.[id] || {},
          }),
        }),
      };
    }
    return { doc: (id: string) => ({ id, path: `${name}/${id}` }) };
  });
  const getAll = vi.fn(async (...refs: Array<{ id: string }>) =>
    refs.map((ref) => {
      const recipient = options.recipients.find((item) => item.id === ref.id);
      return {
        id: ref.id,
        exists: Boolean(recipient),
        data: () => recipient || {},
      };
    })
  );
  // A transaction that actually remembers what it wrote. The bulk handler now
  // takes a mutation lease, and a `get` that always answers "missing" would
  // make the lease look lost the moment it tried to renew or release it.
  const store = new Map<string, Record<string, unknown>>();
  const pathOf = (ref: { path?: string; id?: string }) => ref.path || ref.id || '';
  const runTransaction = vi.fn(async (cb) =>
    cb({
      get: vi.fn(async (ref: { path?: string; id?: string }) => {
        const key = pathOf(ref);
        const value = store.get(key);
        return { exists: value !== undefined, data: () => value ?? {} };
      }),
      set: vi.fn((ref: { path?: string; id?: string }, value: Record<string, unknown>) => {
        store.set(pathOf(ref), value);
      }),
      update: vi.fn((ref: { path?: string; id?: string }, value: Record<string, unknown>) => {
        store.set(pathOf(ref), { ...(store.get(pathOf(ref)) ?? {}), ...value });
      }),
      delete: vi.fn((ref: { path?: string; id?: string }) => {
        store.delete(pathOf(ref));
      }),
    })
  );
  const doc = vi.fn(() => ({
    get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  }));

  return { collection, getAll, jobDoc, jobDocSet, jobItemAdd, runTransaction, doc };
}

const actor = { uid: 'office-1', role: 'office', name: 'Office One' } as any;

describe('handleBulkNotificationJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertTeacherClassAccess.mockResolvedValue({
      id: 'class-1',
      name: 'Canonical Class',
      endDate: '2026-07-18',
      tuitionFee: 1_000_000,
    });
    vi.mocked(assertCourseClosingClassApproved).mockResolvedValue({
      courseId: 'course-1',
      snapshot: { approvalValid: true },
    } as any);
    vi.mocked(assertCourseClosingSendAllowed).mockImplementation(async (_db, input) =>
      canonicalContext(input.studentId)
    );
    vi.mocked(sendZaloZNSMessage).mockResolvedValue({
      success: true,
      messageId: 'bulk-msg-1',
    });
  });

  it('rejects empty identifier-only item lists', async () => {
    const response = responseMock();
    await handleBulkNotificationJob(
      { method: 'POST', body: { classId: 'class-1', type: 'evaluation', items: [] } } as any,
      response,
      {} as any,
      actor
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: 'items is required' });
  });

  it('creates no job when class approval is stale', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [{ id: 'student-1', classId: 'class-1' }],
    });
    vi.mocked(assertCourseClosingClassApproved).mockRejectedValueOnce(
      new CourseClosingError(409, 'COURSE_CLOSING_STALE', 'Course closing approval is stale', {
        approvalValid: false,
      } as any)
    );

    await expect(
      handleBulkNotificationJob(
        {
          method: 'POST',
          body: {
            classId: 'class-1',
            type: 'evaluation',
            items: [{ studentId: 'student-1' }],
          },
        } as any,
        responseMock(),
        db as any,
        actor
      )
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_STALE' });
    expect(db.jobDoc).not.toHaveBeenCalled();
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('rejects mixed-class students before enqueue', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [{ id: 'student-1', classId: 'class-2' }],
    });
    const response = responseMock();

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }],
        },
      } as any,
      response,
      db as any,
      actor
    );

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/outside class/i);
    expect(db.jobDoc).not.toHaveBeenCalled();
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('discards forged evaluation content and logs exact canonical evidence', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [
        {
          id: 'student-1',
          name: 'Untrusted snapshot name',
          contact: '0999999999',
          classId: 'class-1',
        },
      ],
    });
    const response = responseMock();

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [
            {
              studentId: 'student-1',
              finalGrade: '10',
              good: 'Forged strength',
              payload: { finalGrade: '10', bad: 'Forged weakness' },
            },
          ],
        },
      } as any,
      response,
      db as any,
      actor
    );

    expect(assertCourseClosingSendAllowed).toHaveBeenCalledWith(db, {
      classId: 'class-1',
      studentId: 'student-1',
      type: 'evaluation',
    });
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'eval-template',
      expect.objectContaining({
        student_name: 'Canonical student-1',
        final_grade: '8',
        good: 'Canonical strength',
        bad: 'Canonical improvement',
      }),
      '84900000001',
      expect.stringMatching(/^edutrack_eval_student-1_/)
    );
    expect(logZaloNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        courseId: 'course-1',
        evaluationId: 'evaluation-student-1',
        evaluationVersion: 'version-student-1',
        payloadCaptured: true,
        payloadSnapshot: expect.objectContaining({
          schemaVersion: 1,
          templateId: 'eval-template',
          phone: '84900000001',
          templateData: expect.objectContaining({
            student_name: 'Canonical student-1',
            final_grade: '8',
            good: 'Canonical strength',
            bad: 'Canonical improvement',
          }),
        }),
      })
    );
    expect(db.jobDocSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        courseId: 'course-1',
        items: [{ studentId: 'student-1' }],
      })
    );
    expect(response.body).toMatchObject({ success: true, successCount: 1 });
  });

  it('rechecks every item and stores a stable error when approval becomes stale', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [
        { id: 'student-1', classId: 'class-1' },
        { id: 'student-2', classId: 'class-1' },
      ],
    });
    vi.mocked(assertCourseClosingSendAllowed)
      .mockResolvedValueOnce(canonicalContext('student-1'))
      .mockRejectedValueOnce(
        new CourseClosingError(409, 'COURSE_CLOSING_STALE', 'Course closing approval is stale', {
          approvalValid: false,
        } as any)
      );

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }, { studentId: 'student-2' }],
        },
      } as any,
      responseMock(),
      db as any,
      actor
    );

    expect(assertCourseClosingSendAllowed).toHaveBeenCalledTimes(2);
    expect(sendZaloZNSMessage).toHaveBeenCalledTimes(1);
    expect(db.jobItemAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-2',
        status: 'failed',
        errorCode: 'COURSE_CLOSING_STALE',
      })
    );
    expect(db.jobDocSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
      expect.anything()
    );
  });

  it.each([
    ['rank_achievement', 'rank'],
    ['tuition_notice', 'tuition'],
  ] as const)('creates an approved %s job from identifiers only', async (type, guardType) => {
    const db = createZaloBulkJobDbMock({
      recipients: [{ id: 'student-1', classId: 'class-1' }],
    });

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: { classId: 'class-1', type, items: [{ studentId: 'student-1' }] },
      } as any,
      responseMock(),
      db as any,
      actor
    );

    expect(assertCourseClosingSendAllowed).toHaveBeenCalledWith(db, {
      classId: 'class-1',
      studentId: 'student-1',
      type: guardType,
    });
    if (type === 'tuition_notice') {
      expect(sendTrackedNextCourseTuitionNotice).toHaveBeenCalled();
    } else {
      expect(sendZaloZNSMessage).toHaveBeenCalled();
    }
  });

  it('does not contact Zalo for an exempt item', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [{ id: 'student-1', classId: 'class-1' }],
    });
    vi.mocked(assertCourseClosingSendAllowed).mockRejectedValueOnce(
      new CourseClosingError(409, 'COURSE_CLOSING_STUDENT_EXEMPT', 'Student is exempt', {
        approvalValid: true,
      } as any)
    );

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }],
        },
      } as any,
      responseMock(),
      db as any,
      actor
    );

    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(db.jobItemAdd).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'COURSE_CLOSING_STUDENT_EXEMPT' })
    );
  });

  it('records an already-sent item without contacting Zalo', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [{ id: 'student-1', classId: 'class-1' }],
    });
    vi.mocked(assertCourseClosingSendAllowed).mockRejectedValueOnce(
      new CourseClosingAlreadySentError('evaluation', canonicalContext('student-1'))
    );

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }],
        },
      } as any,
      responseMock(),
      db as any,
      actor
    );

    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(db.jobItemAdd).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'student-1', status: 'already_sent' })
    );
  });

  it('rejects a tuition ledger owned by another student before the sender runs', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [{ id: 'student-1', classId: 'class-1' }],
      ledgers: {
        'ledger-1': { studentId: 'student-2', classId: 'class-1', amount: 1_000_000 },
      },
    });

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'tuition_notice',
          items: [{ studentId: 'student-1', ledgerId: 'ledger-1' }],
        },
      } as any,
      responseMock(),
      db as any,
      actor
    );

    expect(sendTrackedNextCourseTuitionNotice).not.toHaveBeenCalled();
    expect(db.jobItemAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        status: 'failed',
        error: expect.stringMatching(/outside the requested student and class/i),
      })
    );
  });

  it('keeps a partially failed Zalo batch out of completed status', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [
        { id: 'student-1', classId: 'class-1' },
        { id: 'student-2', classId: 'class-1' },
      ],
    });
    vi.mocked(sendZaloZNSMessage)
      .mockResolvedValueOnce({ success: true, messageId: 'message-1' })
      .mockResolvedValueOnce({ success: false, error: 'gateway unavailable' });
    const response = responseMock();

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }, { studentId: 'student-2' }],
        },
      } as any,
      response,
      db as any,
      actor
    );

    expect(response.body).toMatchObject({ successCount: 1, failureCount: 1 });
    expect(db.jobDocSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'partial_failure' }),
      { merge: true }
    );
    expect(db.jobDocSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
      expect.anything()
    );
    expect(touchRealtimeEvent).toHaveBeenCalledTimes(1);
  });

  it('touches course-closing after a successful bulk item', async () => {
    const db = createZaloBulkJobDbMock({
      recipients: [{ id: 'student-1', classId: 'class-1' }],
    });

    await handleBulkNotificationJob(
      {
        method: 'POST',
        body: {
          classId: 'class-1',
          type: 'evaluation',
          items: [{ studentId: 'student-1' }],
        },
      } as any,
      responseMock(),
      db as any,
      actor
    );

    expect(touchRealtimeEvent).toHaveBeenCalledWith('course-closing', { targetId: 'class-1' });
  });
});
