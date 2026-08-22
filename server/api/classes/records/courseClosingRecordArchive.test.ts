import { describe, expect, it, vi } from 'vitest';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../../../../shared/courseClosingRecords.js';
import {
  archiveEvaluationNotification,
  archiveTuitionNotification,
  ensureCourseClosingArchiveRepair,
  materializeCourseClosingDocument,
} from './courseClosingRecordArchive.js';

describe('courseClosingRecordArchive', () => {
  const identity = {
    courseId: 'course-1',
    classId: 'class-1',
    className: 'IELTS 6.0',
    courseStartDate: '2026-03-18',
    courseEndDate: '2026-07-18',
    closingMonth: '2026-07',
    studentId: 'student-1',
    studentName: 'Student 1',
    studentCode: 'S001',
    teacherId: 'teacher-1',
    teacherName: 'Teacher 1',
  };

  function makeInsertDb() {
    const writes: any[] = [];
    const ref = {};
    const db: any = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ref) })),
      runTransaction: vi.fn(async (callback: any) =>
        callback({
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn((_ref: any, data: any) => writes.push(data)),
        })
      ),
    };
    return { db, writes };
  }

  it('upserts one deterministic record and one deterministic job', async () => {
    const recordDocRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };

    const db: any = {
      collection: vi.fn((col: string) => {
        if (col === 'course_closing_records') {
          return { doc: vi.fn(() => recordDocRef) };
        }
        if (col === 'evaluations') {
          return {
            where: () => ({
              where: () => ({
                get: vi.fn().mockResolvedValue({ docs: [] }),
              }),
            }),
          };
        }
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ exists: false }),
            set: vi.fn().mockResolvedValue(undefined),
          })),
        };
      }),
      runTransaction: vi.fn(async (cb: any) => {
        const tx = {
          get: vi.fn(async (ref: any) => ref.get()),
          set: vi.fn(async (ref: any, data: any) => ref.set(data)),
          update: vi.fn(async (ref: any, data: any) => ref.update(data)),
        };
        return await cb(tx);
      }),
    };

    const input: any = {
      context: {
        courseId: 'course-1',
        classData: {
          id: 'class-1',
          name: 'IELTS 6.0',
          startDate: '2026-03-18',
          endDate: '2026-07-18',
        },
        studentData: {
          id: 'student-1',
          name: 'Nguyễn Văn An',
        },
        finalEvaluation: {
          id: 'eval-1',
          date: '2026-07-18',
          finalScore: 88,
          totalScore: 84,
          scores: {
            attendance: 95,
            effort: 80,
            pronunciation: 82,
            homework: 78,
            behavior: 90,
          },
          positivePoints: ['Phát âm tốt'],
          improvementPoints: 'Cần phản xạ nhanh hơn',
        },
        evaluationVersion: '2026-07-18T10:00:00.000Z',
      },
      actor: { uid: 'user-1', role: 'office', name: 'Office User' },
      sourceNotificationId: 'msg-123',
    };

    const createOutboxJob = vi.fn().mockResolvedValue('job-1');
    const materialize = vi.fn().mockResolvedValue(undefined);

    const result = await archiveEvaluationNotification(db, input, {
      createOutboxJob,
      materialize,
    });

    expect(result).toBe('ready');
    expect(db.collection).toHaveBeenCalledWith('course_closing_records');
    expect(createOutboxJob).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: 'materialize_course_closing_document',
        idempotencyKey: 'closing-record:course-1:student-1:evaluation:v1',
      }),
      // The job is enqueued as the archiving staff member, not as an
      // anonymous background writer.
      expect.objectContaining({
        actorId: 'user-1',
        operation: 'course-closing:archive-evaluation',
      })
    );
  });

  it('uploads to the deterministic private path and marks ready', async () => {
    const record: CourseClosingRecord = {
      id: 'course-1__student-1',
      recordVersion: 1,
      closingMonth: '2026-07',
      courseId: 'course-1',
      classId: 'class-1',
      className: 'IELTS 6.0',
      classNameNormalized: 'ielts 6.0',
      courseStartDate: '2026-03-18',
      courseEndDate: '2026-07-18',
      studentId: 'student-1',
      studentName: 'Nguyễn Văn An',
      studentNameNormalized: 'nguyen van an',
      studentCode: 'HV001',
      teacherId: 'teacher-1',
      teacherName: 'Trần Minh',
      evaluationSnapshot: {
        evaluationId: 'eval-1',
        evaluationVersion: '2026-07-18T10:00:00.000Z',
        evaluationDate: '2026-07-18',
        scores: { attendance: 95, effort: 80, pronunciation: 82, homework: 78, behavior: 90 },
        finalExamScore: 88,
        totalScore: 84,
        classification: 'good',
        positivePoints: ['Phát âm tốt'],
        improvementPoints: 'Cần phản xạ nhanh hơn',
      },
      evaluationDocument: {
        type: 'evaluation',
        status: 'pending',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 0,
      },
      tuitionDocument: {
        type: 'tuition',
        status: 'not_requested',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 0,
      },
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:00:00.000Z',
    };

    const recordRef = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => record }),
      update: vi.fn().mockResolvedValue(undefined),
    };

    const db: any = {
      collection: () => ({ doc: () => recordRef }),
      runTransaction: async (cb: any) => {
        const tx = {
          get: async () => recordRef.get(),
          update: async (_ref: any, data: any) => recordRef.update(data),
        };
        return await cb(tx);
      },
    };

    const save = vi.fn().mockResolvedValue(undefined);
    const render = vi.fn().mockResolvedValue(Buffer.from('docx-content'));

    await materializeCourseClosingDocument(
      db,
      { recordId: 'course-1__student-1', documentType: 'evaluation', templateVersion: 1 },
      { save, render }
    );

    expect(save).toHaveBeenCalledWith(
      'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
      expect.any(Buffer),
      expect.objectContaining({ contentType: COURSE_CLOSING_DOCX_MIME })
    );

    expect(recordRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        'evaluationDocument.status': 'ready',
      })
    );
  });

  it('keeps the successful notification independent from a render failure', async () => {
    const recordDocRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const db: any = {
      collection: (col: string) => {
        if (col === 'evaluations') {
          return {
            where: () => ({
              where: () => ({
                get: async () => ({ docs: [] }),
              }),
            }),
          };
        }
        return { doc: () => recordDocRef };
      },
      runTransaction: async (cb: any) =>
        cb({ get: async () => recordDocRef.get(), set: async () => {} }),
    };

    const input: any = {
      context: {
        courseId: 'course-1',
        classData: {
          id: 'class-1',
          name: 'Class 1',
          startDate: '2026-03-18',
          endDate: '2026-07-18',
        },
        studentData: { id: 'student-1', name: 'Student' },
        finalEvaluation: {
          id: 'eval-1',
          date: '2026-07-18',
          totalScore: 80,
          scores: { attendance: 80, effort: 80, pronunciation: 80, homework: 80, behavior: 80 },
          positivePoints: [],
          improvementPoints: '',
        },
        evaluationVersion: 'v1',
      },
      actor: { uid: 'u1' },
    };

    const createOutboxJob = vi.fn().mockResolvedValue('job-1');
    const materialize = vi.fn().mockRejectedValue(new Error('template unavailable'));

    const result = await archiveEvaluationNotification(db, input, { createOutboxJob, materialize });

    expect(result).toBe('pending');
    expect(createOutboxJob).toHaveBeenCalledTimes(1);
  });

  it('does not create an unrepairable job for an invalid legacy course end date', async () => {
    const db: any = {};
    const input: any = {
      context: {
        courseId: 'course-1',
        classData: { id: 'class-1', name: 'Class 1', endDate: 'invalid' },
        studentData: { id: 'student-1', name: 'Student' },
        finalEvaluation: { id: 'eval-1' },
      },
      actor: { uid: 'u1' },
    };

    const createOutboxJob = vi.fn();
    const result = await archiveEvaluationNotification(db, input, { createOutboxJob });

    expect(result).toBe('skipped');
    expect(createOutboxJob).not.toHaveBeenCalled();
  });

  it('archives the canonical finalEvaluationData with its selected evaluation id', async () => {
    const { db, writes } = makeInsertDb();
    const result = await archiveEvaluationNotification(
      db,
      {
        context: {
          courseId: 'course-1',
          classData: {},
          studentData: {},
          finalEvaluationData: {
            date: '2026-07-19',
            finalScore: 91,
            totalScore: 89,
            scores: {
              attendance: 90,
              effort: 91,
              pronunciation: 92,
              homework: 88,
              behavior: 87,
            },
            positivePoints: ['Clear pronunciation'],
            improvementPoints: 'Keep practicing',
          },
          evaluationId: 'evaluation-selected',
          evaluationVersion: 'version-selected',
        },
        actor: { uid: 'office-1', role: 'office' },
      } as any,
      {
        resolveIdentity: vi.fn().mockResolvedValue(identity),
        loadMidterm: vi.fn().mockResolvedValue(undefined),
        createOutboxJob: vi.fn().mockResolvedValue('job-1'),
        materialize: vi.fn().mockRejectedValue(new Error('leave pending')),
      }
    );

    expect(result).toBe('pending');
    expect(writes[0].evaluationSnapshot).toEqual(
      expect.objectContaining({
        evaluationId: 'evaluation-selected',
        evaluationVersion: 'version-selected',
        evaluationDate: '2026-07-19',
        finalExamScore: 91,
        totalScore: 89,
      })
    );
  });

  it('uses finalEvaluationData and exact sent tuition values for tuition snapshots', async () => {
    const { db, writes } = makeInsertDb();
    const result = await archiveTuitionNotification(
      db,
      {
        context: {
          courseId: 'course-1',
          classData: {},
          studentData: {},
          finalEvaluationData: {
            date: '2026-07-19',
            finalScore: 91,
            totalScore: 89,
          },
        },
        tuitionAmount: 2_750_000,
        paymentDueDate: '2026-08-03',
        actor: { uid: 'office-1', role: 'office' },
        ledgerId: 'ledger-actual',
      },
      {
        resolveIdentity: vi.fn().mockResolvedValue(identity),
        createOutboxJob: vi.fn().mockResolvedValue('job-1'),
        materialize: vi.fn().mockRejectedValue(new Error('leave pending')),
      }
    );

    expect(result).toBe('pending');
    expect(writes[0].tuitionSnapshot).toEqual(
      expect.objectContaining({
        amount: 2_750_000,
        paymentDueDate: '2026-08-03',
        finalExamDate: '2026-07-19',
        finalExamScore: 91,
        ledgerId: 'ledger-actual',
      })
    );
  });

  it('repairs an already-sent tuition archive from the persisted ledger values', async () => {
    const writes: any[] = [];
    const recordRef = {};
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'course_fee_ledgers') {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  amount: 3_100_000,
                  paymentDueDate: '2026-08-05',
                }),
              }),
            }),
          };
        }
        return { doc: () => recordRef };
      }),
      runTransaction: vi.fn(async (callback: any) =>
        callback({
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn((_ref: any, data: any) => writes.push(data)),
        })
      ),
    };

    await ensureCourseClosingArchiveRepair(
      db,
      {
        context: {
          courseId: 'course-1',
          classData: { tuitionFee: 999_000 },
          studentData: {},
          finalEvaluationData: { date: '2026-07-19', finalScore: 91 },
        },
        documentType: 'tuition',
        actor: { uid: 'office-1', role: 'office' },
        ledgerId: 'ledger-persisted',
      },
      {
        resolveIdentity: vi.fn().mockResolvedValue(identity),
        createOutboxJob: vi.fn().mockResolvedValue('job-1'),
        materialize: vi.fn().mockRejectedValue(new Error('leave pending')),
      }
    );

    expect(writes[0].tuitionSnapshot).toEqual(
      expect.objectContaining({
        amount: 3_100_000,
        paymentDueDate: '2026-08-05',
        ledgerId: 'ledger-persisted',
      })
    );
  });
});
