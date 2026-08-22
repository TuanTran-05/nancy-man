import React from 'react';
import { motion } from 'framer-motion';
import { X, Bell, RefreshCw } from 'lucide-react';
import { Assignment, Student, Submission } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';

interface NotifyMissingAssignmentModalProps {
  assignment: Assignment | null;
  onClose: () => void;
  students: Student[];
  submissions: Submission[];
  onSendNotification: (
    studentId: string,
    title: string,
    message: string,
    type: 'absence' | 'missing_assignment' | 'general',
    classId?: string
  ) => Promise<void>;
  sendingNotificationId: string | null;
}

export function NotifyMissingAssignmentModal({
  assignment,
  onClose,
  students,
  submissions,
  onSendNotification,
  sendingNotificationId,
}: NotifyMissingAssignmentModalProps) {
  const { t } = useLanguage();
  const T = t.pageAssignments;
  useBodyScrollLock(!!assignment);

  if (!assignment) return null;

  const classStudents = students.filter((s) => s.classId === assignment.classId);
  const assignmentSubmissions = submissions.filter((s) => s.assignmentId === assignment.id);
  const missingStudents = classStudents.filter(
    (student) => !assignmentSubmissions.some((sub) => sub.studentId === student.id)
  );

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
          <div className="p-6 border-b border-slate-100 dark:border-slate-600 flex items-center justify-between bg-slate-50/50 dark:bg-slate-700/50 shrink-0">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {T.notifyMissingTitle}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {T.assignmentLabel.replace('{title}', assignment.title)}
              </p>
            </div>
            <button
              type="button"
              aria-label={T.close}
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto">
            {missingStudents.length === 0 ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                {T.allSubmitted}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  {T.missingStudentsList.replace('{count}', missingStudents.length.toString())}
                </p>
                {missingStudents.map((student) => (
                  <div
                    key={student.id}
                    className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-100 dark:border-slate-600"
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {student.name}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          onSendNotification(
                            student.id,
                            T.remindTitle.replace('{title}', assignment.title),
                            T.remindMessage
                              .replace('{name}', student.name)
                              .replace('{title}', assignment.title)
                              .replace('{dueDate}', assignment.dueDate),
                            'missing_assignment',
                            assignment.classId
                          );
                        }}
                        disabled={sendingNotificationId === student.id}
                        className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50 flex items-center space-x-1 text-xs font-medium"
                        title={T.remindApp}
                      >
                        {sendingNotificationId === student.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Bell className="w-3 h-3" />
                        )}
                        <span>{T.remindApp}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-6 border-t border-slate-100 dark:border-slate-600 bg-slate-50/30 dark:bg-slate-700/30 shrink-0">
            <button
              onClick={onClose}
              className="w-full py-3 bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors shadow-sm"
            >
              {T.close}
            </button>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
