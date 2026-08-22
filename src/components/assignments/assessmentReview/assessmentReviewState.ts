import type {
  AssessmentQuestionGradeInput,
  AssessmentScore,
  AssignmentAssessment,
} from '../../../../shared/assignmentAssessment';
import { getAssessmentQuestionList } from '../../../../shared/assignmentAssessment';

export interface AssessmentQuestionGradeDraft {
  questionId: string;
  pointsAwarded: string;
  feedback: string;
}

export type AssessmentGradingDraft = Record<string, AssessmentQuestionGradeDraft>;

export function buildAssessmentGradingDraft(
  assessment: AssignmentAssessment,
  score: AssessmentScore | null | undefined
): AssessmentGradingDraft {
  const scoreById = new Map((score?.questionScores || []).map((item) => [item.questionId, item]));
  return Object.fromEntries(
    getAssessmentQuestionList(assessment).map((question) => {
      const existing = scoreById.get(question.id);
      return [
        question.id,
        {
          questionId: question.id,
          pointsAwarded: String(existing?.pointsAwarded ?? 0),
          feedback: existing?.feedback || '',
        },
      ];
    })
  );
}

export function updateAssessmentQuestionDraft(
  draft: AssessmentGradingDraft,
  questionId: string,
  patch: Partial<Omit<AssessmentQuestionGradeDraft, 'questionId'>>
): AssessmentGradingDraft {
  const current = draft[questionId] || { questionId, pointsAwarded: '0', feedback: '' };
  return {
    ...draft,
    [questionId]: { ...current, ...patch },
  };
}

export function buildAssessmentGradePayload(
  draft: AssessmentGradingDraft
): AssessmentQuestionGradeInput[] {
  return Object.values(draft).map((item) => ({
    questionId: item.questionId,
    pointsAwarded: Number(item.pointsAwarded || 0),
    ...(item.feedback.trim() ? { feedback: item.feedback.trim() } : {}),
  }));
}
