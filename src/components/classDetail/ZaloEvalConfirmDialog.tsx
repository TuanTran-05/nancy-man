import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, RefreshCw, AlertCircle } from 'lucide-react';
import { Student, Evaluation } from '../../types';
import { formatVN } from '../../lib/core/utils';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import { useLanguage } from '../../lib/i18n/useLanguage';

interface ZaloEvalConfirmDialogProps {
  zaloEvalConfirmData: { student: Student; evaluation: Evaluation } | null;
  className: string | undefined;
  courseEndDate: string | undefined;
  isSendingZalo: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const ZaloEvalConfirmDialog: React.FC<ZaloEvalConfirmDialogProps> = ({
  zaloEvalConfirmData,
  className,
  courseEndDate,
  isSendingZalo,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();
  useBodyScrollLock(!!zaloEvalConfirmData);

  return (
    <ModalPortal>
      <AnimatePresence>
        {zaloEvalConfirmData &&
          (() => {
            const { student, evaluation } = zaloEvalConfirmData;
            const finalGrade =
              evaluation.finalScore !== undefined && evaluation.finalScore !== null
                ? String(evaluation.finalScore)
                : String(evaluation.totalScore);
            return (
              <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                >
                  {/* Header */}
                  <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-blue-500 to-blue-600">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                        <Send className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          {t.zaloEvalConfirmDialog.title}
                        </h3>
                        <p className="text-sm text-blue-100">
                          {t.zaloEvalConfirmDialog.description.replace(
                            '{type}',
                            evaluation.evaluationType === 'final'
                              ? t.zaloEvalConfirmDialog.final
                              : t.zaloEvalConfirmDialog.midterm
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-5 space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {t.zaloEvalConfirmDialog.student}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {student.name}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {t.zaloEvalConfirmDialog.studentCode}
                        </span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {student.studentId || student.code}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {t.zaloEvalConfirmDialog.classLabel}
                        </span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {className}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {t.zaloEvalConfirmDialog.courseEndDate}
                        </span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {courseEndDate ? formatVN(courseEndDate, 'dd/MM/yyyy') : 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {t.zaloEvalConfirmDialog.finalScore}
                        </span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">
                          {finalGrade}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {t.zaloEvalConfirmDialog.parentPhone}
                        </span>
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          {student.contact || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                      <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {t.zaloEvalConfirmDialog.znsWarning}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                    <button
                      onClick={onClose}
                      disabled={isSendingZalo}
                      className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                    >
                      {t.zaloEvalConfirmDialog.skip}
                    </button>
                    <button
                      onClick={onConfirm}
                      disabled={isSendingZalo || !student.contact}
                      className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSendingZalo ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />{' '}
                          {t.zaloEvalConfirmDialog.sending}
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" /> {t.zaloEvalConfirmDialog.sendNow}
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              </div>
            );
          })()}
      </AnimatePresence>
    </ModalPortal>
  );
};
