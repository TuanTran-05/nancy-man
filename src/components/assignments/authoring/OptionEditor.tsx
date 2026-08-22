import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';
import { updateChoiceOptionText } from './authoringQuestionTypes';

interface OptionEditorProps {
  question: AssessmentQuestionInput;
  onChange: (question: AssessmentQuestionInput) => void;
  onOpenOptionMedia: (optionKey: string) => void;
}

export function OptionEditor({ question, onChange, onOpenOptionMedia }: OptionEditorProps) {
  const options = question.options || [];
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <div
          key={option.key}
          className="grid grid-cols-[1.5rem_2rem_minmax(0,1fr)_2.5rem] items-center gap-2"
        >
          <span aria-hidden="true" className="text-slate-400">
            ○
          </span>
          <span className="text-sm font-black text-slate-500">{option.key}</span>
          <input
            aria-label={`Option ${option.key}`}
            value={option.text}
            onChange={(event) =>
              onChange(updateChoiceOptionText(question, option.key, event.target.value))
            }
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={() => onOpenOptionMedia(option.key)}
            aria-label={`Add image to option ${option.key}`}
            className="h-10 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            Img
          </button>
        </div>
      ))}
    </div>
  );
}
