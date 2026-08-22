import { describe, expect, it } from 'vitest';
import { addSectionToDraft } from '../../../../shared/assignmentAuthoring';
import {
  createInitialWorkbenchState,
  reducer,
  selectQuestion,
  setDraftTitle,
} from './authoringState';

describe('authoringState', () => {
  it('creates initial state with a selected first question', () => {
    const state = createInitialWorkbenchState('teacher-1');
    expect(state.selectedQuestionId).toBe(state.draft.assessmentDraft.sections[0].questions[0].id);
    expect(state.selectedQuestionIds).toEqual([state.selectedQuestionId]);
  });

  it('updates draft title and marks local changes pending', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const next = reducer(state, setDraftTitle('Unit 1'));
    expect(next.draft.title).toBe('Unit 1');
    expect(next.syncStatus).toBe('local_pending');
  });

  it('updates assignment settings without replacing the assessment draft', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const next = reducer(state, {
      type: 'update_draft_fields',
      fields: {
        classId: 'class-1',
        dueDate: '10:00 30/06/2026',
        attemptsAllowed: 2,
        proctoringMode: 'normal',
      },
    } as any);

    expect(next.draft).toMatchObject({
      classId: 'class-1',
      dueDate: '10:00 30/06/2026',
      attemptsAllowed: 2,
      proctoringMode: 'normal',
    });
    expect(next.draft.assessmentDraft).toBe(state.draft.assessmentDraft);
    expect(next.syncStatus).toBe('local_pending');
  });

  it('updates the selected question prompt and options', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const question = state.draft.assessmentDraft.sections[0].questions[0];

    const next = reducer(state, {
      type: 'update_question',
      questionId: question.id,
      question: {
        ...question,
        prompt: 'What does the speaker want?',
        options: [
          { key: 'A', text: 'A ticket' },
          { key: 'B', text: 'A book' },
        ],
        correctAnswer: 'B',
      },
    } as any);

    expect(next.draft.assessmentDraft.sections[0].questions[0]).toMatchObject({
      prompt: 'What does the speaker want?',
      options: [
        { key: 'A', text: 'A ticket' },
        { key: 'B', text: 'A book' },
      ],
      correctAnswer: 'B',
    });
    expect(next.syncStatus).toBe('local_pending');
  });

  it('selects one question or multi-selects questions', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const first = state.draft.assessmentDraft.sections[0].questions[0].id;
    const next = reducer(state, selectQuestion(first, true));
    expect(next.selectedQuestionIds).toEqual([first]);
  });

  it('selects the question targeted by a validation issue', () => {
    const initialState = createInitialWorkbenchState('teacher-1');
    const state = reducer(initialState, {
      type: 'apply_template',
      templateId: 'listening-practice',
    });
    const secondQuestion = state.draft.assessmentDraft.sections[0].questions[1];

    const next = reducer(state, {
      type: 'select_validation_issue',
      issue: {
        sectionId: state.draft.assessmentDraft.sections[0].id,
        questionId: secondQuestion.id,
      },
    });

    expect(next.selectedSectionId).toBe(state.draft.assessmentDraft.sections[0].id);
    expect(next.selectedQuestionId).toBe(secondQuestion.id);
    expect(next.selectedQuestionIds).toEqual([secondQuestion.id]);
  });

  it('adds a section and selects its first question', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const next = reducer(state, {
      type: 'add_section',
      title: 'Writing',
      skill: 'writing',
      instructions: 'Answer in paragraphs.',
    });

    const section = next.draft.assessmentDraft.sections.at(-1)!;
    expect(section.title).toBe('Writing');
    expect(next.selectedSectionId).toBe(section.id);
    expect(next.selectedQuestionId).toBe(section.questions[0].id);
    expect(next.syncStatus).toBe('local_pending');
  });

  it('adds a question to the selected section', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const sectionId = state.selectedSectionId;
    const next = reducer(state, { type: 'add_question', sectionId });

    expect(next.draft.assessmentDraft.sections[0].questions).toHaveLength(2);
    expect(next.selectedQuestionId).toBe(next.draft.assessmentDraft.sections[0].questions[1].id);
  });

  it('moves selected questions to another section and keeps them selected', () => {
    const state = reducer(createInitialWorkbenchState('teacher-1'), {
      type: 'apply_template',
      templateId: 'mixed-skills-homework',
    });
    const sourceQuestions = state.draft.assessmentDraft.sections[0].questions.slice(0, 1);
    const targetSectionId = state.draft.assessmentDraft.sections[1].id;
    const next = reducer(
      { ...state, selectedQuestionIds: sourceQuestions.map((question) => question.id) },
      {
        type: 'move_selected_to_section',
        questionIds: sourceQuestions.map((question) => question.id),
        targetSectionId,
      }
    );

    expect(next.selectedSectionId).toBe(targetSectionId);
    expect(next.selectedQuestionIds).toEqual(sourceQuestions.map((question) => question.id));
  });

  it('deletes selected questions and selects a remaining question', () => {
    const state = reducer(createInitialWorkbenchState('teacher-1'), {
      type: 'apply_template',
      templateId: 'listening-practice',
    });
    const deleteIds = state.draft.assessmentDraft.sections[0].questions
      .slice(1)
      .map((question) => question.id);
    const next = reducer(state, { type: 'delete_questions', questionIds: deleteIds });

    expect(next.draft.assessmentDraft.sections[0].questions).toHaveLength(1);
    expect(next.selectedQuestionId).toBe(next.draft.assessmentDraft.sections[0].questions[0].id);
  });
});

it('reorders a section through the reducer', () => {
  const initial = createInitialWorkbenchState('teacher-1');
  const draft = addSectionToDraft(initial.draft, { title: 'Reading', skill: 'reading' });
  const second = draft.assessmentDraft.sections[1];
  const state = { ...initial, draft };

  const next = reducer(state, {
    type: 'reorder_section',
    sectionId: second.id,
    index: 0,
  });

  expect(next.draft.assessmentDraft.sections[0].id).toBe(second.id);
  expect(next.syncStatus).toBe('local_pending');
});
