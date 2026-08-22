import { useEffect, useState } from 'react';
import { FileQuestion, Mic, PlusCircle, Rows3, Type } from 'lucide-react';
import type {
  AssessmentResponseMode,
  AssessmentSkill,
} from '../../../../shared/assignmentAssessment';
import {
  addQuestionToSection,
  addSectionToDraft,
  type AdvancedAssignmentDraft,
} from './assessmentBuilderState';
import { SectionEditor } from './SectionEditor';

interface AssessmentBuilderCanvasProps {
  draft: AdvancedAssignmentDraft;
  onDraftChange: (draft: AdvancedAssignmentDraft) => void;
  labels: {
    canvasTitle: string;
    titleLabel: string;
    assignmentTitlePlaceholder: string;
    description: string;
    formDescriptionPlaceholder: string;
    addMultipleChoice: string;
    addShortAnswer: string;
    addSpeakingRecording: string;
    addListening: string;
    addReading: string;
    addMixed: string;
    duplicateQuestion: string;
    removeQuestion: string;
    removeSection: string;
    sectionTitle: string;
    sectionInstructions: string;
    questionPrompt: string;
    points: string;
    questionMedia: string;
    addMedia: string;
    hideMedia: string;
  };
}

const sectionSkills: AssessmentSkill[] = ['listening', 'reading', 'mixed'];

export function AssessmentBuilderCanvas({
  draft,
  onDraftChange,
  labels,
}: AssessmentBuilderCanvasProps) {
  const [activeSectionId, setActiveSectionId] = useState(draft.assessment.sections[0]?.id || '');

  useEffect(() => {
    if (!draft.assessment.sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(draft.assessment.sections[0]?.id || '');
    }
  }, [activeSectionId, draft.assessment.sections]);

  const addQuestion = (responseMode: AssessmentResponseMode) => {
    const sectionId = activeSectionId || draft.assessment.sections[0]?.id;
    if (!sectionId) return;
    onDraftChange(addQuestionToSection(draft, sectionId, responseMode));
  };

  const addSection = (skill: AssessmentSkill) => {
    const nextDraft = addSectionToDraft(draft, skill);
    const nextSection = nextDraft.assessment.sections[nextDraft.assessment.sections.length - 1];
    setActiveSectionId(nextSection.id);
    onDraftChange(nextDraft);
  };

  return (
    <form
      className="min-h-0 overflow-y-auto bg-violet-50/70 p-4 sm:p-6"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className="min-w-0 space-y-4">
          <section className="rounded-lg border border-slate-200 border-t-[10px] border-t-violet-600 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-bold text-violet-700">{labels.canvasTitle}</h3>
            <label className="block text-xs font-semibold text-slate-600">
              {labels.titleLabel}
              <input
                aria-label={labels.titleLabel}
                value={draft.title}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
                placeholder={labels.assignmentTitlePlaceholder}
                className="mt-1 w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-2xl font-semibold text-slate-950 outline-none focus:border-violet-600"
              />
            </label>
            <label className="mt-4 block text-xs font-semibold text-slate-600">
              {labels.description}
              <textarea
                aria-label={labels.description}
                value={draft.description}
                onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
                placeholder={labels.formDescriptionPlaceholder}
                rows={2}
                className="mt-1 w-full resize-none border-0 border-b border-slate-200 bg-transparent px-0 py-2 text-sm text-slate-700 outline-none focus:border-violet-600"
              />
            </label>
          </section>

          {draft.assessment.sections.map((section) => (
            <SectionEditor
              key={section.id}
              classId={draft.classId}
              draft={draft}
              section={section}
              isActive={section.id === activeSectionId}
              labels={labels}
              onActivate={() => setActiveSectionId(section.id)}
              onDraftChange={onDraftChange}
              onRemove={() =>
                onDraftChange({
                  ...draft,
                  assessment: {
                    ...draft.assessment,
                    sections: draft.assessment.sections.filter(
                      (candidate) => candidate.id !== section.id
                    ),
                  },
                })
              }
            />
          ))}
        </div>

        <div className="sticky top-3 hidden h-max rounded-xl border border-slate-200 bg-white p-2 shadow-sm md:grid md:gap-2">
          <button
            type="button"
            onClick={() => addQuestion('multiple_choice')}
            aria-label={labels.addMultipleChoice}
            title={labels.addMultipleChoice}
            className="rounded-lg p-2 text-slate-600 hover:bg-violet-50 hover:text-violet-700"
          >
            <FileQuestion className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => addQuestion('short_answer')}
            aria-label={labels.addShortAnswer}
            title={labels.addShortAnswer}
            className="rounded-lg p-2 text-slate-600 hover:bg-violet-50 hover:text-violet-700"
          >
            <Type className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => addQuestion('speaking_recording')}
            aria-label={labels.addSpeakingRecording}
            title={labels.addSpeakingRecording}
            className="rounded-lg p-2 text-slate-600 hover:bg-violet-50 hover:text-violet-700"
          >
            <Mic className="h-5 w-5" />
          </button>
          {sectionSkills.map((skill) => {
            const label =
              skill === 'listening'
                ? labels.addListening
                : skill === 'reading'
                  ? labels.addReading
                  : labels.addMixed;
            return (
              <button
                key={skill}
                type="button"
                onClick={() => addSection(skill)}
                aria-label={label}
                title={label}
                className="rounded-lg p-2 text-slate-600 hover:bg-violet-50 hover:text-violet-700"
              >
                <Rows3 className="h-5 w-5" />
              </button>
            );
          })}
        </div>

        <div className="col-span-full flex flex-wrap gap-2 md:hidden">
          <button
            type="button"
            onClick={() => addQuestion('multiple_choice')}
            aria-label={labels.addMultipleChoice}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white"
          >
            <PlusCircle className="h-4 w-4" />
            {labels.addMultipleChoice}
          </button>
          <button
            type="button"
            onClick={() => addQuestion('short_answer')}
            aria-label={labels.addShortAnswer}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            <PlusCircle className="h-4 w-4" />
            {labels.addShortAnswer}
          </button>
          <button
            type="button"
            onClick={() => addQuestion('speaking_recording')}
            aria-label={labels.addSpeakingRecording}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            <PlusCircle className="h-4 w-4" />
            {labels.addSpeakingRecording}
          </button>
          {sectionSkills.map((skill) => {
            const label =
              skill === 'listening'
                ? labels.addListening
                : skill === 'reading'
                  ? labels.addReading
                  : labels.addMixed;
            return (
              <button
                key={skill}
                type="button"
                onClick={() => addSection(skill)}
                aria-label={label}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                <Rows3 className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </form>
  );
}
