import { describe, expect, it, vi } from 'vitest';
import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';
import type { BackfillRunPlan } from './types.js';
import { applyCourseClosingBackfill, assertApplyConfirmation } from './writer.js';

const PROJECT_ID = 'gen-lang-client-0014842483';
const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';

function record(): CourseClosingRecord {
  return {
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
      evaluationId: 'evaluation-1',
      evaluationVersion: '2026-07-18T08:00:00.000Z',
      evaluationDate: '2026-07-18',
      scores: {
        attendance: 95,
        effort: 80,
        pronunciation: 82,
        homework: 78,
        behavior: 90,
      },
      finalExamScore: 88,
      totalScore: 84,
      classification: 'good',
      positivePoints: ['Phát âm tốt'],
      improvementPoints: 'Cần tăng tốc độ phản xạ',
    },
    evaluationDocument: {
      type: 'evaluation',
      status: 'pending',
      templateVersion: 1,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      attempts: 0,
    },
    tuitionDocument: {
      type: 'tuition',
      status: 'not_requested',
      templateVersion: 1,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      attempts: 0,
    },
    createdAt: '2026-07-25T09:00:00.000Z',
    updatedAt: '2026-07-25T09:00:00.000Z',
  };
}

function plan(): BackfillRunPlan {
  const candidate = record();
  return {
    generatedAt: candidate.updatedAt,
    summary: { create: 1, merge: 0, unchanged: 0, ambiguous: 0, skipped: 0 },
    items: [
      {
        recordId: candidate.id,
        classId: candidate.classId,
        className: candidate.className,
        courseId: candidate.courseId,
        studentId: candidate.studentId,
        studentCode: candidate.studentCode,
        studentName: candidate.studentName,
        decision: 'create',
        reasons: ['PLANNED_CREATE'],
        candidate,
        expectedExists: false,
      },
    ],
  };
}

function validConfirmation() {
  return {
    actualProjectId: PROJECT_ID,
    actualDatabaseId: DATABASE_ID,
    confirmProjectId: PROJECT_ID,
    confirmDatabaseId: DATABASE_ID,
    reviewedDigest: 'reviewed-digest',
  };
}

function makeDocumentStoreStub(
  existing?: CourseClosingRecord,
  existingVersion = '2026-07-25T08:00:00.000Z'
) {
  const set = vi.fn();
  const collection = vi.fn((name: string) => ({
    doc: (id: string) => ({ id, collection: name }),
  }));
  const runTransaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({
      get: vi.fn(async () => ({
        exists: Boolean(existing),
        data: () => existing,
        updateTime: {
          toDate: () => new Date(existingVersion),
        },
      })),
      set,
    })
  );
  return { collection, runTransaction, set };
}

describe('course-closing backfill writer', () => {
  it.each([
    ['wrong-project', DATABASE_ID],
    [PROJECT_ID, 'wrong-database'],
  ])(
    'rejects mismatched project or database confirmation',
    (confirmProjectId, confirmDatabaseId) => {
      expect(() =>
        assertApplyConfirmation({
          ...validConfirmation(),
          confirmProjectId,
          confirmDatabaseId,
        })
      ).toThrow('BACKFILL_TARGET_CONFIRMATION_MISMATCH');
    }
  );

  it('rejects apply without a reviewed source digest', () => {
    expect(() =>
      assertApplyConfirmation({
        ...validConfirmation(),
        reviewedDigest: '',
      })
    ).toThrow('BACKFILL_REVIEWED_DIGEST_REQUIRED');
  });

  it('creates a missing record only in course_closing_records', async () => {
    const db = makeDocumentStoreStub();

    const summary = await applyCourseClosingBackfill(db as never, plan(), validConfirmation());

    expect(summary).toEqual({
      created: 1,
      merged: 0,
      unchanged: 0,
      conflicted: 0,
    });
    expect(db.collection).toHaveBeenCalledWith('course_closing_records');
    expect(db.collection).not.toHaveBeenCalledWith('zalo_notifications');
    expect(db.collection).not.toHaveBeenCalledWith('outbox_jobs');
    expect(db.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        backfill: expect.objectContaining({
          version: 1,
          sourceDigest: 'reviewed-digest',
        }),
      }),
      { merge: true }
    );
  });

  it('does not overwrite a ready document that appeared after planning', async () => {
    const ready = record();
    ready.evaluationDocument = {
      ...ready.evaluationDocument,
      status: 'ready',
      storagePath: 'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
    };
    const db = makeDocumentStoreStub(ready);

    const summary = await applyCourseClosingBackfill(db as never, plan(), validConfirmation());

    expect(summary.conflicted).toBe(1);
    expect(db.set).not.toHaveBeenCalled();
  });

  it('treats a concurrently created record as a conflict', async () => {
    const db = makeDocumentStoreStub(record());

    const summary = await applyCourseClosingBackfill(db as never, plan(), validConfirmation());

    expect(summary).toEqual({
      created: 0,
      merged: 0,
      unchanged: 0,
      conflicted: 1,
    });
    expect(db.set).not.toHaveBeenCalled();
  });

  it('treats deletion or version change after a reviewed merge as a conflict', async () => {
    const mergePlan = plan();
    mergePlan.items[0].decision = 'merge';
    mergePlan.items[0].expectedExists = true;
    mergePlan.items[0].existingVersion = '2026-07-25T08:00:00.000Z';

    const deleted = makeDocumentStoreStub();
    const changed = makeDocumentStoreStub(record(), '2026-07-25T08:30:00.000Z');

    await expect(
      applyCourseClosingBackfill(deleted as never, mergePlan, validConfirmation())
    ).resolves.toMatchObject({ conflicted: 1 });
    await expect(
      applyCourseClosingBackfill(changed as never, mergePlan, validConfirmation())
    ).resolves.toMatchObject({ conflicted: 1 });
    expect(deleted.set).not.toHaveBeenCalled();
    expect(changed.set).not.toHaveBeenCalled();
  });
});
