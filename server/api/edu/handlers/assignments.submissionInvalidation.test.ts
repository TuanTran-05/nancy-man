import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleAssignmentDelete,
  handleAssignmentDeleteSubmissions,
  handleAssignmentGrade,
  handleAssignmentSubmit,
} from './assignments.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../../lib/auth/authz.js', () => ({
  assertStudentInClass: vi.fn().mockResolvedValue({ name: 'Student One' }),
}));

vi.mock('../../lib/documentStore/batchWrites.js', () => ({
  commitWriteOperationsInChunks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/maintenance/studentIdentityMutationTransaction.js', () => ({
  runStudentIdentityMutationTransaction: vi
    .fn()
    .mockResolvedValue({ id: 'submission-new', attemptNumber: 1 }),
}));

function responseDouble() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

function submissionsEventCount() {
  return vi.mocked(touchRealtimeEvent).mock.calls.filter(([channel]) => channel === 'submissions')
    .length;
}

function submissionDbForSubmit(autoGraded: boolean) {
  const assignmentRef = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        classId: 'class-1',
        teacherId: 'teacher-1',
        attemptsAllowed: 1,
        type: autoGraded ? 'quiz' : 'homework',
      }),
    }),
    collection: () => ({
      get: vi.fn().mockResolvedValue({
        docs: autoGraded ? [{ id: 'question-1', data: () => ({ correct_answer: 'A' }) }] : [],
      }),
    }),
  };
  const userRef = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ studentId: 'student-1', classId: 'class-1', role: 'student' }),
    }),
  };

  return {
    collection: vi.fn((name: string) => {
      if (name === 'assignments') return { doc: () => assignmentRef };
      if (name === 'users') {
        return {
          doc: () => userRef,
          where: () => ({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    }),
  };
}

function submissionDbForDeletion(submissionData: Record<string, unknown>) {
  const assignmentRef = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ teacherId: 'teacher-1', classId: 'class-1' }),
    }),
  };
  const submissionDocs = [
    {
      id: 'submission-1',
      ref: { id: 'submission-1' },
      data: () => submissionData,
    },
  ];

  return {
    collection: vi.fn((name: string) => {
      if (name === 'assignments') return { doc: () => assignmentRef };
      if (name === 'submissions') {
        return {
          where: () => ({ get: vi.fn().mockResolvedValue({ docs: submissionDocs, size: 1 }) }),
        };
      }
      if (name === 'users') {
        return { where: () => ({ get: vi.fn().mockResolvedValue({ docs: [] }) }) };
      }
      throw new Error(`Unexpected collection: ${name}`);
    }),
  };
}

