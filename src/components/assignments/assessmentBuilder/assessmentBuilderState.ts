import type {
  AssignmentAssessmentInput,
  AssessmentQuestionInput,
  AssessmentResponseMode,
  AssessmentSkill,
  QuestionSkill,
} from '../../../../shared/assignmentAssessment';
import type { AssignmentProctoringMode } from '../../../../shared/assignmentProctoring';
import { isApiDateTime, userDateTimeToApiIso } from '../../../../shared/dateTimeFormat';

let nextDraftId = 1;

function draftId(prefix: string) {
  const id = `${prefix}-${nextDraftId}`;
  nextDraftId += 1;
  return id;
}

export interface AdvancedAssignmentDraft {
  title: string;
  description: string;
  dueDate: string;
  classId: string;
  attemptsAllowed: number;
  proctoringMode: AssignmentProctoringMode;
  assessment: AssignmentAssessmentInput;
}

export function createDefaultQuestion(
  responseMode: AssessmentResponseMode = 'multiple_choice'
): AssessmentQuestionInput {
  return {
    id: draftId('question'),
    skill: 'listening',
    prompt: '',
    responseMode,
    media: [],
    points: 1,
    ...(responseMode === 'multiple_choice'
      ? {
          options: [
            { key: 'A', text: '' },
            { key: 'B', text: '' },
          ],
          correctAnswer: 'A',
          gradingMode: 'auto' as const,
        }
      : {
          acceptedAnswers: [],
          gradingMode: 'manual' as const,
        }),
  };
}

export function createDefaultSection(skill: AssessmentSkill = 'listening') {
  const questionSkill: QuestionSkill = skill === 'mixed' ? 'listening' : skill;
  return {
    id: draftId('section'),
    title: skill === 'reading' ? 'Reading' : 'Listening',
    skill,
    instructions: '',
    questions: [{ ...createDefaultQuestion('multiple_choice'), skill: questionSkill }],
  };
}

export function createDefaultAssessmentDraft(): AdvancedAssignmentDraft {
  return {
    title: '',
    description: '',
    dueDate: '',
    classId: '',
    attemptsAllowed: 1,
    proctoringMode: 'strict',
    assessment: {
      version: 2,
      mode: 'practice',
      settings: {
        allowFreeMediaPlayback: true,
        showCorrectAnswersAfterSubmit: false,
        showTranscriptDuringAttempt: false,
      },
      sections: [createDefaultSection('listening')],
    },
  };
}

export function addSectionToDraft(
  draft: AdvancedAssignmentDraft,
  skill: AssessmentSkill
): AdvancedAssignmentDraft {
  return {
    ...draft,
    assessment: {
      ...draft.assessment,
      sections: [...draft.assessment.sections, createDefaultSection(skill)],
    },
  };
}

export function addQuestionToSection(
  draft: AdvancedAssignmentDraft,
  sectionId: string,
  responseMode: AssessmentResponseMode
): AdvancedAssignmentDraft {
  return {
    ...draft,
    assessment: {
      ...draft.assessment,
      sections: draft.assessment.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: [
                ...section.questions,
                {
                  ...createDefaultQuestion(responseMode),
                  skill: section.skill === 'mixed' ? 'listening' : section.skill,
                },
              ],
            }
          : section
      ),
    },
  };
}

export function duplicateQuestionInSection(
  draft: AdvancedAssignmentDraft,
  sectionId: string,
  questionId: string
): AdvancedAssignmentDraft {
  return {
    ...draft,
    assessment: {
      ...draft.assessment,
      sections: draft.assessment.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const questionIndex = section.questions.findIndex((question) => question.id === questionId);
        if (questionIndex < 0) return section;
        const sourceQuestion = section.questions[questionIndex];
        const duplicatedQuestion: AssessmentQuestionInput = {
          ...sourceQuestion,
          id: draftId('question'),
          options: sourceQuestion.options
            ? sourceQuestion.options.map((option) => ({ ...option }))
            : undefined,
          media: sourceQuestion.media ? sourceQuestion.media.map((item) => ({ ...item })) : [],
          acceptedAnswers: sourceQuestion.acceptedAnswers
            ? [...sourceQuestion.acceptedAnswers]
            : sourceQuestion.acceptedAnswers,
        };
        return {
          ...section,
          questions: [
            ...section.questions.slice(0, questionIndex + 1),
            duplicatedQuestion,
            ...section.questions.slice(questionIndex + 1),
          ],
        };
      }),
    },
  };
}

export function validateAssessmentDraft(draft: AdvancedAssignmentDraft): string[] {
  const errors: string[] = [];
  if (!draft.title.trim()) errors.push('Title is required.');
  if (!draft.classId.trim()) errors.push('Class is required.');
  if (!draft.dueDate.trim()) {
    errors.push('Due date is required.');
  } else {
    try {
      normalizeDraftDueDate(draft.dueDate);
    } catch {
      errors.push('Due date format is invalid.');
    }
  }

  let questionNumber = 1;
  for (const section of draft.assessment.sections) {
    if (!section.title.trim()) errors.push(`Section ${section.id} title is required.`);
    for (const question of section.questions) {
      if (!question.prompt.trim()) errors.push(`Question ${questionNumber} prompt is required.`);
      if (question.responseMode === 'multiple_choice') {
        const options = question.options || [];
        if (options.length < 2 || options.some((option) => !option.text.trim())) {
          errors.push(`Question ${questionNumber} needs at least two options.`);
        }
        if (!question.correctAnswer) {
          errors.push(`Question ${questionNumber} correct answer is required.`);
        }
      }
      questionNumber += 1;
    }
  }
  return errors;
}

function normalizeDraftDueDate(value: string) {
  const trimmed = value.trim();
  if (isApiDateTime(trimmed)) return trimmed;
  return userDateTimeToApiIso(trimmed);
}

export function buildAdvancedAssignmentPayload(draft: AdvancedAssignmentDraft) {
  return {
    title: draft.title,
    description: draft.description,
    dueDate: normalizeDraftDueDate(draft.dueDate),
    classId: draft.classId,
    type: 'quiz' as const,
    questions: [],
    attemptsAllowed: draft.attemptsAllowed,
    proctoringMode: draft.proctoringMode,
    assessment: draft.assessment,
  };
}
