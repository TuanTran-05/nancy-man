import { ArrowLeft, Eye, Save, Send } from 'lucide-react';
import { Link } from 'react-router';
import type { AuthoringSyncStatus } from './authoringState';
import { DraftSyncStatus } from './DraftSyncStatus';

interface AuthoringHeaderProps {
  title: string;
  syncStatus: AuthoringSyncStatus;
  isPublishing: boolean;
  onTitleChange: (title: string) => void;
  onPreview: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
}

export function AuthoringHeader({
  title,
  syncStatus,
  isPublishing,
  onTitleChange,
  onPreview,
  onSaveDraft,
  onPublish,
}: AuthoringHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            to="/assignments"
            aria-label="Back to assignments"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <input
              aria-label="Assignment title"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="Untitled advanced assignment"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-black text-slate-950 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              <span>Advanced assignment</span>
              <span aria-hidden="true">/</span>
              <DraftSyncStatus status={syncStatus} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onPreview}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            Preview
          </button>
          <button
            type="button"
            onClick={onSaveDraft}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save draft
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={isPublishing}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {isPublishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </div>
    </header>
  );
}
