import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, MessageSquare, AlertCircle, RefreshCw, Search, Filter } from 'lucide-react';
import { Student, Class, UserProfile } from '../../types';
import { cn } from '../../lib/core/utils';

import { useLanguage } from '../../lib/i18n/useLanguage';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import { useMotionSafe } from '../../hooks/useMotionSafe';
import { Magnetic } from '../common/Magnetic';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  classes: Class[];
  teachers?: Pick<UserProfile, 'uid' | 'displayName'>[];
  onSend: (studentId: string, title: string, message: string, type: string) => Promise<void>;
}

export function CreateNotificationModal({
  isOpen,
  onClose,
  students,
  classes,
  teachers = [],
  onSend,
}: Props) {
  useBodyScrollLock(isOpen);
  const { language, t } = useLanguage();
  const T = t.notifModal;
  const [studentId, setStudentId] = useState('');
  const [type, setType] = useState('behavior');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modalMount, setModalMount] = useState(false);
  const { shouldReduceMotion } = useMotionSafe();

  // Auto-fill title based on type
  useEffect(() => {
    if (type === 'behavior') setTitle(T.defaultTitles.behavior);
    else if (type === 'absence') setTitle(T.defaultTitles.absence);
    else if (type === 'praise') setTitle(T.defaultTitles.praise);
    else if (type === 'general') setTitle('');
  }, [type, T]);

  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setStudentId('');
      setType('behavior');
      setMessage('');
      setSelectedClassId('');
      setSearchQuery('');
      setError(null);
      setModalMount(true);
    } else {
      setTimeout(() => setModalMount(false), 300);
    }
  }, [isOpen]);

  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      const matchesClass = selectedClassId ? student.classId === selectedClassId : true;
      const matchesSearch = student.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesClass && matchesSearch;
    });
  }, [students, selectedClassId, searchQuery]);
  const sortedClasses = useMemo(
    () => sortClassesByTeacherThenName(classes, teachers),
    [classes, teachers]
  );

  // Use isOpen for the wrapper but keep hooks at the top
  const isVisible = isOpen || modalMount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !title || !message) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onSend(studentId, title, message, type);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(T.error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
            />
            <motion.div
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 12 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 380, damping: 26 }
              }
              className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] border border-slate-100 dark:border-slate-700/50 z-10"
            >
              <div className="p-6 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between bg-blue-600 dark:bg-blue-600/90 text-white shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{T.title}</h2>
                    <p className="text-blue-100 text-xs">
                      {t.createNotificationModal.parentScreenHint}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t.notifModal.close}
                  onClick={onClose}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors border border-transparent"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto p-6 space-y-4">
                <form id="notification-form" onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-3 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/40">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                      <Filter className="w-4 h-4 text-blue-500" />
                      {T.filterClass}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <select
                          value={selectedClassId}
                          onChange={(e) => {
                            setSelectedClassId(e.target.value);
                            setStudentId(''); // Reset selected student when class changes
                          }}
                          className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm dark:text-slate-100"
                        >
                          <option value="">{T.allClasses}</option>
                          {sortedClasses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {formatClassNameWithTeacher(c, teachers)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                        <input
                          type="text"
                          placeholder={T.searchPlaceholder}
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setStudentId(''); // Reset selected student when search changes
                          }}
                          className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm dark:text-slate-100"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      {T.studentLabel} <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-slate-100"
                    >
                      <option value="">{T.studentPlaceholder}</option>
                      {filteredStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {filteredStudents.length === 0 && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        {T.noStudents}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      {T.typeLabel}
                    </label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-slate-100"
                    >
                      <option value="behavior">{T.types.behavior}</option>
                      <option value="absence">{T.types.absence}</option>
                      <option value="missing_assignment">
                        {t.createNotificationModal.missingAssignment}
                      </option>
                      <option value="praise">{T.types.praise}</option>
                      <option value="general">{T.types.general}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      {T.titleLabel} <span className="text-red-500">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-slate-100"
                      placeholder={T.titlePlaceholder}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      {T.messageLabel} <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none dark:text-slate-100"
                      placeholder={T.messagePlaceholder}
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {error}
                    </div>
                  )}
                </form>
              </div>

              <div className="p-6 pt-4 flex space-x-3 border-t border-slate-100 dark:border-slate-700/50 shrink-0">
                <Magnetic>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-4 py-2.5 border border-slate-100 dark:border-slate-600 text-slate-600 dark:text-slate-200 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors w-full"
                  >
                    {t.createNotificationModal.cancel}
                  </button>
                </Magnetic>
                <Magnetic>
                  <button
                    type="submit"
                    form="notification-form"
                    disabled={isSubmitting || !studentId || !title || !message}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm w-full"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {T.sending}
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        {T.sendAction}
                      </>
                    )}
                  </button>
                </Magnetic>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
