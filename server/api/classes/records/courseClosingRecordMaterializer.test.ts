import { describe, expect, it, vi } from 'vitest';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../../../../shared/courseClosingRecords.js';
import { materializeCourseClosingDocument } from './courseClosingRecordMaterializer.js';

function makeReadyRecord(): CourseClosingRecord {
  return {
    id: 'course-1__student-1',
    recordVersion: 1,
    closingMonth: '2026-07',
    courseId: 'course-1',
    classId: 'class-1',
    className: 'Class 1',
    classNameNormalized: 'class 1',
    courseStartDate: '2026-03-01',
    courseEndDate: '2026-07-01',
    studentId: 'student-1',
    studentName: 'Student 1',
    studentNameNormalized: 'student 1',
    studentCode: 'S001',
    teacherId: 'teacher-1',
    teacherName: 'Teacher 1',
    evaluationSnapshot: {
      evaluationId: 'evaluation-1',
      evaluationVersion: 'v1',
      evaluationDate: '2026-07-01',
      scores: {
        attendance: 80,
        effort: 80,
        pronunciation: 80,
        homework: 80,
        behavior: 80,
      },
      finalExamScore: 80,
      totalScore: 80,
      classification: 'good',
      positivePoints: [],
      improvementPoints: '',
    },
    evaluationDocument: {
      type: 'evaluation',
      status: 'ready',
      templateVersion: 1,
      mimeType: COURSE_CLOSING_DOCX_MIME,
      storagePath: 'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
      attempts: 1,
    },
    tuitionDocument: {
      type: 'tuition',
      status: 'not_requested',
      templateVersion: 1,
      mimeType: COURSE_CLOSING_DOCX_MIME,
      attempts: 0,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function makeDb(record: CourseClosingRecord) {
  const ref = {
    update: vi.fn().mockResolvedValue(undefined),
  };
  const txUpdate = vi.fn();
  const db: any = {
    collection: vi.fn(() => ({ doc: vi.fn(() => ref) })),
    runTransaction: vi.fn(async (callback: any) =>
      callback({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => record }),
        update: txUpdate,
      })
    ),
  };
  return { db, ref, txUpdate };
}

describe('materializeCourseClosingDocument', () => {
  it('keeps a ready artifact idempotent during normal materialization', async () => {
    const { db, txUpdate } = makeDb(makeReadyRecord());
    const render = vi.fn();
    const save = vi.fn();

    await materializeCourseClosingDocument(
      db,
      { recordId: 'course-1__student-1', documentType: 'evaluation', templateVersion: 1 },
      { render, save }
    );

    expect(render).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('regenerates only the canonical DOCX when storage repair is forced', async () => {
    const { db, ref, txUpdate } = makeDb(makeReadyRecord());
    const render = vi.fn().mockResolvedValue(Buffer.from('repaired-docx'));
    const save = vi.fn().mockResolvedValue(undefined);

    await materializeCourseClosingDocument(
      db,
      {
        recordId: 'course-1__student-1',
        documentType: 'evaluation',
        templateVersion: 1,
        force: true,
      },
      { render, save }
    );

    expect(txUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'evaluationDocument.attempts': 2,
        'evaluationDocument.status': 'retrying',
      })
    );
    expect(render).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
      Buffer.from('repaired-docx'),
      {
        contentType: COURSE_CLOSING_DOCX_MIME,
        metadata: { courseClosingGeneratorVersion: '2' },
      }
    );
    const readyUpdate = vi.mocked(ref.update).mock.calls.at(-1)?.[0];
    expect(readyUpdate).not.toHaveProperty('evaluationDocument.previewStoragePath');
    expect(readyUpdate).toMatchObject({ 'evaluationDocument.status': 'ready' });
  });

  it('keeps the artifact retryable when canonical DOCX upload fails', async () => {
    const { db, ref } = makeDb(makeReadyRecord());

    await expect(
      materializeCourseClosingDocument(
        db,
        {
          recordId: 'course-1__student-1',
          documentType: 'evaluation',
          templateVersion: 1,
          force: true,
        },
        {
          render: vi.fn().mockResolvedValue(Buffer.from('docx')),
          save: vi.fn().mockRejectedValue(new Error('docx upload failed')),
        }
      )
    ).rejects.toThrow('docx upload failed');

    expect(ref.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ 'evaluationDocument.status': 'ready' })
    );
    expect(ref.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ 'evaluationDocument.status': 'retrying' })
    );
  });
});
