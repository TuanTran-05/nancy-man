import React from 'react';
import { motion } from 'framer-motion';
import { X, RefreshCw, Bell, Send, Phone, CheckCircle } from 'lucide-react';
import { Student, Class, Attendance } from '../../types';
import { cn, formatVN } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { isValidVNPhone } from '../../lib/zalo/zaloService';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';

interface NotifyAbsenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string | null;
  students: Student[];
  classData: Class;
  attendanceData: Attendance[];
  handleSendNotification: (
    studentId: string,
    title: string,
    message: string,
    type: 'absence' | 'missing_assignment' | 'general'
  ) => Promise<void>;
  sendingNotificationId: string | null;
  zaloAbsenceCounts?: Record<string, number>;
  onSendZalo?: (studentId: string) => void;
}

export function NotifyAbsenceModal({
  isOpen,
  onClose,
  date,
  students,
  classData,
  attendanceData,
  handleSendNotification,
  sendingNotificationId,
  zaloAbsenceCounts = {},
  onSendZalo,
}: NotifyAbsenceModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  if (!isOpen || !date) return null;

  const absentStudents = students.filter((student) => {
    if (student.enrollmentStatus === 'dropped' || student.enrollmentStatus === 'promoted')
      return false;
    const attendance = attendanceData.find((a) => a.studentId === student.id && a.date === date);
    return attendance?.status === 'absent';
  });

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
          className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {t.notifyAbsenceModal.headerTitle}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {t.notifyAbsenceModal.dateLabel.replace('{date}', formatVN(date, 'dd/MM/yyyy'))}
              </p>
            </div>
            <button
              type="button"
              aria-label={t.notifyAbsenceModal.close}
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto">
            {absentStudents.length === 0 ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                {t.notifyAbsenceModal.noAbsentStudents}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Bulk Zalo action */}
                {onSendZalo &&
                  absentStudents.some((s) => s.contact && isValidVNPhone(s.contact)) && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                      <p className="text-xs text-blue-700 dark:text-blue-300 mb-2 font-medium">
                        {t.notifyAbsenceModal.zaloBulkHint}
                      </p>
                    </div>
                  )}

                {absentStudents.map((student) => {
                  const title = t.notifyAbsenceModal.title.replace('{class}', classData.name);
                  const message = t.notifyAbsenceModal.message
                    .replace('{student}', student.name)
                    .replace('{date}', formatVN(date, 'dd/MM/yyyy'));
                  const hasValidPhone = student.contact && isValidVNPhone(student.contact);

                  return (
                    <div
                      key={student.id}
                      className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="font-medium text-slate-900 dark:text-white">
                            {student.name}
                          </div>
                          {student.contact && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Phone className="w-3 h-3 text-slate-400" />
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {student.contact}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* In-app notification button */}
                        <button
                          disabled={sendingNotificationId === student.id}
                          className={cn(
                            'px-3 py-2 rounded-lg font-medium text-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed',
                            'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-500/30'
                          )}
                          onClick={() => {
                            handleSendNotification(student.id, title, message, 'absence');
                          }}
                        >
                          {sendingNotificationId === student.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Bell className="w-3 h-3" />
                          )}
                          <span>{t.notifyAbsenceModal.sendOnApp}</span>
                        </button>

                        {/* Zalo OA button */}
                        {onSendZalo &&
                          (() => {
                            const sentCount = zaloAbsenceCounts[student.id] || 0;
                            const limitReached = sentCount >= 2;
                            return limitReached ? (
                              <span className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center space-x-1.5">
                                <CheckCircle className="w-3 h-3" />
                                <span>
                                  {t.notifyAbsenceModal.notified.replace(
                                    '{count}',
                                    String(sentCount)
                                  )}
                                </span>
                              </span>
                            ) : (
                              <button
                                disabled={!hasValidPhone}
                                className={cn(
                                  'px-3 py-2 rounded-lg font-medium text-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed',
                                  hasValidPhone
                                    ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-500/30'
                                    : 'bg-slate-100 dark:bg-slate-600 text-slate-400 dark:text-slate-500'
                                )}
                                onClick={() => hasValidPhone && onSendZalo(student.id)}
                                title={
                                  hasValidPhone
                                    ? t.notifyAbsenceModal.sendViaZalo.replace(
                                        '{count}',
                                        String(sentCount)
                                      )
                                    : t.notifyAbsenceModal.invalidPhone
                                }
                              >
                                <Send className="w-3 h-3" />
                                <span>
                                  {t.notifyAbsenceModal.sendZaloBtn.replace(
                                    '{count}',
                                    String(sentCount)
                                  )}
                                </span>
                              </button>
                            );
                          })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
