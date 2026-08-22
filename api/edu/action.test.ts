import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/edu/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { assertStudentInClass, getUserContext } from '../../server/api/lib/auth/authz.js';
import { getUserRoleAndName } from '../../server/api/lib/http/helpers.js';
import { enforceRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { validateBody } from '../../server/api/lib/validation/validations.js';
import { assertTeacherClassAccess } from '../../server/api/lib/services/classService.js';
import { commitWriteOperationsInChunks } from '../../server/api/lib/documentStore/batchWrites.js';
import { getUserRole } from '../../server/api/lib/services/userService.js';
import formidable from 'formidable';
import { parseAuthoringImportBuffer } from '../../server/api/lib/assignmentAuthoring/assignmentImport.js';
import { buildAuthoringImportTemplate } from '../../server/api/lib/assignmentAuthoring/assignmentImportTemplates.js';
import {
  createDocumentStoreTransactionHarness,
  makeDocumentStoreDocSnapshot,
} from '../../server/api/lib/documentStore/testDocumentStoreMocks.js';

const storageMocks = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue(undefined),
  createPersistentReadUrl: vi
    .fn()
    .mockResolvedValue('https://vps.thienuy.edu.vn/api/v1/files/read?signed=test'),
}));

vi.mock('../../server/api/lib/assignmentAuthoring/assignmentImportTemplates.js', () => ({
  buildAuthoringImportTemplate: vi.fn().mockResolvedValue({
    filename: 'assignment-import-template.csv',
    contentType: 'text/csv; charset=utf-8',
    buffer: Buffer.from('section,skill,responseMode,prompt'),
  }),
}));

vi.mock('../../server/api/lib/assignmentAuthoring/assignmentImport.js', () => ({
  parseAuthoringImportBuffer: vi.fn().mockResolvedValue({
    source: 'xlsx',
    filename: 'unit.xlsx',
    totalQuestions: 1,
    validQuestions: 1,
    warningCount: 0,
    errorCount: 0,
    sections: [
      {
        title: 'Listening',
        skill: 'listening',
        questions: [
          {
            skill: 'listening',
            responseMode: 'short_answer',
            prompt: 'Write the word.',
            media: [],
            acceptedAnswers: ['ticket'],
            gradingMode: 'manual',
            points: 1,
          },
        ],
      },
    ],
    issues: [],
  }),
}));

const genaiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    return {
      models: {
        generateContent: genaiMocks.generateContent,
      },
    };
  }),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../../server/api/lib/http/helpers.js', () => ({
  normalizeBody: vi.fn((body: unknown) => body || {}),
  getString: vi.fn((body: Record<string, unknown>, key: string) =>
    typeof body?.[key] === 'string' ? String(body[key]) : ''
  ),
  getOptionalString: vi.fn((body: Record<string, unknown>, key: string) =>
    typeof body?.[key] === 'string' ? String(body[key]) : undefined
  ),
  getUserRoleAndName: vi.fn().mockResolvedValue({ role: 'admin', name: 'Admin' }),
  sendApiError: vi.fn((res: any, err: any, fallback: string) =>
    res.status(err?.statusCode || 500).json({
      success: false,
      error: err?.message || fallback,
      ...(err?.errorCode ? { errorCode: err.errorCode } : {}),
      ...(err?.courseClosing ? { courseClosing: err.courseClosing } : {}),
    })
  ),
}));

