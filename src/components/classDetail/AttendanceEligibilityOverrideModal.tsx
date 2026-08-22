import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import { useLanguage } from '../../lib/i18n/useLanguage';
import type { Attendance } from '../../types';
import type { SessionEligibility } from '../../../shared/studentSessionEligibility';

export interface AttendanceEligibilityOverrideModalProps {
  isOpen: boolean;
  studentName: string;
  date: string;
  eligibility: SessionEligibility;
  isSubmitting?: boolean;
  submitError?: string | null;
  onClose: () => void;
  onConfirm: (input: { status: Attendance['status']; reason: string }) => Promise<void>;
}

export const AttendanceEligibilityOverrideModal: React.FC<
  AttendanceEligibilityOverrideModalProps
> = ({
  isOpen,
  studentName,
  date,
  eligibility,
  isSubmitting = false,
  submitError = null,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Attendance['status']>('present');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStatus('present');
      setReason('');
      setLocalError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      setLocalError(t.classAttendanceTab.overrideReasonRequired);
      return;
    }
    setLocalError(null);
    try {
      await onConfirm({ status, reason: trimmed });
    } catch (err: any) {
      setLocalError(err?.message || t.classAttendanceTab.overrideFailed);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100 relative">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4 text-amber-600">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">{t.classAttendanceTab.attendanceOverride}</h3>
            <p className="text-xs text-slate-500">
              {studentName} &bull; {date}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t.classAttendanceTab.status}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['present', 'absent', 'late'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatus(st)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                    status === st
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {st === 'present'
                    ? t.classAttendanceTab.present
                    : st === 'absent'
                      ? t.classAttendanceTab.absentFull
                      : t.classAttendanceTab.lateFull}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="override-reason-input"
              className="block text-xs font-bold text-slate-700 mb-1"
            >
              {t.classAttendanceTab.overrideReason}
            </label>
            <textarea
              id="override-reason-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.classAttendanceTab.overrideReasonRequired}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none"
            />
          </div>

          {(localError || submitError) && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
              {localError || submitError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
            >
              {t.common.cancel || 'Hủy'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{t.classAttendanceTab.confirmOverride}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
