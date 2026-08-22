import type { Class } from '../../../types';
import type { AssignmentProctoringMode } from '../../../../shared/assignmentProctoring';
import type { AdvancedAssignmentDraft } from './assessmentBuilderState';
import { DateTimeTextInput } from '../../forms/DateTimeTextInput';
import { StudentAssessmentPreview } from './StudentAssessmentPreview';

interface AssessmentBuilderSettingsPanelProps {
  classes: Class[];
  draft: AdvancedAssignmentDraft;
  onDraftChange: (draft: AdvancedAssignmentDraft) => void;
  labels: {
    settingsTitle: string;
    classLabel: string;
    selectClass: string;
    dueDate: string;
    attempts: string;
    proctoringMode: string;
    strictMode: string;
    normalMode: string;
    allowFreeMediaPlayback: string;
    showCorrectAnswersAfterSubmit: string;
    showTranscriptDuringAttempt: string;
    studentPreview: string;
  };
}

export function AssessmentBuilderSettingsPanel({
  classes,
  draft,
  onDraftChange,
  labels,
}: AssessmentBuilderSettingsPanelProps) {
  const updateSetting = (key: keyof AdvancedAssignmentDraft['assessment']['settings']) => {
    onDraftChange({
      ...draft,
      assessment: {
        ...draft.assessment,
        settings: {
          ...draft.assessment.settings,
          [key]: !draft.assessment.settings[key],
        },
      },
    });
  };

  const setProctoringMode = (proctoringMode: AssignmentProctoringMode) => {
    onDraftChange({ ...draft, proctoringMode });
  };

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-5">
      <h3 className="text-base font-black text-slate-950">{labels.settingsTitle}</h3>

      <div className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-xs font-semibold text-slate-600">
          {labels.classLabel}
          <select
            aria-label={labels.classLabel}
            value={draft.classId}
            onChange={(event) => onDraftChange({ ...draft, classId: event.target.value })}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">{labels.selectClass}</option>
            {classes.map((classItem) => (
              <option key={classItem.id} value={classItem.id}>
                {classItem.name}
              </option>
            ))}
          </select>
        </label>

        <DateTimeTextInput
          mode="datetime"
          label={labels.dueDate}
          value={draft.dueDate}
          onChange={(value) => onDraftChange({ ...draft, dueDate: value })}
          className="text-xs font-semibold text-slate-600"
          required
        />

        <label className="block text-xs font-semibold text-slate-600">
          {labels.attempts}
          <input
            aria-label={labels.attempts}
            type="number"
            min={1}
            max={10}
            value={draft.attemptsAllowed}
            onChange={(event) =>
              onDraftChange({ ...draft, attemptsAllowed: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-600">{labels.proctoringMode}</p>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="radio"
            name="advanced-proctoring-mode"
            aria-label={labels.strictMode}
            checked={draft.proctoringMode === 'strict'}
            onChange={() => setProctoringMode('strict')}
          />
          {labels.strictMode}
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="radio"
            name="advanced-proctoring-mode"
            aria-label={labels.normalMode}
            checked={draft.proctoringMode === 'normal'}
            onChange={() => setProctoringMode('normal')}
          />
          {labels.normalMode}
        </label>
      </div>

      <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            aria-label={labels.allowFreeMediaPlayback}
            checked={draft.assessment.settings.allowFreeMediaPlayback}
            onChange={() => updateSetting('allowFreeMediaPlayback')}
          />
          {labels.allowFreeMediaPlayback}
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            aria-label={labels.showCorrectAnswersAfterSubmit}
            checked={draft.assessment.settings.showCorrectAnswersAfterSubmit}
            onChange={() => updateSetting('showCorrectAnswersAfterSubmit')}
          />
          {labels.showCorrectAnswersAfterSubmit}
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            aria-label={labels.showTranscriptDuringAttempt}
            checked={draft.assessment.settings.showTranscriptDuringAttempt}
            onChange={() => updateSetting('showTranscriptDuringAttempt')}
          />
          {labels.showTranscriptDuringAttempt}
        </label>
      </div>

      <div className="mt-5">
        <h3 className="mb-3 text-base font-black text-slate-950">{labels.studentPreview}</h3>
        <StudentAssessmentPreview assessment={draft.assessment} />
      </div>
    </aside>
  );
}
