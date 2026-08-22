import type { AuthoringAction, AuthoringWorkbenchState } from './authoringState';
import { BulkQuestionActions } from './BulkQuestionActions';
import { ResponseModeEditor } from '../assessmentBuilder/ResponseModeEditor';

interface AuthoringMainEditorProps {
  state: AuthoringWorkbenchState;
  dispatch: (action: AuthoringAction) => void;
  onSaveQuestionToBank?: (questionId: string) => void;
}

export function AuthoringMainEditor({
  state,
  dispatch,
  onSaveQuestionToBank,
}: AuthoringMainEditorProps) {
  const selectedSection = state.draft.assessmentDraft.sections.find(
    (section) => section.id === state.selectedSectionId
  );
  const selectedQuestion = state.draft.assessmentDraft.sections
    .flatMap((section) => section.questions)
    .find((question) => question.id === state.selectedQuestionId);

  const isBulk = state.selectedQuestionIds.length > 1;

  return (
    <section className="min-h-[36rem] border-y border-slate-200 bg-white p-4 lg:border-r">
      <h2 className="text-sm font-black uppercase text-slate-500 mb-4">Editor</h2>

      {selectedSection && (
        <div className="mb-6 space-y-3 rounded-md border border-slate-200 p-3 bg-slate-50">
          <h3 className="text-xs font-black uppercase text-slate-500">Section Editor</h3>
          <label
            aria-label="Section title field"
            className="block text-xs font-bold uppercase text-slate-500"
          >
            Section title
            <input
              aria-label="Section title"
              value={selectedSection.title}
              onChange={(event) =>
                dispatch({
                  type: 'update_section',
                  sectionId: selectedSection.id,
                  section: { ...selectedSection, title: event.target.value },
                })
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs font-bold uppercase text-slate-500">
            Section skill
            <select
              aria-label="Section skill"
              value={selectedSection.skill}
              onChange={(event) =>
                dispatch({
                  type: 'update_section',
                  sectionId: selectedSection.id,
                  section: { ...selectedSection, skill: event.target.value as any },
                })
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm"
            >
              <option value="listening">Listening</option>
              <option value="reading">Reading</option>
              <option value="speaking">Speaking</option>
              <option value="writing">Writing</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="block text-xs font-bold uppercase text-slate-500">
            Section instructions
            <textarea
              aria-label="Section instructions"
              value={selectedSection.instructions || ''}
              onChange={(event) =>
                dispatch({
                  type: 'update_section',
                  sectionId: selectedSection.id,
                  section: { ...selectedSection, instructions: event.target.value },
                })
              }
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm"
            />
          </label>
        </div>
      )}

      {isBulk ? (
        <BulkQuestionActions
          selectedCount={state.selectedQuestionIds.length}
          sections={state.draft.assessmentDraft.sections.map((sec) => ({
            id: sec.id,
            title: sec.title,
          }))}
          onBulkUpdate={(update) =>
            dispatch({ type: 'bulk_update', questionIds: state.selectedQuestionIds, update })
          }
          onMove={(targetSectionId) =>
            dispatch({
              type: 'move_selected_to_section',
              questionIds: state.selectedQuestionIds,
              targetSectionId,
            })
          }
          onDelete={() =>
            dispatch({ type: 'delete_questions', questionIds: state.selectedQuestionIds })
          }
        />
      ) : selectedQuestion ? (
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase text-slate-500">
            Prompt
            <textarea
              aria-label="Question prompt"
              value={selectedQuestion.prompt}
              onChange={(event) =>
                dispatch({
                  type: 'update_question',
                  questionId: selectedQuestion.id,
                  question: { ...selectedQuestion, prompt: event.target.value },
                })
              }
              rows={4}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <ResponseModeEditor
            question={selectedQuestion}
            onChange={(question) =>
              dispatch({
                type: 'update_question',
                questionId: selectedQuestion.id,
                question,
              })
            }
          />
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onSaveQuestionToBank?.(selectedQuestion.id)}
              className="rounded-md border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50"
            >
              Save to question bank
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Select a question.</p>
      )}
    </section>
  );
}
