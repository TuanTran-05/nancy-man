import { describe, expect, it } from 'vitest';
import type { AssignmentAssessment } from '../../../../shared/assignmentAssessment';
import {
  buildAssessmentGradingDraft,
  updateAssessmentQuestionDraft,
  buildAssessmentGradePayload,
} from './assessmentReviewState';

const assessment: AssignmentAssessment = {
  version: 2,
  mode: 'practice',
  settings: {
    allowFreeMediaPlayback: true,
    showCorrectAnswersAfterSubmit: false,
    showTranscriptDuringAttempt: false,
  },
  sections: [
    {
      id: 'reading',
      title: 'Reading',
      skill: 'reading',
      questions: [
        {
          id: 'q1',
          skill: 'reading',
          prompt: 'Choose.',
          responseMode: 'multiple_choice',
          media: [],
          points: 2,
          options: [
            { key: 'A', text: 'A' },
            { key: 'B', text: 'B' },
          ],
        },
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
};

describe('assessment review state', () => {
  it('builds a grading draft from existing score', () => {
    expect(
      buildAssessmentGradingDraft(assessment, {
        totalPoints: 2,
        maxPoints: 5,
        questionScores: [{ questionId: 'q1', pointsAwarded: 2, maxPoints: 2, gradingMode: 'auto' }],
      })
    ).toEqual({
      q1: { questionId: 'q1', pointsAwarded: '2', feedback: '' },
      q2: { questionId: 'q2', pointsAwarded: '0', feedback: '' },
    });
  });

  it('updates one question draft without losing siblings', () => {
    const draft = buildAssessmentGradingDraft(assessment, null);
    expect(
      updateAssessmentQuestionDraft(draft, 'q2', { pointsAwarded: '2.5', feedback: 'Nice' })
    ).toEqual({
      q1: { questionId: 'q1', pointsAwarded: '0', feedback: '' },
      q2: { questionId: 'q2', pointsAwarded: '2.5', feedback: 'Nice' },
    });
  });

  it('builds a grade payload from draft values', () => {
    const draft = updateAssessmentQuestionDraft(
      buildAssessmentGradingDraft(assessment, null),
      'q2',
      {
        pointsAwarded: '2.5',
        feedback: 'Nice',
      }
    );
    expect(buildAssessmentGradePayload(draft)).toEqual([
      { questionId: 'q1', pointsAwarded: 0 },
      { questionId: 'q2', pointsAwarded: 2.5, feedback: 'Nice' },
    ]);
  });
});
