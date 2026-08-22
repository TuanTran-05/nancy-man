import { X } from 'lucide-react';
import type { Class } from '../../../types';
import type {
  AssignmentAuthoringDraft,
  AuthoringDraftFieldUpdate,
  AuthoringValidationIssue,
} from '../../../../shared/assignmentAuthoring';
import type { AssignmentDeliveryPolicy } from '../../../../shared/assignmentDelivery';
import type { AssignmentProctoringMode } from '../../../../shared/assignmentProctoring';
import { DeliveryPolicyPanel } from './DeliveryPolicyPanel';
import { PublishReadinessPanel } from './PublishReadinessPanel';

interface SettingsDrawerProps {
  open: boolean;
  draft: AssignmentAuthoringDraft;
  classes: Class[];
  students: Array<{ id: string; name: string }>;
  isPublishing: boolean;
  onClose: () => void;
  onDraftFieldsChange: (fields: AuthoringDraftFieldUpdate) => void;
  onDeliveryPolicyChange: (policy: AssignmentDeliveryPolicy) => void;
  onIssueSelect: (issue: AuthoringValidationIssue) => void;
  onPublish: () => void;
}

export function SettingsDrawer({
  open,
  draft,
  classes,
  students,
  isPublishing,
  onClose,
  onDraftFieldsChange,
  onDeliveryPolicyChange,
  onIssueSelect,
  onPublish,
}: SettingsDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/30" role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Assignment settings"
        className="ml-auto flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-black text-slate-950">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <label className="block text-xs font-black uppercase text-slate-500">
            Class assignment
            <select
              aria-label="Class assignment"
              value={draft.classId}
              onChange={(event) => onDraftFieldsChange({ classId: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            >
              <option value="">Select class</option>
              {classes.map((classItem) => (
                <option key={classItem.id} value={classItem.id}>
                  {classItem.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-black uppercase text-slate-500">
            Due date
            <input
              aria-label="Due date"
              value={draft.dueDate}
              onChange={(event) => onDraftFieldsChange({ dueDate: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
              placeholder="10:00 30/06/2026"
            />
          </label>
          <label className="block text-xs font-black uppercase text-slate-500">
            Attempts
            <input
              aria-label="Attempts"
              type="number"
              min={1}
              value={draft.attemptsAllowed}
              onChange={(event) =>
                onDraftFieldsChange({ attemptsAllowed: Number(event.target.value) })
              }
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
            />
          </label>
          <label className="block text-xs font-black uppercase text-slate-500">
            Anti-cheating mode
            <select
              aria-label="Anti-cheating mode"
              value={draft.proctoringMode}
              onChange={(event) =>
                onDraftFieldsChange({
                  proctoringMode: event.target.value as AssignmentProctoringMode,
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
            >
              <option value="strict">Strict</option>
              <option value="normal">Normal</option>
            </select>
          </label>
          <DeliveryPolicyPanel
            policy={draft.deliveryPolicy}
            classStudents={students}
            onChange={onDeliveryPolicyChange}
          />
          <PublishReadinessPanel
            draft={draft}
            isPublishing={isPublishing}
            onIssueSelect={onIssueSelect}
            onPublish={onPublish}
          />
        </div>
      </aside>
    </div>
  );
}
