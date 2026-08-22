import type { AssessmentAnswer } from './assignmentAssessment';
import { normalizeAssessmentAnswers } from './assignmentAssessment.js';

export type AssignmentAttemptDraftStatus = 'in_progress';

export interface AssignmentAttemptDraftQuizAnswer {
  questionId: number;
  selectedOption: string;
}

export interface AssignmentAttemptDraftPayload {
  content: string;
  quizAnswers: AssignmentAttemptDraftQuizAnswer[];
  assessmentAnswers: AssessmentAnswer[];
}

export interface AssignmentAttemptDraft extends AssignmentAttemptDraftPayload {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  classId: string;
  teacherId: string;
  ownerUid: string;
  attemptNumber: number;
  status: AssignmentAttemptDraftStatus;
  createdAt: string;
  updatedAt: string;
  clientSavedAt?: string;
}

interface AssignmentLike {
  id: string;
  type: 'essay' | 'quiz';
  questions?: { id: number }[];
  assessment?: Parameters<typeof normalizeAssessmentAnswers>[1];
}

export function buildAssignmentAttemptDraftId(assignmentId: string, studentId: string): string {
  return `${assignmentId}_${studentId}`.replace(/[/\\#?[\]]/g, '_');
}

export function normalizeAssignmentAttemptDraftPayload(input: {
  assignment: AssignmentLike;
  raw: Record<string, unknown>;
}): AssignmentAttemptDraftPayload {
  const hasAssessmentV2 = input.assignment.assessment?.version === 2;
  if (hasAssessmentV2 && input.assignment.assessment) {
    return {
      content: '',
      quizAnswers: [],
      assessmentAnswers: normalizeAssessmentAnswers(
        input.raw.assessmentAnswers,
        input.assignment.assessment
      ),
    };
  }

  if (input.assignment.type === 'quiz') {
    const questionIds = new Set((input.assignment.questions || []).map((question) => question.id));
    const quizAnswers = Array.isArray(input.raw.quizAnswers)
      ? input.raw.quizAnswers
          .map((item) => {
            const answer = item as Record<string, unknown>;
            return {
              questionId: Number(answer.questionId),
              selectedOption: String(answer.selectedOption || '').trim(),
            };
          })
          .filter((answer) => questionIds.has(answer.questionId) && answer.selectedOption)
      : [];
    return { content: '', quizAnswers, assessmentAnswers: [] };
  }

  return {
    content: String(input.raw.content || '').trim(),
    quizAnswers: [],
    assessmentAnswers: [],
  };
}

export function chooseNewestAssignmentAttemptDraft<T extends { updatedAt?: string }>(
  first: T | null | undefined,
  second: T | null | undefined
): T | null {
  if (!first && !second) return null;
  if (!first) return second || null;
  if (!second) return first;
  return Date.parse(second.updatedAt || '') > Date.parse(first.updatedAt || '') ? second : first;
}

export function resolveNextAttemptNumber(submissions: Array<{ attemptNumber?: number }>): number {
  const latest = submissions.reduce(
    (max, submission) => Math.max(max, Number(submission.attemptNumber || 0)),
    0
  );
  return latest + 1;
}