describe('assignment submission invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes the submissions DocumentStore event after grading changes GPA data', async () => {
    const updateSubmission = vi.fn().mockResolvedValue(undefined);
    const submissionRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          assignmentId: 'assignment-1',
          studentId: 'student-1',
          teacherId: 'teacher-1',
          classId: 'class-1',
          status: 'submitted',
        }),
      }),
      update: updateSubmission,
    };
    const assignmentRef = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'submissions') return { doc: () => submissionRef };
        if (name === 'assignments') return { doc: () => assignmentRef };
        if (name === 'users') {
          return {
            where: () => ({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    };
    const response = responseDouble();

    await handleAssignmentGrade(
      {
        method: 'POST',
        body: { submissionId: 'submission-1', grade: 90 },
        headers: {},
      } as any,
      response as any,
      db as any,
      'admin-1',
      'admin'
    );

    expect(updateSubmission).toHaveBeenCalledWith({
      grade: 90,
      feedback: '',
      status: 'graded',
    });
    expect(touchRealtimeEvent).toHaveBeenCalledWith('submissions', { targetId: 'class-1' });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('publishes the submissions event from the Assessment v2 grading branch', async () => {
    const updateSubmission = vi.fn().mockResolvedValue(undefined);
    const submissionRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          assignmentId: 'assignment-1',
          studentId: 'student-1',
          teacherId: 'teacher-1',
          classId: 'class-1',
          status: 'submitted',
          assessmentScore: null,
        }),
      }),
      update: updateSubmission,
    };
    const assignmentRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          assessment: {
            version: 2,
            mode: 'practice',
            sections: [
              {
                id: 'section-1',
                title: 'Writing',
                skill: 'writing',
                questions: [
                  {
                    id: 'question-1',
                    skill: 'writing',
                    prompt: 'Write one sentence.',
                    responseMode: 'long_answer',
                    media: [],
                    points: 10,
                  },
                ],
              },
            ],
          },
        }),
      }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'submissions') return { doc: () => submissionRef };
        if (name === 'assignments') return { doc: () => assignmentRef };
        if (name === 'users') {
          return { where: () => ({ get: vi.fn().mockResolvedValue({ docs: [] }) }) };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    };
    const response = responseDouble();

    await handleAssignmentGrade(
      {
        method: 'POST',
        body: {
          submissionId: 'submission-1',
          assessmentQuestionScores: [{ questionId: 'question-1', pointsAwarded: 8 }],
        },
        headers: {},
      } as any,
      response as any,
      db as any,
      'admin-1',
      'admin'
    );

    expect(updateSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 8, status: 'graded' })
    );
    expect(submissionsEventCount()).toBe(1);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it.each([
    { autoGraded: false, expectedEvents: 0 },
    { autoGraded: true, expectedEvents: 1 },
  ])(
    'emits only when a new submission is GPA-visible (autoGraded=$autoGraded)',
    async ({ autoGraded, expectedEvents }) => {
      const response = responseDouble();
      const db = submissionDbForSubmit(autoGraded);

      await handleAssignmentSubmit(
        {
          method: 'POST',
          body: {
            assignmentId: 'assignment-1',
            ...(autoGraded
              ? { quizAnswers: [{ questionId: 'question-1', selectedOption: 'A' }] }
              : {}),
          },
          headers: {},
        } as any,
        response as any,
        db as any,
        { uid: 'student-user-1' }
      );

      expect(submissionsEventCount()).toBe(expectedEvents);
      expect(response.status).toHaveBeenCalledWith(201);
    }
  );

  it.each([
    { status: 'submitted', isDeleted: false, expectedEvents: 0 },
    { status: 'graded', isDeleted: false, expectedEvents: 1 },
    { status: 'graded', isDeleted: true, expectedEvents: 0 },
  ])(
    'invalidates assignment deletion only for active graded submissions',
    async ({ status, isDeleted, expectedEvents }) => {
      const response = responseDouble();
      const db = submissionDbForDeletion({ status, isDeleted });

      await handleAssignmentDelete(
        {
          method: 'DELETE',
          body: { id: 'assignment-1' },
          query: {},
          headers: {},
        } as any,
        response as any,
        db as any,
        'admin-1',
        'admin'
      );

      expect(submissionsEventCount()).toBe(expectedEvents);
      expect(response.status).toHaveBeenCalledWith(200);
    }
  );

  it.each([
    { status: 'submitted', isDeleted: false, expectedEvents: 0 },
    { status: 'graded', isDeleted: false, expectedEvents: 1 },
    { status: 'graded', isDeleted: true, expectedEvents: 0 },
  ])(
    'invalidates bulk deletion only for active graded submissions',
    async ({ status, isDeleted, expectedEvents }) => {
      const response = responseDouble();
      const db = submissionDbForDeletion({ status, isDeleted });

      await handleAssignmentDeleteSubmissions(
        {
          method: 'DELETE',
          body: { assignmentId: 'assignment-1' },
          headers: {},
        } as any,
        response as any,
        db as any,
        'admin-1',
        'admin'
      );

      expect(submissionsEventCount()).toBe(expectedEvents);
      expect(response.status).toHaveBeenCalledWith(200);
    }
  );
});
