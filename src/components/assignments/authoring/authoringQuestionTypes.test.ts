import { describe, expect, it } from 'vitest';
import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';
import {
  QUESTION_TYPE_OPTIONS,
  ensureQuestionTypeDefaults,
  updateChoiceOptionText,
} from './authoringQuestionTypes';

const baseQuestion: AssessmentQuestionInput = {
  id: 'question-1',
  skill: 'reading',
  prompt: '',
  responseMode: 'short_answer',
  media: [],
  points: 1,
};

describe('authoringQuestionTypes', () => {
  it('exposes the approved question type order', () => {
    expect(QUESTION_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'multiple_choice',
      'multiple_select',
      'short_answer',
      'long_answer',
      'fill_blank',
      'matching',
      'ordering',
      'listening',
      'reading_section',
      'image_question',
    ]);
  });

  it('creates multiple-choice defaults when switching modes', () => {
    const next = ensureQuestionTypeDefaults(baseQuestion, 'multiple_choice');
    expect(next.responseMode).toBe('multiple_choice');
    expect(next.options).toEqual([
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' },
    ]);
    expect(next.correctAnswer).toBe('A');
    expect(next.gradingMode).toBe('auto');
  });

  it('updates option text without changing option order', () => {
    const question = ensureQuestionTypeDefaults(baseQuestion, 'multiple_choice');
    const next = updateChoiceOptionText(question, 'B', 'Second answer');
    expect(next.options?.map((option) => option.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(next.options?.[1].text).toBe('Second answer');
  });
});
