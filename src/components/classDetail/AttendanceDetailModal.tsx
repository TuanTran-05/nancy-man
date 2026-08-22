import React from 'react';
import { motion } from 'framer-motion';
import { X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Student, Attendance } from '../../types';
import { cn } from '../../lib/core/utils';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';

interface AttendanceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  attendance: Attendance | null;
  student: Student | undefined;
  onUpdate: (e: React.FormEvent) => void;
  setAttendance: (attendance: Attendance) => void;
  isSaving: boolean;
}

export function AttendanceDetailModal({
  isOpen,
  onClose,
  attendance,
  student,
  onUpdate,
  setAttendance,
  isSaving,
}: AttendanceDetailModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  if (!isOpen || !attendance) return null;

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
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-800 text-white">
            <div>
              <h2 className="text-xl font-bold">{t.attendanceDetailModal.title}</h2>
              <p className="text-slate-300 text-sm">
                {student?.name} • {attendance.date}
              </p>
            </div>
            <button
              type="button"
              aria-label={t.attendanceDetailModal.close}
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={onUpdate} className="p-6 space-y-6">
            {attendance.status === 'absent' && (
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-center">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center mr-3',
                      attendance.permission
                        ? 'bg-emerald-100 text-emerald-600'
                        : 'bg-red-100 text-red-600'
                    )}
                  >
                    {attendance.permission ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <X className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-sm">
                      {t.attendanceDetailModal.permissionLabel}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {t.attendanceDetailModal.permissionDesc}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setAttendance({
                      ...attendance,
                      permission: !attendance.permission,
                    })
                  }
                  className={cn(
                    'relative inline-flex h-5 w-10 items-center rounded-full transition-colors outline-none',
                    attendance.permission ? 'bg-emerald-600' : 'bg-slate-300'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                      attendance.permission ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>
            )}

            {attendance.status === 'late' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.attendanceDetailModal.minutesLate}
                </label>
                <input
                  type="number"
                  min="0"
                  value={attendance.minutesLate || 0}
                  onChange={(e) =>
                    setAttendance({
                      ...attendance,
                      minutesLate: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                />
              </div>
            )}

            {attendance.status === 'present' && (
              <div className="py-8 text-center text-slate-400 italic">
                {t.attendanceDetailModal.presentNote}
              </div>
            )}

            <div className="pt-4 flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                {t.attendanceDetailModal.cancel}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {t.attendanceDetailModal.saving}
                  </>
                ) : (
                  t.attendanceDetailModal.save
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
