import { describe, expect, it } from 'vitest';
import { createBlankAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import {
  countDraftQuestions,
  getDraftClassLabel,
  getDraftDueDateLabel,
  getDraftReadinessLabel,
  getDraftTitleLabel,
} from './authoringDraftSummary';

describe('authoringDraftSummary', () => {
  it('returns quiet Gmail-style labels for incomplete drafts', () => {
    const draft = createBlankAuthoringDraft('teacher-1');

    expect(getDraftTitleLabel(draft, 'Untitled draft')).toBe('Untitled draft');
    expect(getDraftClassLabel(draft, [], 'Missing class')).toBe('Missing class');
    expect(getDraftDueDateLabel(draft, 'Missing due date')).toBe('Missing due date');
    expect(getDraftReadinessLabel(draft)).toEqual({
      tone: 'warning',
      label: 'Needs details',
    });
  });

  it('summarizes title, class, due date, question count, and readiness', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    draft.title = 'Unit 2 Listening';
    draft.classId = 'class-1';
    draft.dueDate = '2026-06-30T10:00:00.000Z';
    draft.assessmentDraft.sections[0].questions[0] = {
      ...draft.assessmentDraft.sections[0].questions[0],
      prompt: 'Choose the correct answer.',
      options: [
        { key: 'A', text: 'A ticket' },
        { key: 'B', text: 'A book' },
      ],
      correctAnswer: 'A',
    };

    expect(getDraftTitleLabel(draft, 'Untitled draft')).toBe('Unit 2 Listening');
    expect(getDraftClassLabel(draft, [{ id: 'class-1', name: 'G7A' }], 'Missing class')).toBe(
      'G7A'
    );
    expect(getDraftDueDateLabel(draft, 'Missing due date')).toBe('2026-06-30T10:00:00.000Z');
    expect(countDraftQuestions(draft)).toBe(1);
    expect(getDraftReadinessLabel(draft)).toEqual({
      tone: 'ready',
      label: 'Ready',
    });
  });
});
