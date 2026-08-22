import type {
  AssessmentAnswer,
  AssignmentAssessment,
} from '../../../../shared/assignmentAssessment';
import { getAssessmentProgress } from '../../../../shared/assignmentAssessment';

function hasAnswerContent(answer: AssessmentAnswer): boolean {
  if (answer.responseMode === 'multiple_choice') {
    return Boolean(answer.selectedOption?.trim());
  }

  if (answer.responseMode === 'short_answer') {
    return Boolean(answer.textAnswer?.trim());
  }

  if (answer.responseMode === 'long_answer') {
    return Boolean(answer.textAnswer?.trim());
  }

  if (answer.responseMode === 'speaking_recording') {
    return Boolean(answer.recording);
  }

  if (answer.responseMode === 'file_upload') {
    return Boolean(answer.uploadedFile);
  }

  return false;
}

export function upsertAssessmentAnswer(
  answers: AssessmentAnswer[],
  nextAnswer: AssessmentAnswer
): AssessmentAnswer[] {
  const remainingAnswers = answers.filter((answer) => answer.questionId !== nextAnswer.questionId);
  return hasAnswerContent(nextAnswer) ? [...remainingAnswers, nextAnswer] : remainingAnswers;
}

export function getAnswerForQuestion(answers: AssessmentAnswer[], questionId: string) {
  return answers.find((answer) => answer.questionId === questionId) || null;
}

export function getRunnerProgress(assessment: AssignmentAssessment, answers: AssessmentAnswer[]) {
  return getAssessmentProgress(assessment, answers);
}