vi.mock('../../server/api/lib/auth/authz.js', () => ({
  assertStudentInClass: vi.fn().mockResolvedValue({ name: 'Student A' }),
  getUserContext: vi.fn().mockResolvedValue({
    uid: 'student-uid',
    role: 'student',
    studentId: 'student-1',
    classId: 'class-1',
    isBlocked: false,
  }),
  assertActiveUser: vi.fn().mockReturnValue(undefined),
  assertClassAccess: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/validation/validations.js', () => ({
  createAssignmentSchema: {},
  submitAssignmentSchema: {},
  validateBody: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock('../../server/api/lib/services/classService.js', () => ({
  assertTeacherClassAccess: vi.fn().mockResolvedValue({ teacherId: 'teacher-uid' }),
}));

vi.mock('../../server/api/lib/documentStore/batchWrites.js', () => ({
  commitWriteOperationsInChunks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/services/userService.js', () => ({
  getUserRole: vi.fn().mockResolvedValue('admin'),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../server/api/lib/storage/objectStore.js', () => ({
  getObjectStore: () => storageMocks,
}));

vi.mock('formidable', () => ({
  default: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('mock data')),
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
  res.send = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end = vi.fn();
  return res;
}

function makeDoc(data: Record<string, unknown>, id = 'doc-1', exists = true) {
  const snapshot = makeDocumentStoreDocSnapshot({
    id,
    exists,
    data,
  });
  Object.assign(snapshot.ref, { delete: vi.fn().mockResolvedValue(undefined) });
  return snapshot;
}

function makeUploadedFile(overrides: Record<string, unknown> = {}) {
  return {
    filepath: 'C:\\tmp\\assignment-audio.mp3',
    originalFilename: 'dialogue.mp3',
    mimetype: 'audio/mpeg',
    size: 1024,
    ...overrides,
  };
}

function makeEduDb() {
  const transactionHarness = createDocumentStoreTransactionHarness();
  const quizAnswersCollection = {
    doc: vi.fn((id: string) => ({ id, path: `assignments/assignment-1/quiz_answers/${id}` })),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  };
  const assessmentQuestionKeysCollection = {
    doc: vi.fn((id: string) => ({
      id,
      path: `assignments/assignment-1/assessment_question_keys/${id}`,
    })),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  };
  const assignmentRef = {
    id: 'assignment-1',
    get: vi.fn().mockResolvedValue(
      makeDoc(
        {
          title: 'Old assignment',
          description: 'Old description',
          dueDate: '2026-05-20',
          classId: 'class-1',
          type: 'homework',
          teacherId: 'teacher-uid',
          questions: [],
          attemptsAllowed: 1,
        },
        'assignment-1'
      )
    ),
    update: vi.fn().mockResolvedValue(undefined),
    collection: vi.fn((name: string) =>
      name === 'assessment_question_keys' ? assessmentQuestionKeysCollection : quizAnswersCollection
    ),
  };
  const assignmentAdd = vi.fn().mockResolvedValue(assignmentRef);

  const evaluationRef = { id: 'evaluation-1' };
  const evaluationDoc = {
    id: 'evaluation-1',
    path: 'evaluations/evaluation-1',
    get: vi.fn().mockResolvedValue(
      makeDoc(
        {
          classId: 'class-1',
          studentId: 'student-1',
          teacherId: 'teacher-uid',
        },
        'evaluation-1'
      )
    ),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const evaluationAdd = vi.fn().mockResolvedValue(evaluationRef);

  const db = {
    runTransaction: transactionHarness.runTransaction,
    collection: vi.fn((name: string) => {
      if (name === 'assignments') {
        return {
          add: assignmentAdd,
          doc: vi.fn(() => assignmentRef),
        };
      }
      if (name === 'evaluations') {
        return {
          add: evaluationAdd,
          doc: vi.fn(() => evaluationDoc),
        };
      }
      const queryMock: any = {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })),
        where: vi.fn(() => queryMock),
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
      };
      return queryMock;
    }),
    // Identity resolution addresses documents by full path. Without this the
    // resolver fails with `db.doc is not a function`, which surfaces as a
    // rejected request rather than as a missing mock.
    doc: vi.fn((path: string) => {
      // A centre that is not in a maintenance window. The generic mock answers
      // `exists: true` with no fields, and the guard reads a state it cannot
      // parse as read-only — correctly, but for a reason no test here is about.
      if (path === '_maintenance/student_identity') {
        return {
          get: vi.fn().mockResolvedValue(
            makeDoc(
              {
                mode: 'normal',
                activeRunId: null,
                migrationActorId: null,
                updatedAt: '2026-08-10T00:00:00.000Z',
                updatedBy: 'seed',
              },
              'student_identity'
            )
          ),
        };
      }
      const separator = path.indexOf('/');
      const name = separator === -1 ? path : path.slice(0, separator);
      const id = separator === -1 ? '' : path.slice(separator + 1);
      return (db.collection as unknown as (n: string) => { doc: (i: string) => unknown }).call(
        db,
        name
      ).doc(id);
    }),
  };

  return {
    db,
    assignmentAdd,
    assignmentRef,
    evaluationAdd,
    evaluationDoc,
    assessmentQuestionKeysCollection,
    transactionWrites: transactionHarness.writes,
  };
}

const assignmentBody = {
  title: 'Quiz 1',
  description: 'Unit quiz',
  dueDate: '2026-05-31T10:30:00.000Z',
  classId: 'class-1',
  type: 'quiz',
  attemptsAllowed: 2,
  questions: [{ id: 'q1', prompt: 'Choose A', correct_answer: 'A' }],
};

const assessmentAssignmentData = {
  title: 'Listening quiz',
  description: 'Listen and answer.',
  dueDate: '2099-05-31T10:30:00.000Z',
  classId: 'class-1',
  type: 'quiz',
  teacherId: 'teacher-uid',
  questions: [],
  attemptsAllowed: 2,
  assessment: {
    version: 2,
    mode: 'practice',
    settings: {
      allowFreeMediaPlayback: true,
      showCorrectAnswersAfterSubmit: false,
      showTranscriptDuringAttempt: false,
    },
    sections: [
      {
        id: 'listening',
        title: 'Listening',
        skill: 'listening',
        questions: [
          {
            id: 'q1',
            skill: 'listening',
            prompt: 'Listen and choose.',
            responseMode: 'multiple_choice',
            media: [],
            options: [
              { key: 'A', text: 'A ticket' },
              { key: 'B', text: 'A book' },
            ],
            points: 2,
          },
        ],
      },
    ],
  },
};

const evaluationBody = {
  classId: 'class-1',
  studentId: 'student-1',
  evaluationType: 'midterm',
  scores: { speaking: 80 },
  totalScore: 80,
  positivePoints: ['Good pronunciation'],
  improvementPoints: 'Needs more vocabulary',
  finalScore: 80,
  rank: 'first',
  date: '2026-05-27',
};

describe('edu API migration routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.save.mockReset().mockResolvedValue(undefined);
    storageMocks.createPersistentReadUrl
      .mockReset()
      .mockResolvedValue('https://vps.thienuy.edu.vn/api/v1/files/read?signed=test');
    genaiMocks.generateContent.mockReset();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-uid',
      email: 't@example.com',
    } as any);
    vi.mocked(getUserRole).mockResolvedValue('admin');
    vi.mocked(verifyAuthContext).mockImplementation(async (req, res, requiredRoles) => {
      const decoded = await verifyAuthToken(req, res, requiredRoles);
      if (!decoded) return null;
      const role = await getUserRole(null as any, decoded.uid).catch(() => 'admin');
      const userInfo = await getUserRoleAndName(null as any, decoded.uid, decoded.email).catch(
        () => ({ role, name: 'Teacher User' })
      );
      return {
        decoded,
        context: {
          uid: decoded.uid,
          email: decoded.email,
          role: userInfo.role as any,
          name: userInfo.name || 'Teacher User',
          studentId: 'student-1',
          classId: 'class-1',
        },
      } as any;
    });
    vi.mocked(validateBody).mockReturnValue({ success: true } as any);
    vi.mocked(enforceRateLimit).mockResolvedValue(true);
    vi.mocked(assertTeacherClassAccess).mockResolvedValue({ teacherId: 'teacher-uid' } as any);
    vi.mocked(assertStudentInClass).mockResolvedValue({ name: 'Student A' } as any);
  });

  it('uploads assignment media and returns question media metadata', async () => {
    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          classId: ['class-1'],
          mediaType: ['audio'],
          title: ['Dialogue audio'],
          altText: ['Dialogue audio file'],
        },
        {
          file: [makeUploadedFile()],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-media-upload' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(assertTeacherClassAccess).toHaveBeenCalledWith(db, 'class-1', 'teacher-uid', 'admin');
    expect(storageMocks.save).toHaveBeenCalledWith(
      expect.stringContaining('assignment_media/class-1/teacher-uid/'),
      expect.any(Buffer),
      { contentType: 'audio/mpeg' }
    );
    expect(res.body).toMatchObject({
      success: true,
      media: {
        type: 'audio',
        source: 'upload',
        title: 'Dialogue audio',
        altText: 'Dialogue audio file',
        storagePath: expect.stringContaining('assignment_media/class-1/teacher-uid/'),
      },
    });
    expect(res.body.media.url).toContain('/api/v1/files/read');
  });

  it('rejects mismatched assignment media type uploads', async () => {
    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          classId: ['class-1'],
          mediaType: ['audio'],
        },
        {
          file: [makeUploadedFile({ originalFilename: 'picture.png', mimetype: 'image/png' })],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-media-upload' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Invalid audio file type');
  });

  it('allows students to upload speaking recordings and rejects non-students', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    // Mock active student context
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
      isBlocked: false,
    } as any);

    vi.mocked(verifyAuthToken).mockImplementation(async (req, res, requiredRoles) => {
      if (requiredRoles && requiredRoles.includes('student')) {
        return { uid: 'student-uid', email: 's@example.com' } as any;
      }
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return null;
    });

    const assignmentData = {
      title: 'Speaking Assignment',
      classId: 'class-1',
      type: 'quiz',
      assessment: {
        version: 2,
        sections: [
          {
            id: 's1',
            questions: [
              {
                id: 'q-speaking',
                responseMode: 'speaking_recording',
                points: 3,
              },
            ],
          },
        ],
      },
    };
    vi.mocked(assignmentRef.get).mockResolvedValue(makeDoc(assignmentData, 'assignment-1'));

    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          assignmentId: ['assignment-1'],
          questionId: ['q-speaking'],
          mediaType: ['audio'],
        },
        {
          file: [makeUploadedFile({ originalFilename: 'answer.webm', mimetype: 'audio/webm' })],
        },
      ]),
    } as any);

    const res1 = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-answer-media-upload' },
        headers: { authorization: 'Bearer token' },
      } as any,
      res1
    );

    expect(res1.statusCode).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.media.type).toBe('audio');
    expect(res1.body.media.storagePath).toContain(
      'assignment_answers/assignment-1/student-1/q-speaking/'
    );

    // Now test failure for non-student (teacher)
    vi.mocked(verifyAuthToken).mockImplementation(async (req, res, requiredRoles) => {
      if (requiredRoles && requiredRoles.includes('student')) {
        // Here we simulate the case where role in verifyAuthToken doesn't match
        res.status(403).json({ success: false, error: 'Insufficient permissions' });
        return null;
      }
      return { uid: 'teacher-uid', email: 't@example.com' } as any;
    });

    const res2 = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-answer-media-upload' },
        headers: { authorization: 'Bearer token' },
      } as any,
      res2
    );

    expect(res2.statusCode).toBe(403);
    expect(res2.body.success).toBe(false);
  });

  it('rejects answer media uploads for students outside the assignment delivery target', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
      isBlocked: false,
    } as any);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'student-uid',
      email: 's@example.com',
    } as any);

    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          title: 'Speaking Assignment',
          classId: 'class-1',
          type: 'quiz',
          deliveryPolicy: {
            targetMode: 'selected_students',
            assignedStudentIds: ['student-2'],
            availableFrom: '',
            resultReleasePolicy: 'after_submit',
          },
          assessment: {
            version: 2,
            sections: [
              {
                id: 's1',
                questions: [
                  {
                    id: 'q-speaking',
                    responseMode: 'speaking_recording',
                    points: 3,
                  },
                ],
              },
            ],
          },
        },
        'assignment-1'
      )
    );

    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          assignmentId: ['assignment-1'],
          questionId: ['q-speaking'],
          mediaType: ['audio'],
        },
        {
          file: [makeUploadedFile({ originalFilename: 'answer.webm', mimetype: 'audio/webm' })],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-answer-media-upload' },
        headers: { authorization: 'Bearer token' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Assignment is not available for this student',
    });
    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it('rejects answer media uploads after the assignment draft grace window', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
      isBlocked: false,
    } as any);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'student-uid',
      email: 's@example.com',
    } as any);

    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          title: 'Speaking Assignment',
          classId: 'class-1',
          type: 'quiz',
          dueDate: '2000-01-01T00:00:00.000Z',
          assessment: {
            version: 2,
            sections: [
              {
                id: 's1',
                questions: [
                  {
                    id: 'q-speaking',
                    responseMode: 'speaking_recording',
                    points: 3,
                  },
                ],
              },
            ],
          },
        },
        'assignment-1'
      )
    );

    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          assignmentId: ['assignment-1'],
          questionId: ['q-speaking'],
          mediaType: ['audio'],
        },
        {
          file: [makeUploadedFile({ originalFilename: 'answer.webm', mimetype: 'audio/webm' })],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-answer-media-upload' },
        headers: { authorization: 'Bearer token' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: 'Assignment is past due' });
    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it('rejects document uploads for speaking recording answers', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
      isBlocked: false,
    } as any);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'student-uid',
      email: 's@example.com',
    } as any);

    const assignmentData = {
      title: 'Speaking Assignment',
      classId: 'class-1',
      type: 'quiz',
      assessment: {
        version: 2,
        sections: [
          {
            id: 's1',
            questions: [
              {
                id: 'q-speaking',
                responseMode: 'speaking_recording',
                points: 3,
              },
            ],
          },
        ],
      },
    };
    vi.mocked(assignmentRef.get).mockResolvedValue(makeDoc(assignmentData, 'assignment-1'));

    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          assignmentId: ['assignment-1'],
          questionId: ['q-speaking'],
          mediaType: ['document'],
        },
        {
          file: [makeUploadedFile({ originalFilename: 'answer.pdf', mimetype: 'application/pdf' })],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-answer-media-upload' },
        headers: { authorization: 'Bearer token' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Speaking answers must be audio');
  });

  it('routes assignment-create through /api/v1/edu', async () => {
    const { db, assignmentAdd } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-create' },
        headers: {},
        body: assignmentBody,
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true, id: 'assignment-1' });
    expect(assignmentAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Quiz 1',
        classId: 'class-1',
        teacherId: 'teacher-uid',
        questions: [{ id: 'q1', prompt: 'Choose A' }],
      })
    );
    expect(commitWriteOperationsInChunks).toHaveBeenCalledWith(
      db,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'set',
          data: { correct_answer: 'A' },
        }),
      ])
    );
  });

  it('stores assessment v2 assignments with private question keys on create', async () => {
    const { db, assignmentAdd } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const assessmentBody = {
      ...assignmentBody,
      questions: [],
      assessment: {
        version: 2,
        mode: 'practice',
        sections: [
          {
            id: 'listening',
            title: 'Listening',
            skill: 'listening',
            questions: [
              {
                id: 'q1',
                skill: 'listening',
                prompt: 'What does the speaker want?',
                responseMode: 'multiple_choice',
                media: [
                  {
                    id: 'm1',
                    type: 'audio',
                    source: 'external_url',
                    url: 'https://cdn.example.com/q1.mp3',
                    transcript: 'Hidden transcript',
                    displayMode: 'hidden_until_review',
                  },
                ],
                options: [
                  { key: 'A', text: 'A ticket' },
                  { key: 'B', text: 'A book' },
                ],
                correctAnswer: 'B',
                acceptedAnswers: ['B'],
                gradingMode: 'auto',
                rubric: [{ id: 'choice', label: 'Correct choice', maxPoints: 1 }],
              },
            ],
          },
        ],
      },
    };

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-create' },
        headers: {},
        body: assessmentBody,
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(assignmentAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        assessment: expect.objectContaining({
          version: 2,
          settings: {
            allowFreeMediaPlayback: true,
            showCorrectAnswersAfterSubmit: false,
            showTranscriptDuringAttempt: false,
          },
          sections: [
            expect.objectContaining({
              id: 'listening',
              questions: [
                expect.not.objectContaining({
                  correctAnswer: expect.anything(),
                  acceptedAnswers: expect.anything(),
                  rubric: expect.anything(),
                }),
              ],
            }),
          ],
        }),
      })
    );
    expect(JSON.stringify(assignmentAdd.mock.calls[0][0].assessment)).not.toContain(
      'correctAnswer'
    );
    expect(JSON.stringify(assignmentAdd.mock.calls[0][0].assessment)).not.toContain(
      'acceptedAnswers'
    );
    expect(JSON.stringify(assignmentAdd.mock.calls[0][0].assessment)).not.toContain('rubric');
    expect(commitWriteOperationsInChunks).toHaveBeenCalledWith(
      db,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'set',
          ref: expect.objectContaining({
            path: 'assignments/assignment-1/assessment_question_keys/q1',
          }),
          data: {
            questionId: 'q1',
            correctAnswer: 'B',
            acceptedAnswers: ['B'],
            gradingMode: 'auto',
            rubric: [{ id: 'choice', label: 'Correct choice', maxPoints: 1 }],
          },
        }),
      ])
    );
  });

  it('defaults assignment-create to strict proctoring mode when omitted', async () => {
    const { db, assignmentAdd } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-create' },
        headers: {},
        body: { ...assignmentBody, proctoringMode: undefined },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(assignmentAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        proctoringMode: 'strict',
      })
    );
  });

  it('stores normal proctoring mode on assignment-create', async () => {
    const { db, assignmentAdd } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-create' },
        headers: {},
        body: { ...assignmentBody, proctoringMode: 'normal' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(assignmentAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        proctoringMode: 'normal',
      })
    );
  });

  it('persists delivery policy on assignment create', async () => {
    const { db, assignmentAdd, assignmentRef } = makeEduDb();
    const userQuery: any = {
      where: vi.fn((field: string, operator: string, value: string) => {
        userQuery.queryKey = `${field}:${operator}:${value}`;
        return userQuery;
      }),
      get: vi.fn(async () => {
        if (userQuery.queryKey === 'role:==:admin') {
          return { docs: [{ id: 'admin-1', data: () => ({ role: 'admin' }) }] };
        }
        // Linked accounts are no longer selected by their `classId`
        // projection; the enrollment below is what puts them in the class.
        return {
          docs: [
            {
              id: 'student:student-1',
              data: () => ({ role: 'student', classId: 'class-1', studentId: 'student-1' }),
            },
            {
              id: 'parent:student-1',
              data: () => ({ role: 'parent', classId: 'class-1', studentId: 'student-1' }),
            },
            {
              id: 'student:student-2',
              data: () => ({ role: 'student', classId: 'class-1', studentId: 'student-2' }),
            },
            {
              id: 'parent:student-2',
              data: () => ({ role: 'parent', classId: 'class-1', studentId: 'student-2' }),
            },
          ],
        };
      }),
    };
    // Honours the `studentId` filter. A query mock that returns every
    // enrollment whatever it was asked makes one student look like two open
    // enrollments, which is a data fault the roster refuses to guess through.
    const enrollmentDocs = ['student-1', 'student-2'].map((studentId) => ({
      id: `${studentId}__class-1__2026-07-01`,
      data: () => ({ studentId, classId: 'class-1', status: 'active', termStart: '2026-07-01' }),
    }));
    const makeEnrollmentQuery = (studentId?: string): any => ({
      where: vi.fn((field: string, _op: string, value: unknown) =>
        field === 'studentId' && typeof value === 'string'
          ? makeEnrollmentQuery(value)
          : makeEnrollmentQuery(studentId)
      ),
      get: vi.fn(async () => ({
        docs: studentId
          ? enrollmentDocs.filter((doc) => doc.data().studentId === studentId)
          : enrollmentDocs,
      })),
    });
    const enrollmentQuery = makeEnrollmentQuery();
    vi.mocked(db.collection).mockImplementation((name: string) => {
      if (name === 'assignments') {
        return {
          add: assignmentAdd,
          doc: vi.fn(() => assignmentRef),
        } as any;
      }
      if (name === 'student_course_enrollments') return enrollmentQuery;
      // No aliases in this fixture. The generic mock answers `exists: true`
      // for every document, which makes an empty object look like a malformed
      // alias and fails identity resolution for reasons the test is not about.
      if (name === 'student_profile_aliases') {
        const aliases: any = {
          doc: vi.fn((id: string) => ({
            get: vi.fn().mockResolvedValue(makeDoc({}, id, false)),
          })),
          where: vi.fn(() => aliases),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        };
        return aliases;
      }
      if (name === 'students') {
        const students: any = {
          doc: vi.fn((id: string) => ({
            get: vi.fn().mockResolvedValue(makeDoc({ classId: 'class-1' }, id)),
          })),
          where: vi.fn(() => students),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        };
        return students;
      }
      if (name === 'users') return userQuery;
      const genericMock: any = {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })),
        where: vi.fn(() => genericMock),
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
      };
      return genericMock;
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-create' },
        headers: {},
        body: {
          ...assignmentBody,
          deliveryPolicy: {
            targetMode: 'selected_students',
            assignedStudentIds: ['student-1'],
            availableFrom: '2026-06-12T10:00:00.000Z',
            resultReleasePolicy: 'after_due',
          },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(assignmentAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryPolicy: {
          targetMode: 'selected_students',
          assignedStudentIds: ['student-1'],
          availableFrom: '2026-06-12T10:00:00.000Z',
          resultReleasePolicy: 'after_due',
        },
      })
    );
  });

  it('rejects selected-student delivery policy ids outside the assignment class', async () => {
    const { db, assignmentAdd, assignmentRef } = makeEduDb();
    vi.mocked(db.collection).mockImplementation((name: string) => {
      if (name === 'assignments') {
        return {
          add: assignmentAdd,
          doc: vi.fn(() => assignmentRef),
        } as any;
      }
      if (name === 'students') {
        return {
          doc: vi.fn((id: string) => ({
            get: vi.fn().mockResolvedValue(makeDoc({ classId: 'class-2' }, id)),
          })),
        } as any;
      }
      const genericMock: any = {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })),
        where: vi.fn(() => genericMock),
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
      };
      return genericMock;
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-create' },
        headers: {},
        body: {
          ...assignmentBody,
          deliveryPolicy: {
            targetMode: 'selected_students',
            assignedStudentIds: ['student-2'],
            availableFrom: '',
            resultReleasePolicy: 'after_submit',
          },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Selected student is not in the assignment class');
    expect(assignmentAdd).not.toHaveBeenCalled();
  });

  it('routes assignment-update through /api/v1/edu', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'assignment-update' },
        headers: {},
        body: { ...assignmentBody, id: 'assignment-1', title: 'Quiz 1 updated' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, id: 'assignment-1' });
    expect(assignmentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Quiz 1 updated',
        classId: 'class-1',
        questions: [{ id: 'q1', prompt: 'Choose A' }],
      })
    );
  });

  it('replaces assessment v2 private keys on assignment-update', async () => {
    const { db, assignmentRef, assessmentQuestionKeysCollection } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const existingPrivateKeyDoc = {
      id: 'old-q',
      ref: { id: 'old-q', path: 'assignments/assignment-1/assessment_question_keys/old-q' },
    };
    vi.mocked(assessmentQuestionKeysCollection.get).mockResolvedValue({
      docs: [existingPrivateKeyDoc],
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'assignment-update' },
        headers: {},
        body: {
          ...assignmentBody,
          id: 'assignment-1',
          questions: [],
          assessment: {
            version: 2,
            mode: 'test',
            sections: [
              {
                id: 'reading',
                title: 'Reading',
                skill: 'reading',
                questions: [
                  {
                    id: 'q-reading-1',
                    skill: 'reading',
                    prompt: 'What is the main idea?',
                    responseMode: 'short_answer',
                    media: [
                      {
                        id: 'm-reading-1',
                        type: 'image',
                        source: 'upload',
                        url: 'https://vps.thienuy.edu.vn/api/v1/files/read?path=assignments%2Freading.png&signed=test',
                        storagePath: 'assignments/assignment-1/reading.png',
                      },
                    ],
                    acceptedAnswers: ['Travel is expensive'],
                    gradingMode: 'manual',
                    points: 2,
                  },
                ],
              },
            ],
          },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assignmentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        assessment: expect.objectContaining({
          version: 2,
          mode: 'test',
          sections: [
            expect.objectContaining({
              id: 'reading',
              questions: [
                expect.not.objectContaining({
                  acceptedAnswers: expect.anything(),
                  gradingMode: expect.anything(),
                }),
              ],
            }),
          ],
        }),
      })
    );
    expect(commitWriteOperationsInChunks).toHaveBeenCalledWith(
      db,
      expect.arrayContaining([
        {
          type: 'delete',
          ref: existingPrivateKeyDoc.ref,
        },
        expect.objectContaining({
          type: 'set',
          ref: expect.objectContaining({
            path: 'assignments/assignment-1/assessment_question_keys/q-reading-1',
          }),
          data: {
            questionId: 'q-reading-1',
            acceptedAnswers: ['Travel is expensive'],
            gradingMode: 'manual',
          },
        }),
      ])
    );
  });

  it('rejects invalid assessment v2 payloads on assignment-update', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'assignment-update' },
        headers: {},
        body: {
          ...assignmentBody,
          id: 'assignment-1',
          assessment: {
            version: 2,
            mode: 'practice',
            sections: [
              {
                id: 'listening',
                title: 'Listening',
                skill: 'listening',
                questions: [
                  {
                    id: 'q1',
                    skill: 'listening',
                    prompt: 'Listen and answer.',
                    responseMode: 'multiple_choice',
                    media: [
                      {
                        id: 'm1',
                        type: 'audio',
                        source: 'external_url',
                        url: 'http://cdn.example.com/q1.mp3',
                      },
                    ],
                    options: [
                      { key: 'A', text: 'A ticket' },
                      { key: 'B', text: 'A book' },
                    ],
                  },
                ],
              },
            ],
          },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('External assessment media URLs must use https');
    expect(assignmentRef.update).not.toHaveBeenCalled();
  });

  it('updates assignment proctoring mode through /api/v1/edu', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'assignment-update' },
        headers: {},
        body: { ...assignmentBody, id: 'assignment-1', proctoringMode: 'normal' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assignmentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        proctoringMode: 'normal',
      })
    );
  });

  it('rejects non-ISO assignment due dates on update', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'assignment-update' },
        headers: {},
        body: {
          ...assignmentBody,
          id: 'assignment-1',
          dueDate: '10:30:00 31/05/2026',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid datetime format' });
    expect(assignmentRef.update).not.toHaveBeenCalled();
  });

  it('soft-deletes an assignment and its submissions without hard-deleting private answer keys', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const submissionDoc = {
      id: 'submission-1',
      ref: { id: 'submission-1', path: 'submissions/submission-1' },
      data: () => ({ studentId: 'student-1', teacherId: 'teacher-uid' }),
    };
    const submissionsQuery: any = {
      where: vi.fn(() => submissionsQuery),
      get: vi.fn().mockResolvedValue({ docs: [submissionDoc], size: 1 }),
    };
    const usersQuery: any = {
      where: vi.fn(() => usersQuery),
      get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
    };
    vi.mocked(db.collection).mockImplementation((name: string) => {
      if (name === 'assignments') {
        return { doc: vi.fn(() => assignmentRef) } as any;
      }
      if (name === 'submissions') return submissionsQuery;
      if (name === 'users') return usersQuery;
      // `where` chains: the enrollment query behind an assignment audience is
      // `classId` then `status`.
      const chainable: any = {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })),
        where: vi.fn(() => chainable),
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
      };
      return chainable;
    });

    const res = mockRes();
    await handler(
      {
        method: 'DELETE',
        query: { action: 'assignment-delete' },
        headers: {},
        body: { id: 'assignment-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assignmentRef.collection).not.toHaveBeenCalled();
    expect(commitWriteOperationsInChunks).toHaveBeenCalledWith(
      db,
      expect.arrayContaining([
        {
          type: 'update',
          ref: assignmentRef,
          data: expect.objectContaining({
            isDeleted: true,
            deletedBy: 'teacher-uid',
            deletionReason: 'Deleted by staff',
          }),
        },
        {
          type: 'update',
          ref: submissionDoc.ref,
          data: expect.objectContaining({
            isDeleted: true,
            deletedBy: 'teacher-uid',
            deletedByAssignmentId: 'assignment-1',
          }),
        },
      ])
    );
    expect(res.body).toEqual({ success: true, id: 'assignment-1', deletedSubmissions: 1 });
  });

  it('routes evaluation-create through /api/v1/edu', async () => {
    const { db, transactionWrites } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'evaluation-create' },
        headers: {},
        body: evaluationBody,
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true, id: 'evaluation-1' });
    expect(transactionWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'set',
          data: expect.objectContaining({
            studentId: 'student-1',
            classId: 'class-1',
            teacherId: 'teacher-uid',
            totalScore: 80,
            rank: 'first',
          }),
        }),
      ])
    );
  });

  it('reuses verified auth context for evaluation mutations without an extra user role read', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'teacher-1', email: 'teacher@example.com' } as any,
      context: {
        uid: 'teacher-1',
        email: 'teacher@example.com',
        role: 'teacher',
        name: 'Teacher One',
      },
    });
    vi.mocked(getUserRole).mockClear();

    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'evaluation-create' },
        body: {
          classId: 'class-1',
          studentId: 'student-1',
          evaluationType: 'midterm',
          score: 8,
          date: '2026-06-12',
        },
        headers: { authorization: 'Bearer token' },
      } as any,
      res as any
    );

    expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'teacher']);
    expect(getUserRole).not.toHaveBeenCalled();
  });

  it('routes evaluation-update through /api/v1/edu', async () => {
    const { db, transactionWrites } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'evaluation-update' },
        headers: {},
        body: { ...evaluationBody, id: 'evaluation-1', totalScore: 88, scores: { speaking: 88 } },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, id: 'evaluation-1' });
    expect(transactionWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'update',
          data: expect.objectContaining({
            studentId: 'student-1',
            classId: 'class-1',
            teacherId: 'teacher-uid',
            totalScore: 88,
            rank: 'first',
          }),
        }),
      ])
    );
  });

  it('normalizes invalid evaluation ranks to none', async () => {
    const { db, transactionWrites } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'evaluation-create' },
        headers: {},
        body: { ...evaluationBody, rank: 'gold' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(transactionWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'set',
          data: expect.objectContaining({ rank: 'none' }),
        }),
      ])
    );
  });

  it('uses Gemini 3.5 Flash by default for AI evaluation generation', async () => {
    const previousApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    genaiMocks.generateContent.mockResolvedValue({
      text: '{"positivePoints":"Good progress","improvementPoints":"Practice speaking"}',
    });

    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    try {
      await handler(
        {
          method: 'POST',
          query: { action: 'evaluation-generate-ai' },
          headers: {},
          body: { prompt: 'Write feedback', model: 'gemini-2.5-flash' },
        } as any,
        res
      );
    } finally {
      if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousApiKey;
    }

    expect(res.statusCode).toBe(200);
    expect(genaiMocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.5-flash',
        contents: 'Write feedback',
      })
    );
  });

  it('allows the latest stable Flash-Lite model for AI evaluation generation', async () => {
    const previousApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    genaiMocks.generateContent.mockResolvedValue({
      text: '{"positivePoints":"Good progress","improvementPoints":"Practice speaking"}',
    });

    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    try {
      await handler(
        {
          method: 'POST',
          query: { action: 'evaluation-generate-ai' },
          headers: {},
          body: { prompt: 'Write feedback', model: 'gemini-3.1-flash-lite' },
        } as any,
        res
      );
    } finally {
      if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousApiKey;
    }

    expect(res.statusCode).toBe(200);
    expect(genaiMocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-lite',
        contents: 'Write feedback',
      })
    );
  });

  it('stores and auto-scores Assessment v2 multiple-choice submissions', async () => {
    const { db, assignmentRef, assessmentQuestionKeysCollection } = makeEduDb();
    const submissionCreate = vi.fn();
    const submissionRef = { id: 'submission-1' };
    const tx = {
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      create: submissionCreate,
      delete: vi.fn(),
    };
    (db as any).runTransaction = vi.fn(async (callback: any) => callback(tx));
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(assessmentAssignmentData, 'assignment-1')
    );
    vi.mocked(assessmentQuestionKeysCollection.get).mockResolvedValue({
      docs: [
        {
          id: 'q1',
          data: () => ({ questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' }),
        },
      ],
    } as any);
    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'users')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(
                makeDoc(
                  { studentId: 'student-1', classId: 'class-1', role: 'student' },
                  'student-uid'
                )
              ),
          })),
          where: vi.fn((field: string, _op: string, _val: string) => ({
            get: vi.fn().mockResolvedValue({
              docs:
                field === 'role'
                  ? [{ id: 'student-uid', data: () => ({ role: 'student' }) }]
                  : [{ id: 'student-uid', data: () => ({ role: 'student' }) }],
            }),
          })),
        };
      if (name === 'submissions')
        return {
          doc: vi.fn(() => submissionRef),
          where: vi.fn(() => ({
            where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn() })) })),
          })),
        };
      if (name === 'assignment_attempt_drafts') return { doc: vi.fn(() => ({ delete: vi.fn() })) };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-submit' },
        headers: {},
        body: {
          assignmentId: 'assignment-1',
          assessmentAnswers: [
            { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
          ],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(submissionCreate).toHaveBeenCalledWith(
      submissionRef,
      expect.objectContaining({
        assessmentAnswers: [
          { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
        ],
        assessmentScore: {
          totalPoints: 2,
          maxPoints: 2,
          questionScores: [
            {
              questionId: 'q1',
              pointsAwarded: 2,
              maxPoints: 2,
              gradingMode: 'auto',
            },
          ],
        },
        grade: 10,
        status: 'graded',
      })
    );
  });

  it('rejects submissions before assignment availableFrom', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          ...assessmentAssignmentData,
          deliveryPolicy: {
            targetMode: 'class',
            assignedStudentIds: [],
            availableFrom: '2999-01-01T00:00:00.000Z',
            resultReleasePolicy: 'manual',
          },
        },
        'assignment-1'
      )
    );

    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'users')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(
                makeDoc(
                  { studentId: 'student-1', classId: 'class-1', role: 'student' },
                  'student-uid'
                )
              ),
          })),
        };
      return {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })),
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
      };
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-submit' },
        headers: {},
        body: { assignmentId: 'assignment-1', assessmentAnswers: [] },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('Assignment is not available');
  });

  it('keeps Assessment v2 submissions pending when short answers require manual grading', async () => {
    const { db, assignmentRef, assessmentQuestionKeysCollection } = makeEduDb();
    const submissionCreate = vi.fn();
    const submissionRef = { id: 'submission-1' };
    const tx = {
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      create: submissionCreate,
      delete: vi.fn(),
    };
    (db as any).runTransaction = vi.fn(async (callback: any) => callback(tx));
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          ...assessmentAssignmentData,
          assessment: {
            ...assessmentAssignmentData.assessment,
            sections: [
              {
                ...assessmentAssignmentData.assessment.sections[0],
                questions: [
                  {
                    id: 'q2',
                    skill: 'reading',
                    prompt: 'Write one word.',
                    responseMode: 'short_answer',
                    media: [],
                    points: 3,
                  },
                ],
              },
            ],
          },
        },
        'assignment-1'
      )
    );
    vi.mocked(assessmentQuestionKeysCollection.get).mockResolvedValue({
      docs: [
        {
          id: 'q2',
          data: () => ({ questionId: 'q2', acceptedAnswers: ['station'], gradingMode: 'manual' }),
        },
      ],
    } as any);
    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'users')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(
                makeDoc(
                  { studentId: 'student-1', classId: 'class-1', role: 'student' },
                  'student-uid'
                )
              ),
          })),
          where: vi.fn((field: string, _op: string, _val: string) => ({
            get: vi.fn().mockResolvedValue({
              docs:
                field === 'role'
                  ? [{ id: 'student-uid', data: () => ({ role: 'student' }) }]
                  : [{ id: 'student-uid', data: () => ({ role: 'student' }) }],
            }),
          })),
        };
      if (name === 'submissions')
        return {
          doc: vi.fn(() => submissionRef),
          where: vi.fn(() => ({
            where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn() })) })),
          })),
        };
      if (name === 'assignment_attempt_drafts') return { doc: vi.fn(() => ({ delete: vi.fn() })) };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-submit' },
        headers: {},
        body: {
          assignmentId: 'assignment-1',
          assessmentAnswers: [
            { questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' },
          ],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(submissionCreate).toHaveBeenCalledWith(
      submissionRef,
      expect.objectContaining({
        assessmentAnswers: [
          { questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' },
        ],
        assessmentScore: {
          totalPoints: 0,
          maxPoints: 3,
          questionScores: [
            {
              questionId: 'q2',
              pointsAwarded: 0,
              maxPoints: 3,
              gradingMode: 'manual',
            },
          ],
        },
        grade: null,
        status: 'submitted',
      })
    );
  });

  describe('get-quiz-answers action', () => {
    it('returns quiz answers for teachers/admins without checks', async () => {
      const { db, assignmentRef } = makeEduDb();
      vi.mocked(assignmentRef.get).mockResolvedValue(
        makeDoc(
          {
            type: 'quiz',
            classId: 'class-1',
            dueDate: '2026-12-31',
            attemptsAllowed: 1,
          },
          'assignment-1'
        )
      );
      const mockAnswers = [
        { id: 'q1', data: () => ({ correct_answer: 'A' }) },
        { id: 'q2', data: () => ({ correct_answer: 'B' }) },
      ];
      vi.mocked(assignmentRef.collection).mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: mockAnswers }),
      } as any);

      vi.mocked(getUserContext).mockResolvedValue({
        uid: 'teacher-uid',
        role: 'teacher',
        isBlocked: false,
      } as any);

      vi.mocked(getDb).mockReturnValue(db as any);

      const res = mockRes();
      await handler(
        {
          method: 'GET',
          query: { action: 'get-quiz-answers', assignmentId: 'assignment-1' },
          headers: {},
        } as any,
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { q1: 'A', q2: 'B' },
      });
    });

    it('returns quiz answers for students if due date has passed', async () => {
      const { db, assignmentRef } = makeEduDb();
      vi.mocked(assignmentRef.get).mockResolvedValue(
        makeDoc(
          {
            type: 'quiz',
            classId: 'class-1',
            dueDate: '2026-01-01',
            attemptsAllowed: 1,
          },
          'assignment-1'
        )
      );
      const mockAnswers = [{ id: 'q1', data: () => ({ correct_answer: 'A' }) }];
      vi.mocked(assignmentRef.collection).mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: mockAnswers }),
      } as any);

      vi.mocked(getUserContext).mockResolvedValue({
        uid: 'student-uid',
        role: 'student',
        studentId: 'student-1',
        classId: 'class-1',
        isBlocked: false,
      } as any);

      vi.mocked(getDb).mockReturnValue(db as any);

      const res = mockRes();
      await handler(
        {
          method: 'GET',
          query: { action: 'get-quiz-answers', assignmentId: 'assignment-1' },
          headers: {},
        } as any,
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { q1: 'A' },
      });
    });

    it('returns quiz answers after submit when release policy is after_submit', async () => {
      const { db, assignmentRef } = makeEduDb();
      vi.mocked(assignmentRef.get).mockResolvedValue(
        makeDoc(
          {
            type: 'quiz',
            classId: 'class-1',
            dueDate: '2099-12-31T10:00:00.000Z',
            attemptsAllowed: 2,
            deliveryPolicy: {
              targetMode: 'class',
              assignedStudentIds: [],
              availableFrom: '',
              resultReleasePolicy: 'after_submit',
            },
          },
          'assignment-1'
        )
      );
      const mockAnswers = [{ id: 'q1', data: () => ({ correct_answer: 'A' }) }];
      vi.mocked(assignmentRef.collection).mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: mockAnswers }),
      } as any);

      const submissionsMock = { docs: [makeDoc({ studentId: 'student-1' }, 'sub-1')], size: 1 };
      const mockDb = {
        ...db,
        collection: vi.fn((name: string) => {
          if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
          if (name === 'submissions') {
            const queryMock: any = {
              where: vi.fn(() => queryMock),
              get: vi.fn().mockResolvedValue(submissionsMock),
            };
            return queryMock;
          }
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })) };
        }),
      };

      vi.mocked(getUserContext).mockResolvedValue({
        uid: 'student-uid',
        role: 'student',
        studentId: 'student-1',
        classId: 'class-1',
        isBlocked: false,
      } as any);
      vi.mocked(getDb).mockReturnValue(mockDb as any);

      const res = mockRes();
      await handler(
        {
          method: 'GET',
          query: { action: 'get-quiz-answers', assignmentId: 'assignment-1' },
          headers: {},
        } as any,
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({ q1: 'A' });
    });

    it('denies quiz answers for manual release even after due date and submission', async () => {
      const { db, assignmentRef } = makeEduDb();
      vi.mocked(assignmentRef.get).mockResolvedValue(
        makeDoc(
          {
            type: 'quiz',
            classId: 'class-1',
            dueDate: '2026-01-01T10:00:00.000Z',
            attemptsAllowed: 1,
            deliveryPolicy: {
              targetMode: 'class',
              assignedStudentIds: [],
              availableFrom: '',
              resultReleasePolicy: 'manual',
            },
          },
          'assignment-1'
        )
      );

      const mockDb = {
        ...db,
        collection: vi.fn((name: string) => {
          if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
          if (name === 'submissions') {
            const queryMock: any = {
              where: vi.fn(() => queryMock),
              get: vi.fn().mockResolvedValue({ docs: [makeDoc({}, 'sub-1')], size: 1 }),
            };
            return queryMock;
          }
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })) };
        }),
      };

      vi.mocked(getUserContext).mockResolvedValue({
        uid: 'student-uid',
        role: 'student',
        studentId: 'student-1',
        classId: 'class-1',
        isBlocked: false,
      } as any);
      vi.mocked(getDb).mockReturnValue(mockDb as any);

      const res = mockRes();
      await handler(
        {
          method: 'GET',
          query: { action: 'get-quiz-answers', assignmentId: 'assignment-1' },
          headers: {},
        } as any,
        res
      );

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toContain('Quiz answers are not available yet');
    });

    it('denies quiz answers for students outside selected-student targeting', async () => {
      const { db, assignmentRef } = makeEduDb();
      vi.mocked(assignmentRef.get).mockResolvedValue(
        makeDoc(
          {
            type: 'quiz',
            classId: 'class-1',
            dueDate: '2026-01-01T10:00:00.000Z',
            attemptsAllowed: 1,
            deliveryPolicy: {
              targetMode: 'selected_students',
              assignedStudentIds: ['student-2'],
              availableFrom: '',
              resultReleasePolicy: 'after_due',
            },
          },
          'assignment-1'
        )
      );

      const mockDb = {
        ...db,
        collection: vi.fn((name: string) => {
          if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
          if (name === 'submissions') {
            const queryMock: any = {
              where: vi.fn(() => queryMock),
              get: vi.fn().mockResolvedValue({ docs: [makeDoc({}, 'sub-1')], size: 1 }),
            };
            return queryMock;
          }
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })) };
        }),
      };

      vi.mocked(getUserContext).mockResolvedValue({
        uid: 'student-uid',
        role: 'student',
        studentId: 'student-1',
        classId: 'class-1',
        isBlocked: false,
      } as any);
      vi.mocked(getDb).mockReturnValue(mockDb as any);

      const res = mockRes();
      await handler(
        {
          method: 'GET',
          query: { action: 'get-quiz-answers', assignmentId: 'assignment-1' },
          headers: {},
        } as any,
        res
      );

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toContain('Assignment is not available');
    });

    it('denies quiz answers for students if due date not passed and attempts not exceeded', async () => {
      const { db, assignmentRef } = makeEduDb();
      vi.mocked(assignmentRef.get).mockResolvedValue(
        makeDoc(
          {
            type: 'quiz',
            classId: 'class-1',
            dueDate: '2026-12-31',
            attemptsAllowed: 1,
          },
          'assignment-1'
        )
      );

      const submissionsMock = {
        size: 0,
      };

      const mockDb = {
        ...db,
        collection: vi.fn((name: string) => {
          if (name === 'assignments') {
            return {
              doc: vi.fn(() => assignmentRef),
            };
          }
          if (name === 'submissions') {
            return {
              where: vi.fn(() => ({
                where: vi.fn(() => ({
                  get: vi.fn().mockResolvedValue(submissionsMock),
                })),
              })),
            };
          }
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })),
          };
        }),
      };

      vi.mocked(getUserContext).mockResolvedValue({
        uid: 'student-uid',
        role: 'student',
        studentId: 'student-1',
        classId: 'class-1',
        isBlocked: false,
      } as any);

      vi.mocked(getDb).mockReturnValue(mockDb as any);

      const res = mockRes();
      await handler(
        {
          method: 'GET',
          query: { action: 'get-quiz-answers', assignmentId: 'assignment-1' },
          headers: {},
        } as any,
        res
      );

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('answers are not available yet');
    });
  });

  it('grades Assessment v2 submissions with per-question scores', async () => {
    const { db, assignmentRef } = makeEduDb();
    const submissionUpdate = vi.fn();
    const submissionRef = {
      get: vi.fn().mockResolvedValue(
        makeDoc(
          {
            assignmentId: 'assignment-1',
            studentId: 'student-1',
            teacherId: 'teacher-1',
            classId: 'class-1',
            assessmentScore: {
              totalPoints: 0,
              maxPoints: 3,
              questionScores: [
                { questionId: 'q2', pointsAwarded: 0, maxPoints: 3, gradingMode: 'manual' },
              ],
            },
          },
          'submission-1'
        )
      ),
      update: submissionUpdate,
    };

    const customAssignment = {
      ...assessmentAssignmentData,
      assessment: {
        ...assessmentAssignmentData.assessment,
        sections: [
          {
            ...assessmentAssignmentData.assessment.sections[0],
            questions: [
              {
                id: 'q2',
                skill: 'writing',
                prompt: 'Explain.',
                responseMode: 'short_answer',
                media: [],
                points: 3,
              },
            ],
          },
        ],
      },
    };
    vi.mocked(assignmentRef.get).mockResolvedValue(makeDoc(customAssignment, 'assignment-1'));
    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'submissions') return { doc: vi.fn(() => submissionRef) };
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'users')
        return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-grade' },
        headers: {},
        body: {
          submissionId: 'submission-1',
          feedback: 'Reviewed carefully',
          assessmentQuestionScores: [
            { questionId: 'q2', pointsAwarded: 2.5, feedback: 'Clear answer' },
          ],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(submissionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback: 'Reviewed carefully',
        status: 'graded',
        grade: 8.3,
        assessmentScore: expect.objectContaining({
          totalPoints: 2.5,
          maxPoints: 3,
        }),
      })
    );
  });

  it('rejects Assessment v2 grading payloads above max question points', async () => {
    const { db, assignmentRef } = makeEduDb();
    const submissionRef = {
      get: vi.fn().mockResolvedValue(
        makeDoc(
          {
            assignmentId: 'assignment-1',
            studentId: 'student-1',
            teacherId: 'teacher-1',
            classId: 'class-1',
          },
          'submission-1'
        )
      ),
      update: vi.fn(),
    };
    const customAssignment = {
      ...assessmentAssignmentData,
      assessment: {
        ...assessmentAssignmentData.assessment,
        sections: [
          {
            ...assessmentAssignmentData.assessment.sections[0],
            questions: [
              {
                id: 'q2',
                skill: 'writing',
                prompt: 'Explain.',
                responseMode: 'short_answer',
                media: [],
                points: 3,
              },
            ],
          },
        ],
      },
    };
    vi.mocked(assignmentRef.get).mockResolvedValue(makeDoc(customAssignment, 'assignment-1'));
    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'submissions') return { doc: vi.fn(() => submissionRef) };
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-grade' },
        headers: {},
        body: {
          submissionId: 'submission-1',
          assessmentQuestionScores: [{ questionId: 'q2', pointsAwarded: 99 }],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Invalid points for question');
  });

  it('returns private Assessment v2 question keys to teachers', async () => {
    const { db, assignmentRef, assessmentQuestionKeysCollection } = makeEduDb();
    vi.mocked(getUserContext).mockResolvedValueOnce({
      uid: 'teacher-uid',
      role: 'teacher',
      isBlocked: false,
    } as any);
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(assessmentAssignmentData, 'assignment-1')
    );
    vi.mocked(assessmentQuestionKeysCollection.get).mockResolvedValue({
      docs: [
        {
          id: 'q1',
          data: () => ({ questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' }),
        },
      ],
    } as any);
    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'get-assessment-question-keys', assignmentId: 'assignment-1' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      q1: { questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' },
    });
  });

  it('blocks students from Assessment v2 answer keys before due date or attempts are exhausted', async () => {
    const { db, assignmentRef, assessmentQuestionKeysCollection } = makeEduDb();
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(assessmentAssignmentData, 'assignment-1')
    );
    vi.mocked(assessmentQuestionKeysCollection.get).mockResolvedValue({
      docs: [
        {
          id: 'q1',
          data: () => ({ questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' }),
        },
      ],
    } as any);
    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'submissions') {
        const queryMock: any = {
          where: vi.fn(() => queryMock),
          get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
        };
        return queryMock;
      }
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'get-assessment-question-keys', assignmentId: 'assignment-1' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('Assessment answers are not available yet');
  });

  it('blocks students from Assessment v2 answer keys when release policy is manual', async () => {
    const { db, assignmentRef, assessmentQuestionKeysCollection } = makeEduDb();
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          ...assessmentAssignmentData,
          dueDate: '2026-01-01T10:00:00.000Z',
          deliveryPolicy: {
            targetMode: 'class',
            assignedStudentIds: [],
            availableFrom: '',
            resultReleasePolicy: 'manual',
          },
        },
        'assignment-1'
      )
    );
    vi.mocked(assessmentQuestionKeysCollection.get).mockResolvedValue({
      docs: [
        {
          id: 'q1',
          data: () => ({ questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' }),
        },
      ],
    } as any);
    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'submissions') {
        const queryMock: any = {
          where: vi.fn(() => queryMock),
          get: vi.fn().mockResolvedValue({ docs: [makeDoc({}, 'sub-1')], size: 1 }),
        };
        return queryMock;
      }
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'get-assessment-question-keys', assignmentId: 'assignment-1' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('Assessment answers are not available yet');
  });

  it('saves an assignment authoring draft for the current teacher', async () => {
    const draftSet = vi.fn().mockResolvedValue(undefined);
    const draftRef = {
      id: 'draft-1',
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: draftSet,
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'assignment_authoring_drafts') {
          return { doc: vi.fn(() => draftRef) };
        }
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
              }),
            })),
          };
        }
        // Assignment audiences come from enrollments now, not from the
        // `classId` projection on linked user documents. Empty here: these
        // cases are about publishing, not about who receives it.
        return {
          doc: vi.fn(() => ({ get: vi.fn() })),
          where: vi.fn(function self(this: unknown) {
            return { where: self, get: vi.fn().mockResolvedValue({ docs: [] }) };
          }),
        };
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(getUserRoleAndName).mockResolvedValue({ role: 'teacher', name: 'Teacher One' });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-draft-save' },
        headers: {},
        body: {
          id: 'draft-1',
          localRevision: 4,
          serverRevision: 0,
          title: 'Draft title',
          classId: 'class-1',
          dueDate: '2026-06-30T10:00:00.000Z',
          assessmentDraft: {
            version: 2,
            mode: 'practice',
            sections: [
              {
                id: 'section-1',
                title: 'Listening',
                skill: 'listening',
                questions: [
                  {
                    id: 'q1',
                    skill: 'listening',
                    prompt: 'Prompt',
                    responseMode: 'short_answer',
                    media: [],
                  },
                ],
              },
            ],
          },
          lastImportReport: {
            filename: 'unit.csv',
            source: 'csv',
            appliedAt: '2026-06-12T01:00:00.000Z',
            mode: 'append',
            totalQuestions: 2,
            validQuestions: 1,
            warningCount: 0,
            errorCount: 1,
          },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(draftSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'draft-1',
        ownerUid: 'teacher-uid',
        title: 'Draft title',
        status: 'draft',
        localRevision: 4,
        serverRevision: 1,
        lastImportReport: {
          filename: 'unit.csv',
          source: 'csv',
          appliedAt: '2026-06-12T01:00:00.000Z',
          mode: 'append',
          totalQuestions: 2,
          validQuestions: 1,
          warningCount: 0,
          errorCount: 1,
        },
      }),
      { merge: true }
    );
  });

  it('normalizes invalid assignment authoring import report counts on draft save', async () => {
    const draftSet = vi.fn().mockResolvedValue(undefined);
    const draftRef = {
      id: 'draft-1',
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: draftSet,
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'assignment_authoring_drafts') {
          return { doc: vi.fn(() => draftRef) };
        }
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
              }),
            })),
          };
        }
        // Assignment audiences come from enrollments now, not from the
        // `classId` projection on linked user documents. Empty here: these
        // cases are about publishing, not about who receives it.
        return {
          doc: vi.fn(() => ({ get: vi.fn() })),
          where: vi.fn(function self(this: unknown) {
            return { where: self, get: vi.fn().mockResolvedValue({ docs: [] }) };
          }),
        };
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(getUserRoleAndName).mockResolvedValue({ role: 'teacher', name: 'Teacher One' });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-draft-save' },
        headers: {},
        body: {
          id: 'draft-1',
          localRevision: 4,
          serverRevision: 0,
          title: 'Draft title',
          classId: 'class-1',
          dueDate: '2026-06-30T10:00:00.000Z',
          assessmentDraft: {
            version: 2,
            mode: 'practice',
            sections: [
              {
                id: 'section-1',
                title: 'Listening',
                skill: 'listening',
                questions: [
                  {
                    id: 'q1',
                    skill: 'listening',
                    prompt: 'Prompt',
                    responseMode: 'short_answer',
                    media: [],
                  },
                ],
              },
            ],
          },
          lastImportReport: {
            filename: 'unit.csv',
            source: 'csv',
            appliedAt: '2026-06-12T01:00:00.000Z',
            mode: 'append',
            totalQuestions: 'bad',
            validQuestions: Number.NaN,
            warningCount: -2,
            errorCount: 'also bad',
          },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(draftSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastImportReport: expect.objectContaining({
          totalQuestions: 0,
          validQuestions: 0,
          warningCount: 0,
          errorCount: 0,
        }),
      }),
      { merge: true }
    );
  });

  it('rejects stale assignment authoring draft saves', async () => {
    const draftRef = {
      id: 'draft-1',
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ ownerUid: 'teacher-uid', serverRevision: 3 }),
      }),
      set: vi.fn(),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assignment_authoring_drafts'
          ? { doc: vi.fn(() => draftRef) }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ data: () => ({ role: 'teacher' }) }),
              })),
            }
      ),
    } as any);

    vi.mocked(getUserRoleAndName).mockResolvedValue({ role: 'teacher', name: 'Teacher One' });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-draft-save' },
        headers: {},
        body: {
          id: 'draft-1',
          serverRevision: 2,
          assessmentDraft: {
            version: 2,
            mode: 'practice',
            sections: [
              {
                id: 'section-1',
                title: 'Listening',
                skill: 'listening',
                questions: [
                  {
                    id: 'q1',
                    skill: 'listening',
                    prompt: 'Prompt',
                    responseMode: 'short_answer',
                    media: [],
                  },
                ],
              },
            ],
          },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain('Draft conflict');
  });

  it('lists only active assignment authoring drafts owned by the teacher', async () => {
    const docs = [
      {
        id: 'draft-1',
        data: () => ({ ownerUid: 'teacher-uid', status: 'draft', title: 'Draft 1' }),
      },
    ];
    const get = vi.fn().mockResolvedValue({ docs });
    const where = vi.fn(() => ({
      where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get })) })) })),
    }));
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assignment_authoring_drafts'
          ? { where }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ data: () => ({ role: 'teacher' }) }),
              })),
            }
      ),
    } as any);

    vi.mocked(getUserRoleAndName).mockResolvedValue({ role: 'teacher', name: 'Teacher One' });

    const res = mockRes();
    await handler(
      { method: 'GET', query: { action: 'assignment-draft-list' }, headers: {} } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([
      { id: 'draft-1', ownerUid: 'teacher-uid', status: 'draft', title: 'Draft 1' },
    ]);
  });

  it('rejects non-teacher roles for assignment draft actions', async () => {
    vi.mocked(verifyAuthToken).mockImplementation(async (req, res, requiredRoles) => {
      if (requiredRoles && !requiredRoles.includes('admin')) {
        res.status(403).json({ success: false, error: 'Insufficient permissions' });
        return null;
      }
      return { uid: 'admin-uid', email: 'admin@example.com' } as any;
    });
    vi.mocked(getUserRoleAndName).mockResolvedValue({ role: 'admin', name: 'Admin' });

    const resAdmin = mockRes();
    await handler(
      { method: 'GET', query: { action: 'assignment-draft-list' }, headers: {} } as any,
      resAdmin
    );
    expect(resAdmin.statusCode).toBe(403);
  });

  it('publishes a draft and marks it as published only after assignment creation succeeds', async () => {
    const draftSet = vi.fn().mockResolvedValue(undefined);
    const draftData = {
      id: 'draft-1',
      ownerUid: 'teacher-uid',
      title: 'Published Homework',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      attemptsAllowed: 1,
      proctoringMode: 'strict',
      status: 'draft',
      assessmentDraft: {
        version: 2,
        mode: 'practice',
        sections: [
          {
            id: 'section-1',
            title: 'Listening',
            skill: 'listening',
            questions: [
              {
                id: 'q1',
                skill: 'listening',
                prompt: 'Prompt',
                responseMode: 'short_answer',
                media: [],
              },
            ],
          },
        ],
      },
      deliveryPolicy: {
        targetMode: 'class',
        assignedStudentIds: [],
        availableFrom: '',
        resultReleasePolicy: 'after_submit',
      },
    };
    const draftRef = {
      id: 'draft-1',
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => draftData,
      }),
      set: draftSet,
    };

    const assignmentRef = { id: 'assignment-1' };
    const assignmentAdd = vi.fn().mockResolvedValue(assignmentRef);

    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'assignment_authoring_drafts') {
          return { doc: vi.fn(() => draftRef) };
        }
        if (name === 'assignments') {
          return { add: assignmentAdd, doc: vi.fn(() => ({ update: vi.fn() })) };
        }
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }) })),
            where: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ docs: [] }),
            })),
          };
        }
        // Assignment audiences come from enrollments now, not from the
        // `classId` projection on linked user documents. Empty here: these
        // cases are about publishing, not about who receives it.
        return {
          doc: vi.fn(() => ({ get: vi.fn() })),
          where: vi.fn(function self(this: unknown) {
            return { where: self, get: vi.fn().mockResolvedValue({ docs: [] }) };
          }),
        };
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(getUserRoleAndName).mockResolvedValue({ role: 'teacher', name: 'Teacher' });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-draft-publish' },
        body: { id: 'draft-1' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(assignmentAdd).toHaveBeenCalled();
    expect(draftSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'published',
        publishedAssignmentId: 'assignment-1',
      }),
      { merge: true }
    );
  });

  it('creates a private question bank item for a teacher', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'bank-q1' });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assessment_question_bank'
          ? { add }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
                }),
              })),
            }
      ),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assessment-question-bank-create' },
        headers: {},
        body: {
          skill: 'listening',
          responseMode: 'short_answer',
          prompt: 'Write one word.',
          media: [],
          points: 2,
          level: 'A2',
          tags: ['unit-1'],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'teacher-uid',
        visibility: 'private',
        prompt: 'Write one word.',
        tags: ['unit-1'],
      })
    );
  });

  it('lets a teacher submit their private question bank item for review', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const ref = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ ownerUid: 'teacher-uid', visibility: 'private' }),
      }),
      update,
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assessment_question_bank'
          ? { doc: vi.fn(() => ref) }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ data: () => ({ role: 'teacher' }) }),
              })),
            }
      ),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assessment-question-bank-submit-review' },
        headers: {},
        body: { id: 'bank-q1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'pending_review' }));
  });

  it('allows admins to approve shared bank content', async () => {
    vi.mocked(getUserRoleAndName).mockResolvedValue({
      role: 'admin',
      name: 'Admin',
    } as any);
    const update = vi.fn().mockResolvedValue(undefined);
    const ref = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ ownerUid: 'teacher-uid', visibility: 'pending_review' }),
      }),
      update,
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assessment_question_bank'
          ? { doc: vi.fn(() => ref) }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ data: () => ({ role: 'admin' }) }),
              })),
            }
      ),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assessment-question-bank-review' },
        headers: {},
        body: { id: 'bank-q1', decision: 'approve' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: 'shared',
        reviewedByUid: 'teacher-uid',
      })
    );
  });

  it('searches shared and owned question bank items without returning archived items', async () => {
    vi.mocked(getUserRoleAndName).mockResolvedValue({
      role: 'teacher',
      name: 'Teacher',
    } as any);
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 'bank-q1',
          data: () => ({ visibility: 'private', ownerUid: 'teacher-uid', prompt: 'Owned' }),
        },
        {
          id: 'bank-q2',
          data: () => ({ visibility: 'shared', ownerUid: 'other-teacher', prompt: 'Shared' }),
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assessment_question_bank'
          ? { orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get })) })) }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ data: () => ({ role: 'teacher' }) }),
              })),
            }
      ),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { action: 'assessment-question-bank-search' }, headers: {} } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items.map((item: any) => item.prompt)).toEqual(['Owned', 'Shared']);
  });

  it('filters question bank search by visibility and query text', async () => {
    vi.mocked(getUserRoleAndName).mockResolvedValue({
      role: 'admin',
      name: 'Admin',
    } as any);
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 'bank-q1',
          data: () => ({
            visibility: 'pending_review',
            ownerUid: 'teacher-1',
            prompt: 'Pending travel question',
            tags: ['unit-1'],
          }),
        },
        {
          id: 'bank-q2',
          data: () => ({
            visibility: 'shared',
            ownerUid: 'teacher-2',
            prompt: 'Shared travel question',
            tags: ['unit-1'],
          }),
        },
        {
          id: 'bank-q3',
          data: () => ({
            visibility: 'pending_review',
            ownerUid: 'teacher-3',
            prompt: 'Pending food question',
            tags: ['unit-2'],
          }),
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assessment_question_bank'
          ? { orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get })) })) }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ data: () => ({ role: 'admin' }) }),
              })),
            }
      ),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: {
          action: 'assessment-question-bank-search',
          visibility: 'pending_review',
          q: 'travel',
        },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items.map((item: any) => item.prompt)).toEqual([
      'Pending travel question',
    ]);
  });

  it('searches visible media bank items', async () => {
    vi.mocked(getUserRoleAndName).mockResolvedValue({
      role: 'teacher',
      name: 'Teacher One',
    } as any);
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 'media-1',
          data: () => ({
            visibility: 'private',
            ownerUid: 'teacher-uid',
            title: 'Owned audio',
            type: 'audio',
            source: 'external_url',
            url: 'https://cdn.example.com/owned.mp3',
          }),
        },
        {
          id: 'media-2',
          data: () => ({
            visibility: 'shared',
            ownerUid: 'other-teacher',
            title: 'Shared audio',
            type: 'audio',
            source: 'external_url',
            url: 'https://cdn.example.com/shared.mp3',
          }),
        },
        {
          id: 'media-3',
          data: () => ({
            visibility: 'private',
            ownerUid: 'other-teacher',
            title: 'Hidden audio',
            type: 'audio',
            source: 'external_url',
            url: 'https://cdn.example.com/hidden.mp3',
          }),
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) =>
        name === 'assessment_media_bank'
          ? { orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get })) })) }
          : {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ data: () => ({ role: 'teacher' }) }),
              })),
            }
      ),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { action: 'assessment-media-bank-search' }, headers: {} } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items.map((item: any) => item.title)).toEqual([
      'Owned audio',
      'Shared audio',
    ]);
  });

  it('previews assignment authoring import uploads for teachers', async () => {
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {},
        {
          file: [
            makeUploadedFile({
              filepath: 'C:\\tmp\\unit.xlsx',
              originalFilename: 'unit.xlsx',
              mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
          ],
        },
      ]),
    } as any);
    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-draft-import-preview' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(parseAuthoringImportBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'unit.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
    expect(res.body).toMatchObject({
      success: true,
      data: {
        validQuestions: 1,
        sections: [expect.objectContaining({ title: 'Listening' })],
      },
    });
  });

  it('rejects assignment authoring import preview for students', async () => {
    vi.mocked(verifyAuthToken).mockImplementation(async (req, res, roles) => {
      expect(roles).toEqual(['teacher']);
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return null;
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-draft-import-preview' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(parseAuthoringImportBuffer).not.toHaveBeenCalled();
  });

  it('downloads assignment authoring import templates for teachers', async () => {
    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'assignment-draft-import-template', format: 'csv' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(buildAuthoringImportTemplate).toHaveBeenCalledWith('csv');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="assignment-import-template.csv"'
    );
    expect(res.body).toEqual(Buffer.from('section,skill,responseMode,prompt'));
  });

  it('rejects assignment authoring template downloads for students', async () => {
    vi.mocked(verifyAuthToken).mockImplementation(async (req, res, roles) => {
      expect(roles).toEqual(['teacher']);
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return null;
    });

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'assignment-draft-import-template', format: 'csv' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(buildAuthoringImportTemplate).not.toHaveBeenCalled();
  });

  it('returns assignment progress summary for teachers', async () => {
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          ...assessmentAssignmentData,
          classId: 'class-1',
          teacherId: 'teacher-uid',
          dueDate: '2026-06-12T10:00:00.000Z',
        },
        'assignment-1'
      )
    );

    // Delivery targets come from the enrollment now, not `students.classId`.
    // The profile is fetched by id, and identity resolution addresses it by
    // path, so the seeded student has to answer through both.
    const studentDoc = makeDoc({ name: 'Student One', classId: 'class-1' }, 'student-1');
    const studentQueryMock: any = {
      where: vi.fn(() => studentQueryMock),
      // Empty on purpose: the only remaining query against this collection is
      // the resolver looking for a legacy merge pointer, and answering that
      // with the student itself would claim it was merged into itself.
      get: vi.fn().mockResolvedValue({ docs: [] }),
      doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(studentDoc) })),
    };

    const enrollmentQueryMock: any = {
      where: vi.fn(() => enrollmentQueryMock),
      orderBy: vi.fn(() => enrollmentQueryMock),
      limit: vi.fn(() => enrollmentQueryMock),
      get: vi.fn().mockResolvedValue({
        docs: [
          makeDoc(
            {
              studentId: 'student-1',
              classId: 'class-1',
              termStart: '2026-06-01',
              termEnd: '2026-08-31',
              status: 'active',
              joinedAt: '2026-06-01',
              endedAt: null,
            },
            'enr-1'
          ),
        ],
      }),
    };

    // Mock submissions query
    const submissionQueryMock: any = {
      where: vi.fn(() => submissionQueryMock),
      get: vi.fn().mockResolvedValue({
        docs: [
          makeDoc(
            {
              studentId: 'student-1',
              status: 'submitted',
              submittedAt: '2026-06-12T09:00:00.000Z',
            },
            'sub-1'
          ),
        ],
      }),
    };

    vi.mocked(db.collection).mockImplementation((name: string) => {
      if (name === 'assignments') {
        return {
          add: vi.fn(),
          doc: vi.fn(() => assignmentRef),
        } as any;
      }
      if (name === 'students') {
        return studentQueryMock;
      }
      if (name === 'student_course_enrollments') {
        return enrollmentQueryMock;
      }
      if (name === 'submissions') {
        return submissionQueryMock;
      }
      const genericMock: any = {
        where: vi.fn(() => genericMock),
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({})) })),
      };
      return genericMock;
    });

    (db as any).doc = vi.fn((path: string) => ({
      path,
      id: path.slice(path.indexOf('/') + 1),
      get: vi
        .fn()
        .mockResolvedValue(
          path === 'students/student-1' ? studentDoc : { exists: false, data: () => undefined }
        ),
    }));

    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-uid',
      role: 'teacher',
      isBlocked: false,
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'assignment-progress-summary', assignmentId: 'assignment-1' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'admin',
      'teacher',
    ]);
    expect(res.body.data.counts).toEqual(
      expect.objectContaining({
        target: 1,
        submitted: 1,
      })
    );
  });

  it('saves a student assignment attempt draft with server-owned identity fields', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      uid: 'student-user-1',
      email: 's@example.com',
    } as any);
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          classId: 'class-1',
          teacherId: 'teacher-1',
          type: 'quiz',
          questions: [
            { id: 1, question_content: 'Q1', options: [], correct_answer: 'A', level: 'A1' },
          ],
          dueDate: '2099-01-01T00:00:00.000Z',
        },
        'assignment-1'
      )
    );

    const draftDoc = { exists: false, data: () => undefined, id: 'assignment-1_student-1' };
    const draftRef = {
      get: vi.fn().mockResolvedValue(draftDoc),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      id: 'assignment-1_student-1',
    };

    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'users')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(
                makeDoc(
                  { studentId: 'student-1', classId: 'class-1', role: 'student' },
                  'student-user-1'
                )
              ),
          })),
        };
      if (name === 'students')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(makeDoc({ name: 'Student One', classId: 'class-1' }, 'student-1')),
          })),
        };
      if (name === 'submissions')
        return {
          where: vi.fn(() => ({
            where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
          })),
        };
      if (name === 'assignment_attempt_drafts') return { doc: vi.fn(() => draftRef) };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assertStudentInClass).mockResolvedValueOnce({ name: 'Student One' } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-attempt-draft-save' },
        headers: {},
        body: {
          assignmentId: 'assignment-1',
          studentId: 'student-evil',
          classId: 'class-evil',
          quizAnswers: [{ questionId: 1, selectedOption: 'A' }],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(draftRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        studentName: 'Student One',
        classId: 'class-1',
        teacherId: 'teacher-1',
        ownerUid: 'student-user-1',
        quizAnswers: [{ questionId: 1, selectedOption: 'A' }],
        status: 'in_progress',
        attemptNumber: 1,
      }),
      { merge: false }
    );
  });

  it('rejects attempt draft save for untargeted selected-student assignments', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      uid: 'student-user-2',
      email: 's2@example.com',
    } as any);
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          classId: 'class-1',
          teacherId: 'teacher-1',
          type: 'essay',
          dueDate: '2099-01-01T00:00:00.000Z',
          deliveryPolicy: {
            targetMode: 'selected_students',
            assignedStudentIds: ['student-1'],
            availableFrom: '',
            resultReleasePolicy: 'after_due',
          },
        },
        'assignment-1'
      )
    );

    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'users')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(
                makeDoc(
                  { studentId: 'student-2', classId: 'class-1', role: 'student' },
                  'student-user-2'
                )
              ),
          })),
        };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-attempt-draft-save' },
        headers: {},
        body: { assignmentId: 'assignment-1', content: 'draft' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });

  it('gets and clears only the current student attempt draft', async () => {
    vi.mocked(verifyAuthToken)
      .mockResolvedValueOnce({ uid: 'student-user-1', email: 's@example.com' } as any)
      .mockResolvedValueOnce({ uid: 'student-user-1', email: 's@example.com' } as any);

    const { db, assignmentRef } = makeEduDb();
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          classId: 'class-1',
          teacherId: 'teacher-1',
          type: 'essay',
          dueDate: '2099-01-01T00:00:00.000Z',
        },
        'assignment-1'
      )
    );

    const savedDraft = {
      id: 'assignment-1_student-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      studentName: 'Student One',
      classId: 'class-1',
      teacherId: 'teacher-1',
      ownerUid: 'student-user-1',
      content: 'Saved draft',
      quizAnswers: [],
      assessmentAnswers: [],
      attemptNumber: 1,
      status: 'in_progress',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    };
    const draftRef = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          exists: true,
          id: 'assignment-1_student-1',
          data: () => savedDraft,
        })
        .mockResolvedValueOnce({
          exists: true,
          id: 'assignment-1_student-1',
          data: () => savedDraft,
        }),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      id: 'assignment-1_student-1',
    };

    const makeAssignmentCollection = () => ({ doc: vi.fn(() => assignmentRef) });
    const makeUserCollection = () => ({
      doc: vi.fn(() => ({
        get: vi
          .fn()
          .mockResolvedValue(
            makeDoc(
              { studentId: 'student-1', classId: 'class-1', role: 'student' },
              'student-user-1'
            )
          ),
      })),
    });
    const makeDraftCollection = () => ({ doc: vi.fn(() => draftRef) });

    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return makeAssignmentCollection();
      if (name === 'users') return makeUserCollection();
      if (name === 'students')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(makeDoc({ name: 'Student One', classId: 'class-1' }, 'student-1')),
          })),
        };
      if (name === 'assignment_attempt_drafts') return makeDraftCollection();
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assertStudentInClass)
      .mockResolvedValueOnce({ name: 'Student One' } as any)
      .mockResolvedValueOnce({ name: 'Student One' } as any);

    // GET
    const getRes = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'assignment-attempt-draft-get', assignmentId: 'assignment-1' },
        headers: {},
      } as any,
      getRes
    );

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.data.content).toBe('Saved draft');

    // CLEAR
    const clearRes = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-attempt-draft-clear' },
        headers: {},
        body: { assignmentId: 'assignment-1' },
      } as any,
      clearRes
    );

    expect(clearRes.statusCode).toBe(200);
    expect(draftRef.delete).toHaveBeenCalledTimes(1);
  });

  it('clears the matching assignment attempt draft after successful submit', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      uid: 'student-user-1',
      email: 's@example.com',
    } as any);
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          classId: 'class-1',
          teacherId: 'teacher-1',
          type: 'essay',
          dueDate: '2099-01-01T00:00:00.000Z',
          attemptsAllowed: 1,
        },
        'assignment-1'
      )
    );

    const submissionCreate = vi.fn();
    const submissionRef = { id: 'submission-1' };
    const draftRef = {
      exists: true,
      data: () => ({
        id: 'assignment-1_student-1',
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        content: 'draft',
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const draftDocRef = { delete: vi.fn().mockResolvedValue(undefined) };
    const tx = {
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      create: submissionCreate,
      delete: vi.fn(),
    };
    (db as any).runTransaction = vi.fn(async (callback: any) => callback(tx));

    (db.collection as any).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) };
      if (name === 'users')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(
                makeDoc(
                  { studentId: 'student-1', classId: 'class-1', role: 'student' },
                  'student-user-1'
                )
              ),
          })),
          where: vi.fn((field: string, _op: string, _val: string) => ({
            get: vi.fn().mockResolvedValue({
              docs:
                field === 'role'
                  ? [{ id: 'student-user-1', data: () => ({ role: 'student' }) }]
                  : [{ id: 'student-user-1', data: () => ({ role: 'student' }) }],
            }),
          })),
        };
      if (name === 'submissions')
        return {
          doc: vi.fn(() => submissionRef),
          where: vi.fn(() => ({
            where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn() })) })),
          })),
        };
      if (name === 'assignment_attempt_drafts') return { doc: vi.fn(() => draftDocRef) };
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-submit' },
        headers: {},
        body: { assignmentId: 'assignment-1', content: 'Final answer' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(tx.delete).toHaveBeenCalledWith(draftDocRef);
  });

  it('creates an assignment without a separate realtime recipient fan-out', async () => {
    const { db } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    // The class audience comes from enrollments now. The teacher in the class
    // is still seeded, because what this case protects is that staff never
    // receive a student-scoped delta.
    const userQuery: any = {
      where: vi.fn((field: string, operator: string, value: string) => {
        userQuery.queryKey = `${field}:${operator}:${value}`;
        return userQuery;
      }),
      get: vi.fn(async () => {
        if (userQuery.queryKey === 'role:==:admin') {
          return {
            docs: [
              { id: 'admin-1', data: () => ({ role: 'admin' }) },
              { id: 'admin-blocked', data: () => ({ role: 'admin', blockedTeacher: true }) },
            ],
          };
        }
        return {
          docs: [
            {
              id: 'student:stu-1',
              data: () => ({ role: 'student', studentId: 'stu-1', classId: 'class-1' }),
            },
            {
              id: 'parent:stu-1',
              data: () => ({ role: 'parent', studentId: 'stu-1', classId: 'class-1' }),
            },
            { id: 'teacher-in-class', data: () => ({ role: 'teacher', classId: 'class-1' }) },
          ],
        };
      }),
    };

    const enrollmentQuery: any = {
      where: vi.fn(() => enrollmentQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: 'stu-1__class-1__2026-07-01',
            data: () => ({ studentId: 'stu-1', classId: 'class-1', status: 'active' }),
          },
        ],
      }),
    };

    const studentsCollection: any = {
      doc: vi.fn((id: string) => ({
        get: vi.fn().mockResolvedValue({ exists: id === 'stu-1', data: () => ({ name: id }) }),
      })),
      where: vi.fn(() => studentsCollection),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };

    vi.mocked(db.collection).mockImplementation((name: string) => {
      if (name === 'assignments') {
        return {
          add: vi.fn().mockResolvedValue({
            id: 'assignment-1',
            collection: vi.fn(() => ({ doc: vi.fn() })),
          }),
        } as any;
      }
      if (name === 'users') return userQuery;
      if (name === 'student_course_enrollments') return enrollmentQuery;
      if (name === 'students') return studentsCollection;
      const chainable: any = {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }) })),
        where: vi.fn(() => chainable),
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
      };
      return chainable;
    });
    (db as any).doc = vi.fn((path: string) => ({
      get: vi.fn().mockResolvedValue({
        exists: path === 'students/stu-1',
        data: () => ({ name: 'stu-1' }),
      }),
    }));

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-create' },
        headers: {},
        body: assignmentBody,
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
  });

  it('submits an assignment without a separate realtime delta payload', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      uid: 'student-user-1',
      email: 's@example.com',
    } as any);
    const { db, assignmentRef } = makeEduDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    vi.mocked(assignmentRef.get).mockResolvedValue(
      makeDoc(
        {
          classId: 'class-1',
          teacherId: 'teacher-1',
          type: 'quiz',
          dueDate: '2099-01-01T00:00:00.000Z',
          attemptsAllowed: 1,
        },
        'assignment-1'
      )
    );

    const tx = {
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      create: vi.fn(),
      delete: vi.fn(),
    };
    (db as any).runTransaction = vi.fn(async (callback: any) =>
      callback({
        ...tx,
        create: vi.fn((_ref: any, payload: any) => {
          tx.create(_ref, payload);
        }),
      })
    );

    vi.mocked(db.collection).mockImplementation((name: string) => {
      if (name === 'assignments') return { doc: vi.fn(() => assignmentRef) } as any;
      if (name === 'users')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(
                makeDoc(
                  { studentId: 'student-1', classId: 'class-1', role: 'student' },
                  'student-user-1'
                )
              ),
          })),
          where: vi.fn((field: string, operator: string, value: string) => ({
            get: vi
              .fn()
              .mockResolvedValue(
                field === 'role' && value === 'admin'
                  ? { docs: [{ id: 'admin-1', data: () => ({ role: 'admin' }) }] }
                  : { docs: [{ id: 'student-user-1', data: () => ({ role: 'student' }) }] }
              ),
          })),
        } as any;
      if (name === 'submissions')
        return {
          doc: vi.fn(() => ({ id: 'submission-1' })),
          where: vi.fn(() => ({
            where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn() })) })),
          })),
        } as any;
      if (name === 'assignment_attempt_drafts') return { doc: vi.fn(() => ({ delete: vi.fn() })) };
      if (name === 'students')
        return {
          doc: vi.fn(() => ({
            get: vi
              .fn()
              .mockResolvedValue(makeDoc({ name: 'Student One', classId: 'class-1' }, 'student-1')),
          })),
        } as any;
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) } as any;
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'assignment-submit' },
        headers: {},
        body: {
          assignmentId: 'assignment-1',
          content: 'Essay answer',
          quizAnswers: [{ questionId: 'q1', selectedOption: 'A' }],
          examIntegrity: { tabSwitches: 2 },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
  });
});
describe('edu final evaluation mutation protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-uid',
      email: 't@test.com',
    } as any);
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'teacher-uid', email: 't@test.com' },
      context: { uid: 'teacher-uid', role: 'teacher', name: 'Teacher' },
    } as any);
    vi.mocked(assertTeacherClassAccess).mockResolvedValue({ teacherId: 'teacher-uid' } as any);
  });

  it('blocks deleting the exact current final evaluation version already sent', async () => {
    const evaluationSnap = makeDocumentStoreDocSnapshot({
      id: 'evaluation-1',
      path: 'evaluations/evaluation-1',
      updateTime: '2026-07-18T08:00:00.000Z',
      data: {
        classId: 'class-1',
        studentId: 'student-1',
        evaluationType: 'final',
        date: '2026-07-18',
      },
    });
    const evaluationUpdate = vi.fn().mockResolvedValue(undefined);
    Object.assign(evaluationSnap.ref, { update: evaluationUpdate });
    const classSnap = makeDocumentStoreDocSnapshot({
      id: 'class-1',
      path: 'classes/class-1',
      data: {
        teacherId: 'teacher-uid',
        currentCourseId: 'course-1',
        startDate: '2026-05-01',
        endDate: '2026-07-18',
      },
    });
    const notificationSnap = makeDocumentStoreDocSnapshot({
      id: 'notification-1',
      path: 'zalo_notifications/notification-1',
      data: {
        courseId: 'course-1',
        status: 'sent',
        type: 'evaluation_notice',
        evaluationId: 'evaluation-1',
        evaluationVersion: '2026-07-18T08:00:00.000Z',
      },
    });
    const notificationQuery: any = {
      where: vi.fn(() => notificationQuery),
      get: vi.fn().mockResolvedValue({ docs: [notificationSnap] }),
    };
    const transactionHarness = createDocumentStoreTransactionHarness();
    const db: any = {
      runTransaction: transactionHarness.runTransaction,
      collection: vi.fn((name: string) => {
        if (name === 'evaluations') return { doc: vi.fn(() => evaluationSnap.ref) };
        if (name === 'classes') return { doc: vi.fn(() => classSnap.ref) };
        if (name === 'zalo_notifications') return notificationQuery;
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'DELETE',
        query: { action: 'evaluation-delete' },
        headers: {},
        body: { id: 'evaluation-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.errorCode).toBe('EVALUATION_ALREADY_SENT_LOCKED');
    expect(evaluationUpdate).not.toHaveBeenCalled();
  });

  it('updates an unsent current final evaluation and invalidates approval atomically', async () => {
    const evaluationSnap = makeDocumentStoreDocSnapshot({
      id: 'evaluation-1',
      path: 'evaluations/evaluation-1',
      updateTime: '2026-07-18T08:00:00.000Z',
      data: {
        classId: 'class-1',
        studentId: 'student-1',
        evaluationType: 'final',
        date: '2026-07-18',
      },
    });
    const classSnap = makeDocumentStoreDocSnapshot({
      id: 'class-1',
      path: 'classes/class-1',
      data: {
        teacherId: 'teacher-uid',
        currentCourseId: 'course-1',
        startDate: '2026-05-01',
        endDate: '2026-07-18',
        courseClosing: {
          courseId: 'course-1',
          approval: {
            status: 'approved',
            source: 'teacher',
            approvedAt: '2026-07-18T07:00:00.000Z',
            approvedBy: 'teacher-uid',
            approvedByRole: 'teacher',
            rosterFingerprint: 'roster',
            evaluationFingerprint: 'evaluation',
          },
          exemptions: [{ studentId: 'student-1', reason: 'Medical leave' }],
        },
      },
    });
    const notificationQuery: any = {
      where: vi.fn(() => notificationQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };
    const transactionHarness = createDocumentStoreTransactionHarness();
    const db: any = {
      runTransaction: transactionHarness.runTransaction,
      collection: vi.fn((name: string) => {
        if (name === 'evaluations') return { doc: vi.fn(() => evaluationSnap.ref) };
        if (name === 'classes') return { doc: vi.fn(() => classSnap.ref) };
        if (name === 'zalo_notifications') return notificationQuery;
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'evaluation-update' },
        headers: {},
        body: {
          ...evaluationBody,
          id: 'evaluation-1',
          evaluationType: 'final',
          date: '2026-07-18',
          totalScore: 90,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(transactionHarness.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'update',
          ref: classSnap.ref,
          data: expect.objectContaining({
            'courseClosing.approval.status': 'invalidated',
            'courseClosing.approval.invalidatedBy': 'teacher-uid',
            'courseClosing.approval.invalidatedReason': 'FINAL_EVALUATION_CHANGED',
          }),
        }),
        expect.objectContaining({
          type: 'update',
          ref: evaluationSnap.ref,
          data: expect.objectContaining({ totalScore: 90, evaluationType: 'final' }),
        }),
      ])
    );
  });
});
