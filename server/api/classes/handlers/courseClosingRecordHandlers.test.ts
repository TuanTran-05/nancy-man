import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../../../../shared/courseClosingRecords.js';

type StorageObjectState = {
  buffer: Buffer;
  metadata: {
    contentType?: string;
    metadata?: Record<string, string>;
  };
};

const handlerMocks = vi.hoisted(() => ({
  storageObjects: new Map<string, StorageObjectState>(),
  fileExists: vi.fn(),
  getMetadata: vi.fn(),
  download: vi.fn(),
  save: vi.fn(),
  getSignedUrl: vi.fn().mockResolvedValue('https://storage.test/file'),
  createOutboxJob: vi.fn().mockResolvedValue('repair-job'),
  completeOutboxJob: vi.fn().mockResolvedValue(undefined),
  materialize: vi.fn().mockResolvedValue(undefined),
  writeRequiredAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/storage/objectStore.js', () => ({
  getObjectStore: () => ({
    exists: (path: string) => handlerMocks.fileExists(path),
    stat: (path: string) => handlerMocks.getMetadata(path),
    download: (path: string) => handlerMocks.download(path),
    save: (path: string, buffer: Buffer, options: unknown) =>
      handlerMocks.save(path, buffer, options),
    createSignedReadUrl: (path: string, options: unknown) =>
      handlerMocks.getSignedUrl(path, options),
  }),
}));

vi.mock('../../lib/logging/auditLog.js', () => ({
  writeRequiredAuditLog: handlerMocks.writeRequiredAuditLog,
}));

vi.mock('../records/courseClosingRecordMaterializer.js', () => ({
  COURSE_CLOSING_DOCUMENT_GENERATOR_VERSION: '2',
  materializeCourseClosingDocument: handlerMocks.materialize,
}));

vi.mock('../../lib/jobs/outbox.js', () => ({
  createOutboxJob: handlerMocks.createOutboxJob,
  completeOutboxJob: handlerMocks.completeOutboxJob,
}));

import {
  handleCourseClosingRecordFile,
  handleCourseClosingRecordMonth,
  handleCourseClosingRecords,
} from './courseClosingRecordHandlers.js';

function responseRecorder() {
  const res: any = { statusCode: 200, headers: new Map<string, string>() };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.setHeader = vi.fn((name: string, value: string) => {
    res.headers.set(name.toLowerCase(), value);
    return res;
  });
  res.send = vi.fn((body: any) => {
    res.body = body;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res.body = body;
    return res;
  });
  return res;
}

const makeSampleRecord = (): CourseClosingRecord => ({
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
    evaluationVersion: 'v1',
    evaluationDate: '2026-07-18',
    scores: { attendance: 90, effort: 80, pronunciation: 80, homework: 80, behavior: 80 },
    finalExamScore: 85,
    totalScore: 84,
    classification: 'good',
    positivePoints: ['Tốt'],
    improvementPoints: 'Tốt',
  },
  tuitionSnapshot: {
    noticeDate: '2026-07-18',
    amount: 2400000,
    paymentWindowStart: '2026-07-18',
    paymentDueDate: '2026-08-01',
    previousCourseStartDate: '2026-03-18',
    previousCourseEndDate: '2026-07-18',
    finalExamDate: '2026-07-18',
    finalExamScore: 85,
    nextCourseStartDate: '2026-08-01',
    nextCourseEndDate: '2026-11-18',
  },
  evaluationDocument: {
    type: 'evaluation',
    status: 'ready',
    templateVersion: 1,
    storagePath: 'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
    downloadFilename: 'Nguyen_Van_An_Nhan_xet_ket_khoa.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    attempts: 1,
  },
  tuitionDocument: {
    type: 'tuition',
    status: 'ready',
    templateVersion: 1,
    storagePath: 'course_closing_records/2026-07/class-1/course-1/student-1/tuition-v1.docx',
    downloadFilename: 'Nguyen_Van_An_Thong_bao_hoc_phi.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    attempts: 1,
  },
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
});

const evaluationPath =
  'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx';
const tuitionPath = 'course_closing_records/2026-07/class-1/course-1/student-1/tuition-v1.docx';
const currentMetadata = {
  contentType: COURSE_CLOSING_DOCX_MIME,
  metadata: { courseClosingGeneratorVersion: '2' },
};

