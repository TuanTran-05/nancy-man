import { useState } from 'react';
import { X } from 'lucide-react';
import { ModalPortal } from '../../common/ModalPortal';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';
import type { Class } from '../../../types';
import {
  buildAdvancedAssignmentPayload,
  createDefaultAssessmentDraft,
  validateAssessmentDraft,
  type AdvancedAssignmentDraft,
} from './assessmentBuilderState';
import { AssessmentBuilderCanvas } from './AssessmentBuilderCanvas';
import { AssessmentBuilderSettingsPanel } from './AssessmentBuilderSettingsPanel';
import { useLanguage } from '../../../lib/i18n/useLanguage';

interface AssessmentBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  classes: Class[];
  isSaving: boolean;
  onSubmit: (payload: ReturnType<typeof buildAdvancedAssignmentPayload>) => void;
}

export function AssessmentBuilder({
  isOpen,
  onClose,
  classes,
  isSaving,
  onSubmit,
}: AssessmentBuilderProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const T = t.assessmentBuilder;
  const [draft, setDraft] = useState<AdvancedAssignmentDraft>(() => createDefaultAssessmentDraft());
  const [errors, setErrors] = useState<string[]>([]);

  if (!isOpen) return null;

  const submit = () => {
    const validationErrors = validateAssessmentDraft(draft);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;
    onSubmit(buildAdvancedAssignmentPayload(draft));
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] bg-black/50 p-4">
        <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-200 bg-blue-600 px-5 py-4 text-white">
            <div>
              <h2 className="text-xl font-black">{T.title}</h2>
              <p className="text-sm text-blue-100">{T.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          {errors.length > 0 && (
            <div className="border-b border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}

          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_25rem]">
            <AssessmentBuilderCanvas draft={draft} onDraftChange={setDraft} labels={T} />
            <AssessmentBuilderSettingsPanel
              classes={classes}
              draft={draft}
              onDraftChange={setDraft}
              labels={T}
            />
          </div>

          <footer className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              {T.cancel}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isSaving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isSaving ? T.saving : T.create}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}
