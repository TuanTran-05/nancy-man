import {
  createBlankAuthoringDraft,
  applyStructureTemplate,
  bulkUpdateQuestions,
  duplicateQuestionInDraft,
  moveQuestionInDraft,
  reorderSectionInDraft,
  insertBankQuestionSnapshot,
  insertMediaBankSnapshot,
  updateAuthoringDraftFields,
  updateQuestionInDraft,
  applyAuthoringImportPreview,
  addQuestionToSection,
  addSectionToDraft,
  deleteQuestionsFromDraft,
  moveQuestionsToSection,
  updateSectionInDraft,
  type AuthoringDraftFieldUpdate,
  type AssignmentAuthoringDraft,
  type AssessmentMediaBankItem,
  type AssessmentQuestionBankItem,
  type AuthoringValidationIssue,
  type AuthoringImportMode,
  type AuthoringImportPreview,
  type AuthoringBulkQuestionUpdate,
} from '../../../../shared/assignmentAuthoring';
import type { AssessmentSkill } from '../../../../shared/assignmentAssessment';
import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';
import type { AuthoringQuestionType } from './authoringQuestionTypes';
import { ensureQuestionTypeDefaults } from './authoringQuestionTypes';

export type AuthoringSyncStatus =
  | 'idle'
  | 'local_pending'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'conflict';

export interface AuthoringWorkbenchState {
  draft: AssignmentAuthoringDraft;
  selectedSectionId: string;
  selectedQuestionId: string;
  selectedQuestionIds: string[];
  syncStatus: AuthoringSyncStatus;
  errors: string[];
}

export type AuthoringAction =
  | { type: 'set_draft'; draft: AssignmentAuthoringDraft }
  | { type: 'set_title'; title: string }
  | { type: 'update_draft_fields'; fields: AuthoringDraftFieldUpdate }
  | { type: 'update_question'; questionId: string; question: AssessmentQuestionInput }
  | { type: 'select_question'; questionId: string; multi: boolean }
  | { type: 'set_sync_status'; syncStatus: AuthoringSyncStatus }
  | { type: 'set_errors'; errors: string[] }
  | { type: 'apply_template'; templateId: string }
  | { type: 'duplicate_question'; questionId: string }
  | { type: 'move_question'; questionId: string; direction: 'up' | 'down' }
  | { type: 'bulk_update'; questionIds: string[]; update: AuthoringBulkQuestionUpdate }
  | { type: 'insert_bank_question'; sectionId: string; item: AssessmentQuestionBankItem }
  | { type: 'insert_media'; questionId: string; item: AssessmentMediaBankItem }
  | {
      type: 'select_validation_issue';
      issue: Pick<AuthoringValidationIssue, 'sectionId' | 'questionId'>;
    }
  | { type: 'apply_import_preview'; preview: AuthoringImportPreview; mode: AuthoringImportMode }
  | { type: 'select_section'; sectionId: string }
  | { type: 'add_section'; title: string; skill: AssessmentSkill; instructions?: string }
  | { type: 'add_question'; sectionId: string; questionType?: AuthoringQuestionType }
  | { type: 'delete_questions'; questionIds: string[] }
  | { type: 'move_selected_to_section'; questionIds: string[]; targetSectionId: string }
  | { type: 'update_section'; sectionId: string; section: any }
  | {
      type: 'reorder_question';
      questionId: string;
      destination: { sectionId: string; index: number };
    }
  | { type: 'reorder_section'; sectionId: string; index: number };

export function createInitialWorkbenchState(ownerUid: string): AuthoringWorkbenchState {
  const draft = createBlankAuthoringDraft(ownerUid);
  const firstSection = draft.assessmentDraft.sections[0];
  const firstQuestion = firstSection.questions[0];
  return {
    draft,
    selectedSectionId: firstSection.id,
    selectedQuestionId: firstQuestion.id,
    selectedQuestionIds: [firstQuestion.id],
    syncStatus: 'idle',
    errors: [],
  };
}

export function setDraftTitle(title: string): AuthoringAction {
  return { type: 'set_title', title };
}

export function selectQuestion(questionId: string, multi = false): AuthoringAction {
  return { type: 'select_question', questionId, multi };
}

export function reducer(
  state: AuthoringWorkbenchState,
  action: AuthoringAction
): AuthoringWorkbenchState {
  if (action.type === 'set_draft') {
    const firstSection = action.draft.assessmentDraft.sections[0];
    const firstQuestion = firstSection.questions[0];
    return {
      ...state,
      draft: action.draft,
      selectedSectionId: firstSection.id,
      selectedQuestionId: firstQuestion.id,
      selectedQuestionIds: [firstQuestion.id],
      syncStatus: 'synced',
    };
  }
  return realReducer(state, action);
}