function seedStorageObject(
  path: string,
  buffer: Buffer,
  metadata: StorageObjectState['metadata'] = currentMetadata
) {
  handlerMocks.storageObjects.set(path, { buffer, metadata });
}

describe('courseClosingRecordHandlers', () => {
  beforeEach(() => {
    handlerMocks.storageObjects.clear();
    seedStorageObject(evaluationPath, Buffer.from('evaluation-docx'));
    seedStorageObject(tuitionPath, Buffer.from('tuition-docx'));

    handlerMocks.fileExists
      .mockReset()
      .mockImplementation(async (path: string) => handlerMocks.storageObjects.has(path));
    handlerMocks.getMetadata.mockReset().mockImplementation(async (path: string) => {
      const object = handlerMocks.storageObjects.get(path);
      if (!object) throw new Error(`Missing test Storage object: ${path}`);
      return [object.metadata];
    });
    handlerMocks.download.mockReset().mockImplementation(async (path: string) => {
      const object = handlerMocks.storageObjects.get(path);
      if (!object) throw new Error(`Missing test Storage object: ${path}`);
      return [object.buffer];
    });
    handlerMocks.save
      .mockReset()
      .mockImplementation(
        async (
          path: string,
          buffer: Buffer,
          options: { metadata: StorageObjectState['metadata'] }
        ) => {
          handlerMocks.storageObjects.set(path, { buffer, metadata: options.metadata });
        }
      );
    handlerMocks.getSignedUrl.mockReset().mockResolvedValue('https://storage.test/file');
    handlerMocks.materialize.mockReset().mockResolvedValue(undefined);
    handlerMocks.createOutboxJob.mockReset().mockResolvedValue('repair-job');
    handlerMocks.completeOutboxJob.mockReset().mockResolvedValue(undefined);
    handlerMocks.writeRequiredAuditLog.mockReset().mockResolvedValue(undefined);
  });

  it.each(['admin', 'office'])('returns both artifacts to %s', async (role) => {
    const res = responseRecorder();
    const req: any = { query: { month: '2026-07' } };
    const sample = makeSampleRecord();
    const db: any = {
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ docs: [{ id: sample.id, data: () => sample }] }),
          }),
        }),
      }),
    };
    const user: any = { uid: 'u1' };
    const userInfo: any = { uid: 'u1', role };

    await handleCourseClosingRecords(req, res, db, user, userInfo);

    expect(res.statusCode).toBe(200);
    expect(res.body.records[0].evaluationSnapshot).toBeDefined();
    expect(res.body.records[0].tuitionSnapshot).toBeDefined();
  });

  it('removes every evaluation field from accounting projection', async () => {
    const res = responseRecorder();
    const req: any = { query: { month: '2026-07' } };
    const sample = makeSampleRecord();
    const db: any = {
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ docs: [{ id: sample.id, data: () => sample }] }),
          }),
        }),
      }),
    };
    const user: any = { uid: 'u1' };
    const userInfo: any = { uid: 'u1', role: 'accounting' };

    await handleCourseClosingRecords(req, res, db, user, userInfo);

    expect(res.statusCode).toBe(200);
    const record = res.body.records[0];
    expect(record.evaluationSnapshot).toBeUndefined();
    expect(record.evaluationDocument).toBeUndefined();
    expect(record.tuitionSnapshot.amount).toBe(2400000);
    expect(record.displayStatus).toBe('ready');
    expect(record.displayStatus).not.toBe('missing_evaluation');
  });

  it('rejects accounting evaluation downloads even with a valid record id', async () => {
    const res = responseRecorder();
    const req: any = {
      query: {
        recordId: 'course-1__student-1',
        documentType: 'evaluation',
        mode: 'attachment',
      },
    };
    const db: any = {};
    const user: any = { uid: 'u1' };
    const userInfo: any = { uid: 'u1', role: 'accounting' };

    await handleCourseClosingRecordFile(req, res, db, user, userInfo);

    expect(res.statusCode).toBe(403);
  });

  it('rejects an unsupported file response mode', async () => {
    const res = responseRecorder();
    const req: any = {
      query: {
        recordId: 'course-1__student-1',
        documentType: 'tuition',
        mode: 'redirect',
      },
    };

    await handleCourseClosingRecordFile(req, res, {} as any, { uid: 'u1' }, {
      uid: 'u1',
      role: 'office',
    } as any);

    expect(res.statusCode).toBe(400);
  });

  it('does not regenerate when the stored DOCX is missing', async () => {
    handlerMocks.fileExists.mockResolvedValueOnce(false);
    const sample = makeSampleRecord();
    const db: any = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => sample }),
        }),
      }),
    };
    const res = responseRecorder();

    await handleCourseClosingRecordFile(
      {
        query: {
          recordId: sample.id,
          documentType: 'evaluation',
          mode: 'inline',
        },
      } as any,
      res,
      db,
      { uid: 'u1' },
      { uid: 'u1', role: 'office' } as any
    );

    expect(res.statusCode).toBe(409);
    expect(handlerMocks.materialize).not.toHaveBeenCalled();
    expect(handlerMocks.createOutboxJob).not.toHaveBeenCalled();
    expect(handlerMocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('serves the existing stored DOCX without checking generator metadata', async () => {
    handlerMocks.getMetadata
      .mockResolvedValueOnce([{ metadata: {} }])
      .mockResolvedValueOnce([{ metadata: { courseClosingGeneratorVersion: '2' } }]);
    const sample = makeSampleRecord();
    const db: any = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => sample }),
        }),
      }),
    };
    const res = responseRecorder();

    await handleCourseClosingRecordFile(
      {
        query: {
          recordId: sample.id,
          documentType: 'evaluation',
          mode: 'attachment',
        },
      } as any,
      res,
      db,
      { uid: 'u1' },
      { uid: 'u1', role: 'office' } as any
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe('https://storage.test/file');
    expect(handlerMocks.getMetadata).not.toHaveBeenCalled();
    expect(handlerMocks.materialize).not.toHaveBeenCalled();
    expect(handlerMocks.createOutboxJob).not.toHaveBeenCalled();
    expect(handlerMocks.getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('requires audit persistence before creating a signed URL', async () => {
    handlerMocks.fileExists.mockResolvedValueOnce(true);
    handlerMocks.writeRequiredAuditLog.mockRejectedValueOnce(
      Object.assign(new Error('audit unavailable'), { statusCode: 503 })
    );
    const sample = makeSampleRecord();
    const db: any = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => sample }),
        }),
      }),
    };

    await expect(
      handleCourseClosingRecordFile(
        {
          query: {
            recordId: sample.id,
            documentType: 'tuition',
            mode: 'attachment',
          },
        } as any,
        responseRecorder(),
        db,
        { uid: 'u1' },
        { uid: 'u1', role: 'office' } as any
      )
    ).rejects.toMatchObject({ statusCode: 503 });

    expect(handlerMocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'inline', responseDisposition: 'inline' },
    {
      mode: 'attachment',
      responseDisposition: 'attachment; filename="Nguyen_Van_An_Nhan_xet_ket_khoa.docx"',
    },
  ])(
    'returns the canonical evaluation DOCX signed URL in $mode mode',
    async ({ mode, responseDisposition }) => {
      const sample = makeSampleRecord();
      const db: any = {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => sample }),
          }),
        }),
      };
      const res = responseRecorder();

      await handleCourseClosingRecordFile(
        {
          query: {
            recordId: sample.id,
            documentType: 'evaluation',
            mode,
          },
        } as any,
        res,
        db,
        { uid: 'u1' },
        { uid: 'u1', role: 'office', name: 'Office User' } as any
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        url: 'https://storage.test/file',
        downloadFilename: 'Nguyen_Van_An_Nhan_xet_ket_khoa.docx',
      });
      expect(res.body.expiresAt).toEqual(expect.any(String));
      expect(handlerMocks.getSignedUrl).toHaveBeenCalledWith(
        evaluationPath,
        expect.objectContaining({
          expiresMs: 10 * 60 * 1000,
          responseDisposition,
        })
      );
      expect(handlerMocks.writeRequiredAuditLog).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          action: 'export',
          documentId: sample.id,
          metadata: {
            documentType: 'evaluation',
            mode,
            storagePath: evaluationPath,
          },
        })
      );
    }
  );
});
