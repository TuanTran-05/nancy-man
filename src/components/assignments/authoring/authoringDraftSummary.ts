import {
  getAuthoringValidationIssues,
  type AssignmentAuthoringDraft,
} from '../../../../shared/assignmentAuthoring';

export interface DraftClassOption {
  id: string;
  name: string;
}

export type DraftReadinessTone = 'ready' | 'warning';

export function getDraftTitleLabel(draft: AssignmentAuthoringDraft, fallback: string) {
  return draft.title.trim() || fallback;
}

export function getDraftClassLabel(
  draft: AssignmentAuthoringDraft,
  classes: DraftClassOption[],
  fallback: string
) {
  if (!draft.classId.trim()) return fallback;
  return classes.find((classItem) => classItem.id === draft.classId)?.name || draft.classId;
}

export function getDraftDueDateLabel(draft: AssignmentAuthoringDraft, fallback: string) {
  return draft.dueDate.trim() || fallback;
}

export function countDraftQuestions(draft: AssignmentAuthoringDraft) {
  return draft.assessmentDraft.sections.reduce(
    (total, section) => total + section.questions.length,
    0
  );
}

export function getDraftReadinessLabel(draft: AssignmentAuthoringDraft): {
  tone: DraftReadinessTone;
  label: string;
} {
  const issues = getAuthoringValidationIssues(draft);
  if (issues.length === 0) {
    return { tone: 'ready', label: 'Ready' };
  }
  return { tone: 'warning', label: 'Needs details' };
}
