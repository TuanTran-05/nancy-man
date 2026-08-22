import { Copy, Trash2 } from 'lucide-react';
import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';
import { QuestionMediaManager } from './QuestionMediaManager';
import { ResponseModeEditor } from './ResponseModeEditor';

interface QuestionCardProps {
  classId: string;
  index: number;
  question: AssessmentQuestionInput;
  labels: {
    duplicateQuestion: string;
    removeQuestion: string;
    questionPrompt: string;
    points: string;
    questionMedia: string;
    addMedia: string;
    hideMedia: string;
  };
  onChange: (question: AssessmentQuestionInput) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function QuestionCard({
  classId,
  index,
  question,
  labels,
  onChange,
  onDuplicate,
  onRemove,
}: QuestionCardProps) {
  return (
    <article className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <label className="block text-xs font-semibold text-slate-600">
          {labels.questionPrompt}
          <textarea
            aria-label={`Question ${index + 1} prompt`}
            value={question.prompt}
            onChange={(event) => onChange({ ...question, prompt: event.target.value })}
            rows={2}
            className="mt-1 w-full resize-none border-0 border-b border-slate-300 bg-slate-50 px-3 py-2 text-base font-medium text-slate-950 outline-none focus:border-violet-600"
          />
        </label>

        <ResponseModeEditor question={question} onChange={onChange} />
      </div>

      <QuestionMediaManager
        classId={classId}
        media={question.media || []}
        labels={{
          title: labels.questionMedia,
          addMedia: labels.addMedia,
          hideMedia: labels.hideMedia,
        }}
        onChange={(media) => onChange({ ...question, media })}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <label className="text-xs font-semibold text-slate-600">
          {labels.points}
          <input
            aria-label={`Question ${index + 1} points`}
            type="number"
            min={0}
            max={1000}
            value={question.points ?? 1}
            onChange={(event) => onChange({ ...question, points: Number(event.target.value) })}
            className="ml-2 w-20 rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDuplicate}
            aria-label={labels.duplicateQuestion}
            title={labels.duplicateQuestion}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={labels.removeQuestion}
            title={labels.removeQuestion}
            className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}
