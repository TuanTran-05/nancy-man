import type {
  AssessmentQuestionInput,
  AssessmentResponseMode,
} from '../../../../shared/assignmentAssessment';

interface ResponseModeEditorProps {
  question: AssessmentQuestionInput;
  onChange: (question: AssessmentQuestionInput) => void;
}

const editableModes: AssessmentResponseMode[] = [
  'multiple_choice',
  'short_answer',
  'speaking_recording',
];

function setMode(
  question: AssessmentQuestionInput,
  responseMode: AssessmentResponseMode
): AssessmentQuestionInput {
  if (responseMode === 'multiple_choice') {
    return {
      ...question,
      responseMode,
      options:
        question.options && question.options.length >= 2
          ? question.options
          : [
              { key: 'A', text: '' },
              { key: 'B', text: '' },
            ],
      correctAnswer: typeof question.correctAnswer === 'string' ? question.correctAnswer : 'A',
      acceptedAnswers: undefined,
      gradingMode: 'auto',
    };
  }
  if (responseMode === 'speaking_recording') {
    return {
      ...question,
      responseMode,
      options: undefined,
      correctAnswer: undefined,
      acceptedAnswers: undefined,
      gradingMode: 'manual',
    };
  }
  return {
    ...question,
    responseMode,
    options: undefined,
    correctAnswer: undefined,
    acceptedAnswers: question.acceptedAnswers || [],
    gradingMode: 'manual',
  };
}

export function ResponseModeEditor({ question, onChange }: ResponseModeEditorProps) {
  const options = question.options || [];

  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-slate-600">
        Response mode
        <select
          aria-label="Response mode"
          value={question.responseMode}
          onChange={(event) =>
            onChange(setMode(question, event.target.value as AssessmentResponseMode))
          }
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
        >
          {editableModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode === 'multiple_choice'
                ? 'Multiple choice'
                : mode === 'short_answer'
                  ? 'Short answer'
                  : 'Speaking recording'}
            </option>
          ))}
        </select>
      </label>

      {question.responseMode === 'multiple_choice' ? (
        <div className="space-y-2">
          {options.map((option, index) => (
            <label key={option.key} className="block text-xs font-semibold text-slate-600">
              Option {option.key}
              <input
                aria-label={`Option ${option.key}`}
                value={option.text}
                onChange={(event) => {
                  const nextOptions = [...options];
                  nextOptions[index] = { ...option, text: event.target.value };
                  onChange({ ...question, options: nextOptions });
                }}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              />
            </label>
          ))}
          <label className="block text-xs font-semibold text-slate-600">
            Correct answer
            <select
              aria-label="Correct answer"
              value={typeof question.correctAnswer === 'string' ? question.correctAnswer : 'A'}
              onChange={(event) => onChange({ ...question, correctAnswer: event.target.value })}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
            >
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.key}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : question.responseMode === 'short_answer' || question.responseMode === 'long_answer' ? (
        <label className="block text-xs font-semibold text-slate-600">
          Accepted answers
          <input
            aria-label="Accepted answers"
            value={(question.acceptedAnswers || []).join(', ')}
            onChange={(event) =>
              onChange({
                ...question,
                acceptedAnswers: event.target.value
                  .split(',')
                  .map((answer) => answer.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Optional exact answers, separated by commas"
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
          />
        </label>
      ) : null}
    </div>
  );
}
