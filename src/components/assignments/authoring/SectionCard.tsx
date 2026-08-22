import { GripVertical } from 'lucide-react';
import type {
  AssessmentSectionInput,
  AssessmentSkill,
} from '../../../../shared/assignmentAssessment';

interface DragHandleProps {
  attributes?: Record<string, any>;
  listeners?: Record<string, any>;
  setActivatorNodeRef?: (element: HTMLButtonElement | null) => void;
}

interface SectionCardProps {
  section: AssessmentSectionInput;
  onChange: (section: AssessmentSectionInput) => void;
  onAddQuestion: () => void;
  dragHandle?: DragHandleProps;
}

export function SectionCard({ section, onChange, onAddQuestion, dragHandle }: SectionCardProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          ref={dragHandle?.setActivatorNodeRef}
          aria-label={`Drag section ${section.title || 'Untitled section'}`}
          className="hidden rounded-xl p-1 text-slate-300 hover:bg-slate-50 hover:text-slate-500 sm:inline-flex"
          {...dragHandle?.attributes}
          {...dragHandle?.listeners}
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>
        <input
          aria-label={`Section title ${section.title || 'Untitled section'}`}
          value={section.title}
          onChange={(event) => onChange({ ...section, title: event.target.value })}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"
        />
        <select
          aria-label={`Section skill ${section.title || 'Untitled section'}`}
          value={section.skill}
          onChange={(event) =>
            onChange({ ...section, skill: event.target.value as AssessmentSkill })
          }
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
        >
          <option value="listening">Listening</option>
          <option value="reading">Reading</option>
          <option value="speaking">Speaking</option>
          <option value="writing">Writing</option>
          <option value="mixed">Mixed</option>
        </select>
        <button
          type="button"
          onClick={onAddQuestion}
          className="rounded-xl bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-700"
          aria-label={`Add question to ${section.title || 'section'}`}
        >
          Add question
        </button>
      </div>
      <textarea
        aria-label={`Section instructions ${section.title || 'Untitled section'}`}
        value={section.instructions || ''}
        onChange={(event) => onChange({ ...section, instructions: event.target.value })}
        rows={2}
        className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm"
        placeholder="Section instructions"
      />
    </section>
  );
}
