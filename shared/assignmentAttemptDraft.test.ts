import { describe, expect, it } from 'vitest';
import type { AssignmentAssessment } from './assignmentAssessment';
import {
  buildAssignmentAttemptDraftId,
  chooseNewestAssignmentAttemptDraft,
  normalizeAssignmentAttemptDraftPayload,
  resolveNextAttemptNumber,
} from './assignmentAttemptDraft';

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
      id: 's1',
      title: 'Reading',
      skill: 'reading',
      questions: [
        {
          id: 'q1',
          skill: 'reading',
          prompt: 'Choose one.',
          responseMode: 'multiple_choice',
          media: [],
          options: [
            { key: 'A', text: 'A' },
            { key: 'B', text: 'B' },
          ],
        },
        {
          id: 'q2',
          skill: 'writing',
          prompt: 'Explain.',
          responseMode: 'long_answer',
          media: [],
        },
      ],
    },
  ],
};

describe('assignment attempt draft helpers', () => {
  it('builds a deterministic DocumentStore-safe draft id', () => {
    expect(buildAssignmentAttemptDraftId('assignment/1', 'student/1')).toBe(
      'assignment_1_student_1'
    );
  });

  it('normalizes Assessment v2 answers and removes unknown question answers', () => {
    const payload = normalizeAssignmentAttemptDraftPayload({
      assignment: {
        id: 'assignment-1',
        type: 'quiz',
        assessment,
      },
      raw: {
        content: 'ignored for assessment',
        quizAnswers: [{ questionId: 1, selectedOption: 'A' }],
        assessmentAnswers: [
          { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'A' },
          { questionId: 'missing', responseMode: 'multiple_choice', selectedOption: 'B' },
          { questionId: 'q2', responseMode: 'long_answer', textAnswer: '  My answer  ' },
        ],
      },
    });

    expect(payload).toEqual({
      content: '',
      quizAnswers: [],
      assessmentAnswers: [
        { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'A' },
        { questionId: 'q2', responseMode: 'long_answer', textAnswer: 'My answer' },
      ],
    });
  });

  it('normalizes legacy quiz and essay payloads independently', () => {
    expect(
      normalizeAssignmentAttemptDraftPayload({
        assignment: { id: 'quiz-1', type: 'quiz', questions: [{ id: 1 }, { id: 2 }] },
        raw: {
          content: 'ignored',
          quizAnswers: [
            { questionId: 1, selectedOption: ' A ' },
            { questionId: 3, selectedOption: 'C' },
          ],
          assessmentAnswers: [{ questionId: 'q1' }],
        },
      })
    ).toEqual({
      content: '',
      quizAnswers: [{ questionId: 1, selectedOption: 'A' }],
      assessmentAnswers: [],
    });

    expect(
      normalizeAssignmentAttemptDraftPayload({
        assignment: { id: 'essay-1', type: 'essay' },
        raw: { content: '  Essay body  ', quizAnswers: [{ questionId: 1, selectedOption: 'A' }] },
      })
    ).toEqual({
      content: 'Essay body',
      quizAnswers: [],
      assessmentAnswers: [],
    });
  });

  it('chooses the newest draft by updatedAt', () => {
    const older = { updatedAt: '2026-06-12T01:00:00.000Z', content: 'old' };
    const newer = { updatedAt: '2026-06-12T02:00:00.000Z', content: 'new' };

    expect(chooseNewestAssignmentAttemptDraft(older, newer)).toBe(newer);
    expect(chooseNewestAssignmentAttemptDraft(newer, older)).toBe(newer);
  });

  it('resolves the next attempt number from existing submissions', () => {
    expect(resolveNextAttemptNumber([])).toBe(1);
    expect(resolveNextAttemptNumber([{ attemptNumber: 1 }, { attemptNumber: 3 }])).toBe(4);
  });
});
