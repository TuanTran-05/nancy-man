import { FileText, Trash2 } from 'lucide-react';
import type { AssignmentAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import {
  countDraftQuestions,
  getDraftClassLabel,
  getDraftDueDateLabel,
  getDraftReadinessLabel,
  getDraftTitleLabel,
  type DraftClassOption,
} from './authoringDraftSummary';

interface AuthoringDraftListLabels {
  heading: string;
  autoSaveNote: string;
  untitled: string;
  missingClass: string;
  missingDueDate: string;
  questions: string;
  open: string;
  delete: string;
  retry: string;
  updated: string;
  ready: string;
  needsDetails: string;
}

interface AuthoringDraftListProps {
  drafts: AssignmentAuthoringDraft[];
  classes: DraftClassOption[];
  loading: boolean;
  error: string;
  labels: AuthoringDraftListLabels;
  onOpen: (draftId: string) => void;
  onDelete: (draftId: string) => void;
  onRetry: () => void;
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString();
}

export function AuthoringDraftList({
  drafts,
  classes,
  loading,
  error,
  labels,
  onOpen,
  onDelete,
  onRetry,
}: AuthoringDraftListProps) {
  if (!loading && !error && drafts.length === 0) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
            {labels.heading}
          </h2>
          {drafts.length > 0 && (
            <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-bold text-slate-600 dark:border-slate-600 dark:text-slate-300">
              {drafts.length}
            </span>
          )}
        </div>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {labels.autoSaveNote}
        </p>
      </div>

      {loading && (
        <div className="px-4 py-3 text-sm font-medium text-slate-500 dark:text-slate-400">
          {labels.heading}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="font-semibold text-red-700 dark:text-red-300">{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {labels.retry}
          </button>
        </div>
      )}

      {!loading &&
        !error &&
        drafts.map((draft) => {
          const title = getDraftTitleLabel(draft, labels.untitled);
          const classLabel = getDraftClassLabel(draft, classes, labels.missingClass);
          const dueDate = getDraftDueDateLabel(draft, labels.missingDueDate);
          const readiness = getDraftReadinessLabel(draft);
          const readinessText = readiness.tone === 'ready' ? labels.ready : labels.needsDetails;
          const questionCount = countDraftQuestions(draft);
          const updatedAt = formatUpdatedAt(draft.updatedAt);

          return (
            <div
              key={draft.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(draft.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpen(draft.id);
              }}
              className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-slate-100 px-4 py-3 text-left first:border-t-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-slate-900 dark:text-slate-50">
                  {title}
                </p>
                <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                  {classLabel} · {questionCount} {labels.questions} · {dueDate}
                  {updatedAt ? ` · ${labels.updated} ${updatedAt}` : ''}
                </p>
              </div>
              <span
                className={
                  readiness.tone === 'ready'
                    ? 'rounded-full bg-emerald-50 px-2 py-1 text-xs font-extrabold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'rounded-full bg-amber-50 px-2 py-1 text-xs font-extrabold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                }
              >
                {readinessText}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(draft.id);
                  }}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  {labels.open}
                </button>
                <button
                  type="button"
                  aria-label={`${labels.delete} ${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(draft.id);
                  }}
                  className="rounded-md border border-red-200 px-2 py-1.5 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
    </section>
  );
}
