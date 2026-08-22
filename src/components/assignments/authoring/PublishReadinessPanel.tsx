import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import {
  getAuthoringReadiness,
  type AssignmentAuthoringDraft,
  type AuthoringValidationIssue,
} from '../../../../shared/assignmentAuthoring';

interface PublishReadinessPanelProps {
  draft: AssignmentAuthoringDraft;
  isPublishing: boolean;
  onIssueSelect: (issue: AuthoringValidationIssue) => void;
  onPublish: () => void;
}

export function PublishReadinessPanel({
  draft,
  isPublishing,
  onIssueSelect,
  onPublish,
}: PublishReadinessPanelProps) {
  const groups = getAuthoringReadiness(draft);
  const issues = groups.flatMap((group) => group.issues);
  const ready = issues.length === 0;

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase text-slate-500">Publish readiness</h2>
          <p className={`mt-1 text-sm font-bold ${ready ? 'text-emerald-700' : 'text-amber-700'}`}>
            {ready
              ? 'Ready to publish'
              : `Fix ${issues.length} issue${issues.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {ready ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        ) : (
          <AlertCircle className="h-5 w-5 text-amber-600" aria-hidden="true" />
        )}
      </div>

      <div className="space-y-2">
        {groups.map((group) => (
          <div key={group.id} className="rounded-md border border-white bg-white p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-800">{group.label}</span>
              <span
                className={`text-xs font-black uppercase ${
                  group.complete ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {group.complete
                  ? 'Complete'
                  : `${group.issues.length} issue${group.issues.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {group.issues.length > 0 && (
              <div className="mt-2 space-y-1">
                {group.issues.map((issue) => (
                  <button
                    key={`${issue.code}-${issue.sectionId || 'assignment'}-${issue.questionId || ''}-${issue.mediaId || ''}`}
                    type="button"
                    onClick={() => onIssueSelect(issue)}
                    className="block w-full rounded-md bg-amber-50 px-2 py-1.5 text-left text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    Fix {issue.message}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onPublish}
        disabled={isPublishing}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {isPublishing ? 'Publishing...' : 'Publish'}
      </button>
    </section>
  );
}
