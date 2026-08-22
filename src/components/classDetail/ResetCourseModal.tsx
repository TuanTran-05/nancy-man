import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import { getRequiredSessions, suggestEndDate } from '../../lib/classes/courseDateUtils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ApiDateTextInput } from '../forms/ApiDateTimeInputs';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';
import type { ResetCourseError } from '../../pages/common/hooks/useClassDetailMisc';

interface ResetCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  className: string;
  grade?: number;
  daysOfWeek: number[];
  holidays: string[];
  outgoingEndDate?: string;
  resetDates: { startDate: string; endDate: string };
  onResetDatesChange: React.Dispatch<React.SetStateAction<{ startDate: string; endDate: string }>>;
  isResettingClass: boolean;
  onSubmit: (e: React.FormEvent) => void;
  courseClosing?: CourseClosingSnapshot | null;
  resetError?: ResetCourseError | null;
}

export const ResetCourseModal: React.FC<ResetCourseModalProps> = ({
  isOpen,
  onClose,
  className,
  grade,
  daysOfWeek,
  holidays,
  outgoingEndDate,
  resetDates,
  onResetDatesChange,
  isResettingClass,
  onSubmit,
  courseClosing,
  resetError,
}) => {
  const { t } = useLanguage();
  useBodyScrollLock(isOpen);
  // The backend is the authority; when no snapshot has loaded we do not block
  // the form locally, we simply cannot explain the blocker ahead of time.
  const closingBlocked = Boolean(courseClosing && courseClosing.status !== 'completed');
  // Catches the exact accident that creates a phantom archived term: the modal
  // may open pre-filled with the outgoing course's own dates, and a submit
  // without editing them would re-archive the still-running course onto itself.
  const startDateTooEarly = Boolean(
    outgoingEndDate && resetDates.startDate && resetDates.startDate < outgoingEndDate
  );
  // Auto-calculate endDate when startDate changes (session-based)
  useEffect(() => {
    if (!resetDates.startDate) return;
    const endDate = suggestEndDate({
      startDate: resetDates.startDate,
      grade,
      daysOfWeek,
      holidays,
    });
    if (!endDate) return;
    onResetDatesChange((prev) => (prev.endDate === endDate ? prev : { ...prev, endDate }));
  }, [resetDates.startDate, grade, daysOfWeek, holidays, onResetDatesChange]);

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
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
              className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-border-light flex items-center justify-between bg-amber-600 text-white">
                <div>
                  <h2 className="text-xl font-bold">{t.resetCourseModal.title}</h2>
                  <p className="text-amber-100 text-sm">
                    {t.resetCourseModal.subtitle.replace('{className}', className)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t.resetCourseModal.close}
                  onClick={onClose}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={onSubmit} className="p-6 space-y-4">
                <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 p-4 rounded-xl text-amber-800 text-sm">
                  <p className="font-bold mb-1">{t.resetCourseModal.notice}</p>
                  <p>{t.resetCourseModal.noticeText}</p>
                </div>

                {courseClosing && (
                  <div className="rounded-xl border border-border-light p-4 text-sm">
                    <p className="font-bold text-slate-700">{t.resetCourseModal.closingTitle}</p>
                    <p className="mt-1 font-semibold text-slate-600">
                      {t.courseClosing.statuses[courseClosing.status]}
                    </p>
                    {closingBlocked && (
                      <ul className="mt-2 space-y-1 text-slate-600">
                        <li>
                          {t.resetCourseModal.closingPendingEvaluation.replace(
                            '{count}',
                            String(courseClosing.pendingEvaluationStudentIds.length)
                          )}
                        </li>
                        <li>
                          {t.resetCourseModal.closingPendingRank.replace(
                            '{count}',
                            String(courseClosing.pendingRankStudentIds.length)
                          )}
                        </li>
                        <li>
                          {t.resetCourseModal.closingPendingTuition.replace(
                            '{count}',
                            String(courseClosing.pendingTuitionStudentIds.length)
                          )}
                        </li>
                        {courseClosing.exemptStudentCount > 0 && (
                          <li>
                            {t.resetCourseModal.closingExempt.replace(
                              '{count}',
                              String(courseClosing.exemptStudentCount)
                            )}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}

                {closingBlocked && (
                  <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    {t.resetCourseModal.closingBlocked}
                  </p>
                )}

                {resetError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {resetError.message}
                  </p>
                )}

                {startDateTooEarly && (
                  <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    {t.resetCourseModal.startDateTooEarly.replace('{date}', outgoingEndDate || '')}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <ApiDateTextInput
                      label={t.resetCourseModal.startDate}
                      required
                      value={resetDates.startDate}
                      onChange={(startDate) => onResetDatesChange({ ...resetDates, startDate })}
                      inputClassName="w-full px-4 py-2 bg-page border-border-default rounded-xl focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <ApiDateTextInput
                      label={t.resetCourseModal.endDate}
                      required
                      value={resetDates.endDate}
                      onChange={(endDate) => onResetDatesChange({ ...resetDates, endDate })}
                      inputClassName="w-full px-4 py-2 bg-page border-border-default rounded-xl focus:ring-amber-500"
                    />
                    {resetDates.startDate && resetDates.endDate && (
                      <p className="text-xs text-amber-500 mt-1">
                        {t.resetCourseModal.sessions.replace(
                          '{count}',
                          String(getRequiredSessions(grade))
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-4 py-2 border border-border-default text-slate-600 font-medium rounded-xl hover:bg-hover transition-colors"
                  >
                    {t.resetCourseModal.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={isResettingClass || closingBlocked || startDateTooEarly}
                    className="flex-1 px-4 py-2 bg-amber-600 text-white font-medium rounded-xl hover:bg-amber-700 transition-colors shadow-lg shadow-amber-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {isResettingClass ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        {t.resetCourseModal.resetting}
                      </>
                    ) : (
                      t.resetCourseModal.resetNow
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
};
