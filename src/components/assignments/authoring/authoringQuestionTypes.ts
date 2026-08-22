import type {
  AssessmentQuestionInput,
  AssessmentResponseMode,
} from '../../../../shared/assignmentAssessment';

export type AuthoringQuestionType =
  | 'multiple_choice'
  | 'multiple_select'
  | 'short_answer'
  | 'long_answer'
  | 'fill_blank'
  | 'matching'
  | 'ordering'
  | 'listening'
  | 'reading_section'
  | 'image_question'
  | 'speaking_recording'
  | 'file_upload';

export type AuthoringQuestionInput = AssessmentQuestionInput & {
  interactionType?: AuthoringQuestionType;
};

export const QUESTION_TYPE_OPTIONS: Array<{ value: AuthoringQuestionType; label: string }> = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'multiple_select', label: 'Multiple select' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'long_answer', label: 'Long answer' },
  { value: 'fill_blank', label: 'Fill in the blank' },
  { value: 'matching', label: 'Matching' },
  { value: 'ordering', label: 'Ordering' },
  { value: 'listening', label: 'Listening' },
  { value: 'reading_section', label: 'Reading section' },
  { value: 'image_question', label: 'Image question' },
];

function responseModeForQuestionType(type: AuthoringQuestionType): AssessmentResponseMode {
  if (type === 'long_answer') return 'long_answer';
  return type === 'multiple_choice' ? 'multiple_choice' : 'short_answer';
}

export function ensureQuestionTypeDefaults(
  question: AssessmentQuestionInput,
  type: AuthoringQuestionType
): AuthoringQuestionInput {
  const responseMode = responseModeForQuestionType(type);
  if (responseMode === 'multiple_choice') {
    return {
      ...question,
      interactionType: type,
      responseMode,
      options:
        question.options && question.options.length >= 4
          ? question.options
          : [
              { key: 'A', text: '' },
              { key: 'B', text: '' },
              { key: 'C', text: '' },
              { key: 'D', text: '' },
            ],
      correctAnswer: typeof question.correctAnswer === 'string' ? question.correctAnswer : 'A',
      acceptedAnswers: undefined,
      gradingMode: 'auto',
    };
  }
  return {
    ...question,
    interactionType: type,
    responseMode,
    options: undefined,
    correctAnswer: undefined,
    acceptedAnswers: question.acceptedAnswers || [],
    gradingMode: responseMode === 'short_answer' ? 'manual' : 'manual',
  };
}

export function updateChoiceOptionText(
  question: AuthoringQuestionInput,
  optionKey: string,
  text: string
): AuthoringQuestionInput {
  return {
    ...question,
    options: (question.options || []).map((option) =>
      option.key === optionKey ? { ...option, text } : option
    ),
  };
}
