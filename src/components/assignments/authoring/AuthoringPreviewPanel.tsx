import { X } from 'lucide-react';
import { StudentAssessmentPreview } from '../assessmentBuilder/StudentAssessmentPreview';
import type { AssignmentAuthoringDraft } from '../../../../shared/assignmentAuthoring';

interface AuthoringPreviewPanelProps {
  draft: AssignmentAuthoringDraft;
  open: boolean;
  onClose: () => void;
}

export function AuthoringPreviewPanel({ draft, open, onClose }: AuthoringPreviewPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 p-3">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Student preview"
        className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-blue-700">Student preview</p>
            <h2 className="truncate text-lg font-black text-slate-950">
              {draft.title || 'Untitled assignment'}
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Class {draft.classId || 'not selected'} / Due {draft.dueDate || 'not set'} / Attempts{' '}
              {draft.attemptsAllowed}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          <StudentAssessmentPreview assessment={draft.assessmentDraft} />
        </div>
      </section>
    </div>
  );
}