function realReducer(
  state: AuthoringWorkbenchState,
  action: AuthoringAction
): AuthoringWorkbenchState {
  if (action.type === 'set_title') {
    return {
      ...state,
      draft: updateAuthoringDraftFields(state.draft, { title: action.title }),
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'update_draft_fields') {
    return {
      ...state,
      draft: updateAuthoringDraftFields(state.draft, action.fields),
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'update_question') {
    return {
      ...state,
      draft: updateQuestionInDraft(state.draft, action.questionId, action.question),
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'select_question') {
    const selectedQuestionIds =
      action.multi && !state.selectedQuestionIds.includes(action.questionId)
        ? [...state.selectedQuestionIds, action.questionId]
        : [action.questionId];
    return {
      ...state,
      selectedQuestionId: action.questionId,
      selectedQuestionIds,
    };
  }
  if (action.type === 'select_validation_issue') {
    const targetSection = state.draft.assessmentDraft.sections.find(
      (section) => section.id === action.issue.sectionId
    );
    if (!targetSection) return state;
    const targetQuestion =
      targetSection.questions.find((question) => question.id === action.issue.questionId) ||
      targetSection.questions[0];
    return {
      ...state,
      selectedSectionId: targetSection.id,
      selectedQuestionId: targetQuestion?.id || state.selectedQuestionId,
      selectedQuestionIds: targetQuestion ? [targetQuestion.id] : state.selectedQuestionIds,
    };
  }
  if (action.type === 'set_sync_status') {
    return { ...state, syncStatus: action.syncStatus };
  }
  if (action.type === 'set_errors') {
    return { ...state, errors: action.errors };
  }
  if (action.type === 'apply_template') {
    const draft = applyStructureTemplate(state.draft, action.templateId);
    const firstSection = draft.assessmentDraft.sections[0];
    const firstQuestion = firstSection.questions[0];
    return {
      ...state,
      draft,
      selectedSectionId: firstSection.id,
      selectedQuestionId: firstQuestion.id,
      selectedQuestionIds: [firstQuestion.id],
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'duplicate_question') {
    return {
      ...state,
      draft: duplicateQuestionInDraft(state.draft, action.questionId),
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'bulk_update') {
    return {
      ...state,
      draft: bulkUpdateQuestions(state.draft, action.questionIds, action.update),
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'move_question') {
    for (const section of state.draft.assessmentDraft.sections) {
      const currentIndex = section.questions.findIndex(
        (question) => question.id === action.questionId
      );
      if (currentIndex < 0) continue;
      const nextIndex = action.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= section.questions.length) return state;
      return {
        ...state,
        draft: moveQuestionInDraft(state.draft, action.questionId, {
          sectionId: section.id,
          index: nextIndex,
        }),
        syncStatus: 'local_pending',
      };
    }
    return state;
  }
  if (action.type === 'apply_import_preview') {
    const draft = applyAuthoringImportPreview(state.draft, action.preview, action.mode);
    const firstImportedSection =
      action.mode === 'replace'
        ? draft.assessmentDraft.sections[0]
        : draft.assessmentDraft.sections[state.draft.assessmentDraft.sections.length];
    const firstQuestion = firstImportedSection?.questions[0];
    return {
      ...state,
      draft,
      selectedSectionId: firstImportedSection?.id || state.selectedSectionId,
      selectedQuestionId: firstQuestion?.id || state.selectedQuestionId,
      selectedQuestionIds: firstQuestion ? [firstQuestion.id] : state.selectedQuestionIds,
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'insert_bank_question') {
    return {
      ...state,
      draft: insertBankQuestionSnapshot(state.draft, action.sectionId, action.item),
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'insert_media') {
    return {
      ...state,
      draft: insertMediaBankSnapshot(state.draft, action.questionId, action.item),
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'select_section') {
    const section = state.draft.assessmentDraft.sections.find(
      (item) => item.id === action.sectionId
    );
    if (!section) return state;
    const firstQuestion = section.questions[0];
    return {
      ...state,
      selectedSectionId: section.id,
      selectedQuestionId: firstQuestion?.id || state.selectedQuestionId,
      selectedQuestionIds: firstQuestion ? [firstQuestion.id] : state.selectedQuestionIds,
    };
  }
  if (action.type === 'add_section') {
    const draft = addSectionToDraft(state.draft, action);
    const section = draft.assessmentDraft.sections.at(-1)!;
    return {
      ...state,
      draft,
      selectedSectionId: section.id,
      selectedQuestionId: section.questions[0].id,
      selectedQuestionIds: [section.questions[0].id],
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'add_question') {
    let draft = addQuestionToSection(state.draft, action.sectionId);
    const section = draft.assessmentDraft.sections.find((item) => item.id === action.sectionId)!;
    let question = section.questions.at(-1)!;
    if (action.questionType) {
      question = ensureQuestionTypeDefaults(question, action.questionType);
      const sections = draft.assessmentDraft.sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          questions: s.questions.map((q) => (q.id === question.id ? question : q)),
        };
      });
      draft = {
        ...draft,
        assessmentDraft: {
          ...draft.assessmentDraft,
          sections,
        },
      };
    }
    return {
      ...state,
      draft,
      selectedSectionId: section.id,
      selectedQuestionId: question.id,
      selectedQuestionIds: [question.id],
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'delete_questions') {
    const draft = deleteQuestionsFromDraft(state.draft, action.questionIds);
    const section =
      draft.assessmentDraft.sections.find((item) => item.id === state.selectedSectionId) ||
      draft.assessmentDraft.sections[0];
    const question = section.questions[0];
    return {
      ...state,
      draft,
      selectedSectionId: section.id,
      selectedQuestionId: question.id,
      selectedQuestionIds: [question.id],
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'move_selected_to_section') {
    const draft = moveQuestionsToSection(state.draft, action.questionIds, action.targetSectionId);
    return {
      ...state,
      draft,
      selectedSectionId: action.targetSectionId,
      selectedQuestionId: action.questionIds[0] || state.selectedQuestionId,
      selectedQuestionIds: action.questionIds,
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'update_section') {
    const draft = updateSectionInDraft(state.draft, action.sectionId, action.section);
    return {
      ...state,
      draft,
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'reorder_question') {
    return {
      ...state,
      draft: moveQuestionInDraft(state.draft, action.questionId, action.destination),
      selectedSectionId: action.destination.sectionId,
      selectedQuestionId: action.questionId,
      selectedQuestionIds: [action.questionId],
      syncStatus: 'local_pending',
    };
  }
  if (action.type === 'reorder_section') {
    const draft = reorderSectionInDraft(state.draft, action.sectionId, action.index);
    return {
      ...state,
      draft,
      selectedSectionId: action.sectionId,
      syncStatus: 'local_pending',
    };
  }
  return state;
}
