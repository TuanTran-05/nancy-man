import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';
import type { AuthoringBulkQuestionUpdate } from '../../../../shared/assignmentAuthoring';

interface BulkQuestionActionsProps {
  selectedCount: number;
  sections: Array<{ id: string; title: string }>;
  onBulkUpdate: (update: AuthoringBulkQuestionUpdate) => void;
  onMove: (sectionId: string) => void;
  onDelete: () => void;
}

export function BulkQuestionActions({
  selectedCount,
  sections,
  onBulkUpdate,
  onMove,
  onDelete,
}: BulkQuestionActionsProps) {
  const [points, setPoints] = useState('');
  const [level, setLevel] = useState('');
  const [skill, setSkill] = useState<AssessmentQuestionInput['skill'] | ''>('');
  const [targetSectionId, setTargetSectionId] = useState(sections[0]?.id || '');

  if (selectedCount < 2) return null;

  return (
    <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-black uppercase text-slate-500">{selectedCount} selected</div>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs font-bold uppercase text-slate-500">
          Points
          <input
            aria-label="Bulk points"
            type="number"
            min={0}
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs font-bold uppercase text-slate-500">
          Level
          <input
            aria-label="Bulk level"
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs font-bold uppercase text-slate-500">
          Skill
          <select
            aria-label="Bulk skill"
            value={skill}
            onChange={(event) => setSkill(event.target.value as AssessmentQuestionInput['skill'])}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          >
            <option value="">Keep</option>
            <option value="listening">Listening</option>
            <option value="reading">Reading</option>
            <option value="speaking">Speaking</option>
            <option value="writing">Writing</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        onClick={() =>
          onBulkUpdate({
            ...(points ? { points: Number(points) } : {}),
            ...(level.trim() ? { level: level.trim() } : {}),
            ...(skill ? { skill } : {}),
          })
        }
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white"
      >
        Apply bulk edit
      </button>
      <label className="block text-xs font-bold uppercase text-slate-500">
        Move to
        <select
          aria-label="Move selected to section"
          value={targetSectionId}
          onChange={(event) => setTargetSectionId(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.title || 'Untitled section'}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onMove(targetSectionId)}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold"
        >
          Move selected
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-bold text-red-700"
        >
          <Trash2 className="h-4 w-4" />
          Delete selected
        </button>
      </div>
    </section>
  );
}
