import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CalendarDays, BookOpen, AlertCircle, Loader2 } from 'lucide-react';
import { Class, SubstituteRequest, UserProfile } from '../../types';
import { cn, getDayFromStr } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { isScheduledClassDate } from '../../../shared/classSchedule';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import { ApiDateTextInput } from '../forms/ApiDateTimeInputs';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  classes: Class[];
  teachers?: Pick<UserProfile, 'uid' | 'displayName'>[];
  existingRequests: SubstituteRequest[];
  onSubmit: (classId: string, className: string, date: string, reason: string) => Promise<void>;
}

export function CreateSubstituteRequestModal({
  isOpen,
  onClose,
  classes,
  teachers = [],
  existingRequests,
  onSubmit,
}: Props) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const T = t.substitute;

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeClasses = sortClassesByTeacherThenName(
    classes.filter((classInfo) => classInfo.status === 'active'),
    teachers
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedClassId('');
      setSelectedDate('');
      setReason('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  const getMinDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const validate = (): string | null => {
    if (!selectedClassId) return T.selectClass;
    if (!selectedDate) return T.dateLabel;

    const minDate = getMinDate();
    if (selectedDate < minDate) return T.dateTooSoon;

    // Check if date is a class day
    if (selectedClass) {
      if (!isScheduledClassDate(selectedClass, selectedDate)) {
        return T.dateNotClassDay;
      }
    }

    // Check if teacher already has a request for this date
    const duplicate = existingRequests.some(
      (r) => r.date === selectedDate && r.status !== 'cancelled'
    );
    if (duplicate) return T.dateAlreadyRequested;

    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(selectedClassId, selectedClass!.name, selectedDate, reason.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-blue-500" />
                  {T.createRequest}
                </h3>
                <button
                  type="button"
                  aria-label={t.common.close}
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Class selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {T.selectClass}
                  </label>
                  <select
                    value={selectedClassId}
                    onChange={(e) => {
                      setSelectedClassId(e.target.value);
                      setError(null);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  >
                    <option value="">{T.selectClassPlaceholder}</option>
                    {activeClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatClassNameWithTeacher(c, teachers)} ({c.schedule})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {T.dateLabel}
                  </label>
                  <ApiDateTextInput
                    label={T.dateLabel}
                    hideLabel
                    value={selectedDate}
                    min={getMinDate()}
                    onChange={(date) => {
                      setSelectedDate(date);
                      setError(null);
                    }}
                    inputClassName="w-full px-3 py-2.5 rounded-lg border-gray-300 bg-white text-gray-900 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{T.dateHint}</p>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {T.reasonLabel}
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={T.reasonPlaceholder}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors resize-none"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? T.submitting : T.submit}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
