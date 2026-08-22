import {
  Copy,
  GripVertical,
  Image,
  Music,
  Trash2,
  Video,
  ArrowUp,
  ArrowDown,
  BookmarkPlus,
} from 'lucide-react';
import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';
import { QUESTION_TYPE_OPTIONS, ensureQuestionTypeDefaults } from './authoringQuestionTypes';
import { OptionEditor } from './OptionEditor';
import { QuestionMediaStrip } from './QuestionMediaStrip';

interface DragHandleProps {
  attributes?: Record<string, any>;
  listeners?: Record<string, any>;
  setActivatorNodeRef?: (element: HTMLButtonElement | null) => void;
}

interface QuestionCardProps {
  sectionId: string;
  question: AssessmentQuestionInput;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (question: AssessmentQuestionInput) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSaveToBank: () => void;
  onOpenMediaPicker: (
    target: 'question' | { optionKey: string },
    mediaKind?: 'image' | 'audio' | 'video'
  ) => void;
  dragHandle?: DragHandleProps;
}

export function QuestionCard({
  question,
  index,
  selected,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSaveToBank,
  onOpenMediaPicker,
  dragHandle,
}: QuestionCardProps) {
  const questionNumber = index + 1;

  const publishableTypes = new Set([
    'multiple_choice',
    'short_answer',
    'long_answer',
    'speaking_recording',
    'file_upload',
  ]);
  const draftOnly =
    question.interactionType !== undefined && !publishableTypes.has(question.interactionType);

  return (
    <article
      onFocus={onSelect}
      onClick={onSelect}
      className={`rounded-2xl border bg-white p-5 shadow-sm transition ${
        selected ? 'border-blue-200 ring-2 ring-blue-100' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          ref={dragHandle?.setActivatorNodeRef}
          aria-label={`Drag question ${questionNumber}`}
          className="rounded-xl p-1 text-slate-300 hover:bg-slate-50 hover:text-slate-500"
          onClick={(event) => event.stopPropagation()}
          {...dragHandle?.attributes}
          {...dragHandle?.listeners}
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>
        <h3 className="text-sm font-black text-slate-700">Question {questionNumber}</h3>
        <select
          aria-label={`Question ${questionNumber} type`}
          value={(question.interactionType as string | undefined) || question.responseMode}
          onChange={(event) =>
            onChange(ensureQuestionTypeDefaults(question, event.target.value as any))
          }
          className="ml-auto h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"
        >
          {QUESTION_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {draftOnly && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
          Draft-only type
        </p>
      )}

      <textarea
        aria-label={`Question ${questionNumber} prompt`}
        value={question.prompt}
        onChange={(event) => onChange({ ...question, prompt: event.target.value })}
        rows={3}
        placeholder="Question text"
        className="mt-4 w-full resize-y rounded-xl border border-slate-200 px-3 py-3 text-base font-semibold outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpenMediaPicker('question', 'image')}
          aria-label={`Add image to question ${questionNumber}`}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          <Image className="h-4 w-4" aria-hidden="true" />
          Add image
        </button>
        <button
          type="button"
          onClick={() => onOpenMediaPicker('question', 'audio')}
          aria-label={`Add audio to question ${questionNumber}`}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          <Music className="h-4 w-4" aria-hidden="true" />
          Add audio
        </button>
        <button
          type="button"
          onClick={() => onOpenMediaPicker('question', 'video')}
          aria-label={`Add video to question ${questionNumber}`}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          <Video className="h-4 w-4" aria-hidden="true" />
          Add video
        </button>
      </div>

      <div className="mt-4">
        <QuestionMediaStrip
          media={question.media}
          onRemove={(mediaId) =>
            onChange({ ...question, media: question.media.filter((item) => item.id !== mediaId) })
          }
        />
      </div>

      {question.responseMode === 'multiple_choice' && (
        <div className="mt-4">
          <OptionEditor
            question={question}
            onChange={onChange}
            onOpenOptionMedia={(optionKey) => onOpenMediaPicker({ optionKey }, 'image')}
          />
        </div>
      )}

      <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-sm">
        <label className="inline-flex items-center gap-2 font-bold text-slate-600">
          Points
          <input
            aria-label={`Points for question ${questionNumber}`}
            type="number"
            min={0}
            value={question.points ?? 1}
            onChange={(event) => onChange({ ...question, points: Number(event.target.value) })}
            className="h-9 w-20 rounded-xl border border-slate-200 px-2 text-sm"
          />
        </label>
        <label className="ml-auto inline-flex items-center gap-2 font-bold text-slate-600">
          Required
          <input
            aria-label={`Required question ${questionNumber}`}
            type="checkbox"
            checked={question.required === true}
            onChange={(event) => onChange({ ...question, required: event.target.checked })}
            className="h-4 w-4"
          />
        </label>
        <button
          type="button"
          onClick={onSaveToBank}
          aria-label={`Save question ${questionNumber} to question bank`}
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"
        >
          <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          aria-label={`Duplicate question ${questionNumber}`}
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onMoveUp}
          aria-label={`Move question ${questionNumber} up`}
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          aria-label={`Move question ${questionNumber} down`}
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete question ${questionNumber}`}
          className="rounded-xl p-2 text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}
