import type { AssignmentAuthoringDraft } from '../../../../shared/assignmentAuthoring';

interface ResponsesPanelProps {
  draft: AssignmentAuthoringDraft;
}

export function ResponsesPanel({ draft }: ResponsesPanelProps) {
  const published = draft.status === 'published';
  return (
    <section
      id="authoring-responses-panel"
      role="tabpanel"
      aria-label="Responses"
      className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"
    >
      <h2 className="text-xl font-black text-slate-950">Responses</h2>
      <p className="mt-2 text-sm font-semibold text-slate-500">
        {published
          ? 'Responses will appear here as students submit the assignment.'
          : 'Responses are available after this assignment is published.'}
      </p>
    </section>
  );
}
