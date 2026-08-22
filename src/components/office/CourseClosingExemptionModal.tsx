import React from 'react';
import toast from 'react-hot-toast';
import { ShieldOff, X } from 'lucide-react';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';
import { apiRequest } from '../../lib/api/apiClient';
import { useLanguage } from '../../lib/i18n/useLanguage';

export interface CourseClosingExemptionModalProps {
  classId: string;
  studentId: string;
  studentName: string;
  onClose: () => void;
  onSuccess: (snapshot: CourseClosingSnapshot) => void;
}

export function CourseClosingExemptionModal({
  classId,
  studentId,
  studentName,
  onClose,
  onSuccess,
}: CourseClosingExemptionModalProps) {
  const { t } = useLanguage();
  const copy = t.courseClosing.exemption;
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  const submit = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setErrorMessage(copy.reasonRequired);
      return;
    }

    setErrorMessage('');
    setSubmitting(true);
    try {
      const response = await apiRequest<{
        success: true;
        courseClosing: CourseClosingSnapshot;
      }>('/api/v1/classes/exempt-course-closing-student', {
        method: 'POST',
        body: { classId, studentId, reason: trimmedReason },
      });
      toast.success(copy.success);
      onSuccess(response.courseClosing);
    } catch (submitError) {
      // Keep the typed reason so the Admin can retry without retyping it.
      const message = submitError instanceof Error ? submitError.message : copy.error;
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldOff className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <h3 className="text-lg font-bold text-slate-900">{copy.title}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {copy.summary.replace('{name}', studentName)}
              </p>
            </div>
          </div>
          <button type="button" aria-label={copy.cancel} onClick={onClose}>
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <label className="mt-4 block text-sm font-semibold text-slate-700">
          {copy.reason}
          <textarea
            aria-label={copy.reason}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={copy.reasonPlaceholder}
            className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-blue-500"
          />
        </label>

        {errorMessage && <p className="mt-2 text-sm text-red-600">{errorMessage}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600"
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {submitting ? copy.submitting : copy.action}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CourseClosingExemptionModal;
