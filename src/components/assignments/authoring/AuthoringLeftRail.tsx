import { Copy, ChevronDown, ChevronUp, Plus, Trash2, CheckSquare } from 'lucide-react';
import type { AuthoringAction, AuthoringWorkbenchState } from './authoringState';

interface AuthoringLeftRailProps {
  state: AuthoringWorkbenchState;
  dispatch: (action: AuthoringAction) => void;
}

export function AuthoringLeftRail({ state, dispatch }: AuthoringLeftRailProps) {
  return (
    <aside className="min-h-[36rem] border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase text-slate-500">Structure</h2>
          {state.selectedQuestionIds.length > 0 && (
            <div className="text-xs text-slate-500">
              {state.selectedQuestionIds.length} selected
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'add_section',
                title: 'New section',
                skill: 'mixed',
                instructions: '',
              })
            }
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700"
          >
            <Plus className="h-3 w-3" />
            Add section
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'add_question', sectionId: state.selectedSectionId })}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700"
          >
            <Plus className="h-3 w-3" />
            Add question
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({ type: 'duplicate_question', questionId: state.selectedQuestionId })
            }
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700"
          >
            <Copy className="h-3 w-3" />
            Duplicate
          </button>
          {state.selectedQuestionIds.length > 0 && (
            <button
              type="button"
              onClick={() =>
                dispatch({ type: 'delete_questions', questionIds: state.selectedQuestionIds })
              }
              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {state.draft.assessmentDraft.sections.map((section) => (
          <div key={section.id}>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => dispatch({ type: 'select_section', sectionId: section.id })}
                className="text-sm font-black text-slate-900 text-left hover:underline"
              >
                {section.title || 'Untitled section'}
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {section.questions.map((question, index) => (
                <div key={question.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Select question ${question.id}`}
                    checked={state.selectedQuestionIds.includes(question.id)}
                    onChange={() =>
                      dispatch({ type: 'select_question', questionId: question.id, multi: true })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'select_question', questionId: question.id, multi: false })
                    }
                    className={`block w-full rounded-md px-2 py-2 text-left text-sm ${
                      state.selectedQuestionId === question.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-50 text-slate-700'
                    }`}
                  >
                    {index + 1}. {question.prompt || 'Untitled question'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: 'move_question',
              questionId: state.selectedQuestionId,
              direction: 'up',
            })
          }
          className="rounded-md border border-slate-200 px-2 py-2 text-xs font-bold"
        >
          <ChevronUp className="mx-auto h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: 'move_question',
              questionId: state.selectedQuestionId,
              direction: 'down',
            })
          }
          className="rounded-md border border-slate-200 px-2 py-2 text-xs font-bold"
        >
          <ChevronDown className="mx-auto h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
