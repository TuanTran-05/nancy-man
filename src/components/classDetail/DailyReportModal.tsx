import React from 'react';
import { motion } from 'framer-motion';
import { X, RefreshCw, Download, Loader2 } from 'lucide-react';
import { Class, DailyReport } from '../../types';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import { ApiDateTextInput } from '../forms/ApiDateTimeInputs';

interface DailyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  classData: Class;
  dailyReports: DailyReport[];
  formData: {
    date: string;
    generalComment: string;
    additionalNotes: string;
  };
  setFormData: (data: any) => void;
  onSubmit: (e: React.FormEvent) => void;
  onExport: () => void;
  isSaving: boolean;
  isExporting?: boolean;
  pendingAttendanceCount?: number;
  completionState?: 'pending_attendance' | 'attendance_done' | 'completed';
}

export function DailyReportModal({
  isOpen,
  onClose,
  classData,
  dailyReports,
  formData,
  setFormData,
  onSubmit,
  onExport,
  isSaving,
  isExporting = false,
  pendingAttendanceCount = 0,
  completionState = 'attendance_done',
}: DailyReportModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-blue-600 text-white">
            <div>
              <h2 className="text-xl font-bold">{t.dailyReportModal.title}</h2>
              <p className="text-blue-100 text-sm">{classData.name}</p>
            </div>
            <button
              type="button"
              aria-label={t.dailyReportModal.close}
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={onSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
            {completionState === 'pending_attendance' && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {t.dailyReportModal.pendingAttendanceWarning.replace(
                  '{count}',
                  String(pendingAttendanceCount)
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.dailyReportModal.date}
                </label>
                <ApiDateTextInput
                  label={t.dailyReportModal.date}
                  hideLabel
                  required
                  value={formData.date}
                  onChange={(newDate) => {
                    const existing = dailyReports.find((r) => r.date === newDate);
                    setFormData({
                      ...formData,
                      date: newDate,
                      generalComment: existing?.generalComment || '',
                      additionalNotes: existing?.additionalNotes || '',
                    });
                  }}
                  inputClassName="w-full px-4 py-2 bg-slate-50 border-slate-100 rounded-xl focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t.dailyReportModal.generalComment}
              </label>
              <textarea
                required
                value={formData.generalComment}
                onChange={(e) => setFormData({ ...formData, generalComment: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none h-32 resize-none"
                placeholder={t.dailyReportModal.classReportPlaceholder}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t.dailyReportModal.additionalNotes}
              </label>
              <textarea
                value={formData.additionalNotes}
                onChange={(e) => setFormData({ ...formData, additionalNotes: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                placeholder={t.dailyReportModal.homeworkPlaceholder}
              />
            </div>

            <div className="pt-4 flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                {t.dailyReportModal.cancel}
              </button>
              <button
                type="button"
                onClick={onExport}
                disabled={isExporting}
                aria-busy={isExporting}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-100 flex items-center justify-center space-x-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>{isExporting ? 'Exporting...' : t.dailyReportModal.exportPDF}</span>
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {t.dailyReportModal.saving}
                  </>
                ) : (
                  t.dailyReportModal.saveReport
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
