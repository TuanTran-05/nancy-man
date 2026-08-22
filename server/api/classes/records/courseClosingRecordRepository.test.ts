import { describe, expect, it, vi } from 'vitest';
import { COURSE_CLOSING_DOCX_MIME } from '../../../../shared/courseClosingRecords.js';
import { upsertEvaluationRecord, upsertTuitionRecord } from './courseClosingRecordRepository.js';

const identity = {
  courseId: 'course-1',
  classId: 'class-1',
  className: 'Class 1',
  courseStartDate: '2026-03-01',
  courseEndDate: '2026-07-01',
  closingMonth: '2026-07',
  studentId: 'student-1',
  studentName: 'Student 1',
  studentCode: 'S001',
  teacherId: 'teacher-1',
  teacherName: 'Teacher 1',
};

const oldEvaluationSnapshot: any = {
  evaluationId: 'evaluation-original',
  evaluationVersion: 'v1',
  evaluationDate: '2026-07-01',
  scores: { attendance: 80, effort: 80, pronunciation: 80, homework: 80, behavior: 80 },
  finalExamScore: 80,
  totalScore: 80,
  classification: 'good',
  positivePoints: [],
  improvementPoints: '',
};

const oldTuitionSnapshot: any = {
  noticeDate: '2026-07-01',
  amount: 2_000_000,
  paymentWindowStart: '2026-07-01',
  paymentDueDate: '2026-07-15',
  previousCourseStartDate: '2026-03-01',
  previousCourseEndDate: '2026-07-01',
  finalExamDate: '2026-07-01',
  finalExamScore: 80,
  nextCourseStartDate: '2026-07-15',
  nextCourseEndDate: '2026-11-15',
};

function makeExistingRecord() {
  return {
    ...identity,
    id: 'course-1__student-1',
    recordVersion: 1,
    classNameNormalized: 'class 1',
    studentNameNormalized: 'student 1',
    evaluationSnapshot: oldEvaluationSnapshot,
    tuitionSnapshot: oldTuitionSnapshot,
    evaluationDocument: {
      type: 'evaluation',
      status: 'ready',
      templateVersion: 1,
      mimeType: COURSE_CLOSING_DOCX_MIME,
      storagePath: 'evaluation.docx',
      sourceNotificationId: 'evaluation-notification-original',
      attempts: 1,
    },
    tuitionDocument: {
      type: 'tuition',
      status: 'ready',
      templateVersion: 1,
      mimeType: COURSE_CLOSING_DOCX_MIME,
      storagePath: 'tuition.docx',
      sourceNotificationId: 'tuition-notification-original',
      attempts: 1,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function makeDb(existing: any) {
  const txSet = vi.fn();
  const db: any = {
    collection: vi.fn(() => ({ doc: vi.fn(() => ({})) })),
    runTransaction: vi.fn(async (callback: any) =>
      callback({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => existing }),
        set: txSet,
      })
    ),
  };
  return { db, txSet };
}

describe('courseClosingRecordRepository immutable snapshots', () => {
  it('does not overwrite a ready evaluation snapshot or its source notification', async () => {
    const existing = makeExistingRecord();
    const { db, txSet } = makeDb(existing);

    const result = await upsertEvaluationRecord(db, {
      identity,
      snapshot: { ...oldEvaluationSnapshot, evaluationId: 'evaluation-new', totalScore: 99 },
      sourceNotificationId: 'evaluation-notification-new',
    });

    expect(result).toBe(existing);
    expect(result.evaluationSnapshot).toBe(oldEvaluationSnapshot);
    expect(result.evaluationDocument.sourceNotificationId).toBe('evaluation-notification-original');
    expect(txSet).not.toHaveBeenCalled();
  });

  it('does not overwrite a ready tuition snapshot or its source notification', async () => {
    const existing = makeExistingRecord();
    const { db, txSet } = makeDb(existing);

    const result = await upsertTuitionRecord(db, {
      identity,
      snapshot: { ...oldTuitionSnapshot, amount: 9_999_999 },
      sourceNotificationId: 'tuition-notification-new',
    });

    expect(result).toBe(existing);
    expect(result.tuitionSnapshot).toBe(oldTuitionSnapshot);
    expect(result.tuitionDocument.sourceNotificationId).toBe('tuition-notification-original');
    expect(txSet).not.toHaveBeenCalled();
  });

  it('marks an evaluation source as verified when it upserts a snapshot', async () => {
    const existing = {
      ...makeExistingRecord(),
      evaluationSnapshot: undefined,
      evaluationDataAvailability: {
        status: 'unavailable',
        reason: 'historical_source_missing',
        assessedAt: '2026-07-25T00:00:00.000Z',
      },
      evaluationDocument: {
        type: 'evaluation',
        status: 'not_requested',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 0,
      },
    };
    const { db, txSet } = makeDb(existing);

    const result = await upsertEvaluationRecord(db, {
      identity,
      snapshot: oldEvaluationSnapshot,
      sourceNotificationId: 'evaluation-notification-new',
    });

    expect(result.evaluationDataAvailability).toEqual({ status: 'verified' });
    expect(txSet).toHaveBeenCalledOnce();
  });

  it('marks a tuition source as verified when it upserts a snapshot', async () => {
    const existing = {
      ...makeExistingRecord(),
      tuitionSnapshot: undefined,
      tuitionDataAvailability: {
        status: 'unavailable',
        reason: 'historical_source_incomplete',
        assessedAt: '2026-07-25T00:00:00.000Z',
      },
      tuitionDocument: {
        type: 'tuition',
        status: 'not_requested',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 0,
      },
    };
    const { db, txSet } = makeDb(existing);

    const result = await upsertTuitionRecord(db, {
      identity,
      snapshot: oldTuitionSnapshot,
      sourceNotificationId: 'tuition-notification-new',
    });

    expect(result.tuitionDataAvailability).toEqual({ status: 'verified' });
    expect(txSet).toHaveBeenCalledOnce();
  });
});
