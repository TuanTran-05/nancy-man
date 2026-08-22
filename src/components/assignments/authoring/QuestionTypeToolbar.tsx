import { BookOpen, LayoutList, Plus } from 'lucide-react';
import type { AuthoringQuestionType } from './authoringQuestionTypes';

interface QuestionTypeToolbarProps {
  onAddQuestion: (type: AuthoringQuestionType) => void;
  onOpenQuestionBank: () => void;
  onAddSection: () => void;
}

const TOOL_TYPES: Array<{ type: AuthoringQuestionType; label: string }> = [
  { type: 'multiple_choice', label: 'Multiple choice' },
  { type: 'short_answer', label: 'Short answer' },
  { type: 'long_answer', label: 'Long answer' },
  { type: 'listening', label: 'Listening' },
];

export function QuestionTypeToolbar({
  onAddQuestion,
  onOpenQuestionBank,
  onAddSection,
}: QuestionTypeToolbarProps) {
  return (
    <aside
      aria-label="Question tools"
      className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      {TOOL_TYPES.map((tool) => (
        <button
          key={tool.type}
          type="button"
          onClick={() => onAddQuestion(tool.type)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-xs font-black text-slate-600 hover:border-indigo-200 hover:bg-indigo-50"
        >
          <Plus className="mr-2 inline-block h-3 w-3" aria-hidden="true" />
          {tool.label}
        </button>
      ))}
      <hr className="w-full border-slate-200" />
      <button
        type="button"
        onClick={onOpenQuestionBank}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-xs font-black text-slate-600 hover:border-indigo-200 hover:bg-indigo-50"
      >
        <BookOpen className="mr-2 inline-block h-3 w-3" aria-hidden="true" />
        Question bank
      </button>
      <button
        type="button"
        onClick={onAddSection}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-xs font-black text-slate-600 hover:border-indigo-200 hover:bg-indigo-50"
      >
        <LayoutList className="mr-2 inline-block h-3 w-3" aria-hidden="true" />
        Add section
      </button>
    </aside>
  );
}
