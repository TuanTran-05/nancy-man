import { describe, expect, it } from 'vitest';
import {
  addQuestionToSection,
  addSectionToDraft,
  buildAdvancedAssignmentPayload,
  createDefaultAssessmentDraft,
  duplicateQuestionInSection,
  validateAssessmentDraft,
} from './assessmentBuilderState';

describe('assessment builder state', () => {
  it('creates a listening/reading ready draft with default assessment settings', () => {
    const draft = createDefaultAssessmentDraft();

    expect(draft.assessment.version).toBe(2);
    expect(draft.assessment.mode).toBe('practice');
    expect(draft.assessment.settings).toEqual({
      allowFreeMediaPlayback: true,
      showCorrectAnswersAfterSubmit: false,
      showTranscriptDuringAttempt: false,
    });
    expect(draft.assessment.sections).toHaveLength(1);
    expect(draft.assessment.sections[0].skill).toBe('listening');
  });

  it('adds sections and questions with unique ids', () => {
    const draft = createDefaultAssessmentDraft();
    const withReading = addSectionToDraft(draft, 'reading');
    const withQuestion = addQuestionToSection(
      withReading,
      withReading.assessment.sections[1].id,
      'short_answer'
    );

    expect(withQuestion.assessment.sections).toHaveLength(2);
    expect(withQuestion.assessment.sections[1].questions).toHaveLength(2);
    expect(
      new Set(
        withQuestion.assessment.sections.flatMap((section) =>
          section.questions.map((question) => question.id)
        )
      ).size
    ).toBe(3);
  });

  it('validates missing basics and incomplete questions', () => {
    const draft = createDefaultAssessmentDraft();

    expect(validateAssessmentDraft(draft)).toEqual([
      'Title is required.',
      'Class is required.',
      'Due date is required.',
      'Question 1 prompt is required.',
      'Question 1 needs at least two options.',
    ]);
  });

  it('builds an assignment-create payload with assessment v2', () => {
    const draft = createDefaultAssessmentDraft();
    const question = draft.assessment.sections[0].questions[0];
    const completeDraft = {
      ...draft,
      title: 'Listening quiz',
      description: 'Unit 1',
      dueDate: '2026-06-30T10:00:00.000Z',
      classId: 'class-1',
      assessment: {
        ...draft.assessment,
        sections: [
          {
            ...draft.assessment.sections[0],
            questions: [
              {
                ...question,
                prompt: 'What does the speaker want?',
                media: [
                  {
                    id: 'media-1',
                    type: 'audio' as const,
                    source: 'external_url' as const,
                    url: 'https://cdn.example.com/audio.mp3',
                    displayMode: 'inline' as const,
                  },
                ],
                options: [
                  { key: 'A', text: 'A ticket' },
                  { key: 'B', text: 'A book' },
                ],
                correctAnswer: 'B',
              },
            ],
          },
        ],
      },
    };

    expect(validateAssessmentDraft(completeDraft)).toEqual([]);
    expect(buildAdvancedAssignmentPayload(completeDraft)).toEqual({
      title: 'Listening quiz',
      description: 'Unit 1',
      dueDate: '2026-06-30T10:00:00.000Z',
      classId: 'class-1',
      type: 'quiz',
      questions: [],
      attemptsAllowed: 1,
      proctoringMode: 'strict',
      assessment: completeDraft.assessment,
    });
  });

  it('normalizes display due dates before building the API payload', () => {
    const draft = createDefaultAssessmentDraft();
    const completeDraft = {
      ...draft,
      title: 'Listening quiz',
      dueDate: '10:30 30/06/2026',
      classId: 'class-1',
      assessment: {
        ...draft.assessment,
        sections: [
          {
            ...draft.assessment.sections[0],
            questions: [
              {
                ...draft.assessment.sections[0].questions[0],
                prompt: 'What does the speaker want?',
                options: [
                  { key: 'A', text: 'A ticket' },
                  { key: 'B', text: 'A book' },
                ],
              },
            ],
          },
        ],
      },
    };

    expect(buildAdvancedAssignmentPayload(completeDraft).dueDate).toBe('2026-06-30T03:30:00.000Z');
  });

  it('duplicates a question in the same section with a fresh id', () => {
    const draft = createDefaultAssessmentDraft();
    const section = draft.assessment.sections[0];
    const question = section.questions[0];
    const withContent = {
      ...draft,
      assessment: {
        ...draft.assessment,
        sections: [
          {
            ...section,
            questions: [
              {
                ...question,
                prompt: 'Original prompt',
                options: [
                  { key: 'A', text: 'A ticket' },
                  { key: 'B', text: 'A book' },
                ],
                correctAnswer: 'B',
              },
            ],
          },
        ],
      },
    };

    const duplicated = duplicateQuestionInSection(withContent, section.id, question.id);
    const questions = duplicated.assessment.sections[0].questions;

    expect(questions).toHaveLength(2);
    expect(questions[1]).toMatchObject({
      prompt: 'Original prompt',
      options: [
        { key: 'A', text: 'A ticket' },
        { key: 'B', text: 'A book' },
      ],
      correctAnswer: 'B',
    });
    expect(questions[1].id).not.toBe(question.id);
  });
});
