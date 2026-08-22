import { Trash2 } from 'lucide-react';
import type { AssessmentSectionInput } from '../../../../shared/assignmentAssessment';
import { duplicateQuestionInSection, type AdvancedAssignmentDraft } from './assessmentBuilderState';
import { QuestionCard } from './QuestionCard';

interface SectionEditorProps {
  classId: string;
  draft: AdvancedAssignmentDraft;
  section: AssessmentSectionInput;
  isActive: boolean;
  labels: {
    sectionTitle: string;
    sectionInstructions: string;
    duplicateQuestion: string;
    removeQuestion: string;
    removeSection: string;
    questionPrompt: string;
    points: string;
    questionMedia: string;
    addMedia: string;
    hideMedia: string;
  };
  onActivate: () => void;
  onDraftChange: (draft: AdvancedAssignmentDraft) => void;
  onRemove: () => void;
}

export function SectionEditor({
  classId,
  draft,
  section,
  isActive,
  labels,
  onActivate,
  onDraftChange,
  onRemove,
}: SectionEditorProps) {
  const updateSection = (nextSection: AssessmentSectionInput) => {
    onDraftChange({
      ...draft,
      assessment: {
        ...draft.assessment,
        sections: draft.assessment.sections.map((candidate) =>
          candidate.id === section.id ? nextSection : candidate
        ),
      },
    });
  };

  return (
    <section
      onFocus={onActivate}
      className={`space-y-4 rounded-lg border bg-white p-4 shadow-sm ${
        isActive ? 'border-l-4 border-l-violet-600 border-slate-200' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">
          {labels.sectionTitle}
          <input
            aria-label={labels.sectionTitle}
            value={section.title}
            onChange={(event) => updateSection({ ...section, title: event.target.value })}
            className="mt-1 w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-lg font-semibold text-slate-950 outline-none focus:border-violet-600"
          />
        </label>
        <button
          type="button"
          onClick={onRemove}
          aria-label={labels.removeSection}
          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
          {labels.removeSection}
        </button>
      </div>

      <label className="block text-xs font-semibold text-slate-600">
        {labels.sectionInstructions}
        <textarea
          aria-label={labels.sectionInstructions}
          value={section.instructions || ''}
          onChange={(event) => updateSection({ ...section, instructions: event.target.value })}
          rows={2}
          className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="space-y-4">
        {section.questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            classId={classId}
            index={index}
            question={question}
            labels={labels}
            onChange={(nextQuestion) =>
              updateSection({
                ...section,
                questions: section.questions.map((candidate) =>
                  candidate.id === question.id ? nextQuestion : candidate
                ),
              })
            }
            onDuplicate={() =>
              onDraftChange(duplicateQuestionInSection(draft, section.id, question.id))
            }
            onRemove={() =>
              updateSection({
                ...section,
                questions: section.questions.filter((candidate) => candidate.id !== question.id),
              })
            }
          />
        ))}
      </div>
    </section>
  );
}
