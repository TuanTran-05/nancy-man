import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { isJoinedAtInWindow, type ClassJoinWindow } from '../../../shared/classJoinWindow';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import { ApiDateTextInput } from '../forms/ApiDateTimeInputs';

interface ClosedCourseJoinModalProps {
  isOpen: boolean;
  className: string;
  window: ClassJoinWindow;
  isBusy: boolean;
  onConfirmCurrentTerm: (joinedAt: string) => void;
  onClose: () => void;
}

type Choice = 'unchosen' | 'current_term' | 'next_term';

export const ClosedCourseJoinModal: React.FC<ClosedCourseJoinModalProps> = ({
  isOpen,
  className,
  window: joinWindow,
  isBusy,
  onConfirmCurrentTerm,
  onClose,
}) => {
  const { t } = useLanguage();
  const copy = t.closedCourseJoinModal;
  useBodyScrollLock(isOpen);
  const [choice, setChoice] = useState<Choice>('unchosen');
  const [joinedAt, setJoinedAt] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setChoice('unchosen');
    setJoinedAt('');
  }, [isOpen]);

  const termEndText = joinWindow.termEnd || '';
  const dateValid = joinedAt !== '' && isJoinedAtInWindow(joinWindow, joinedAt);
  const isOpenTerm = joinWindow.termEnd === null;
  const subtitle =
    joinWindow.closedReason === 'closing_completed'
      ? copy.subtitleClosingCompleted.replace('{className}', className)
      : copy.subtitleTermEnded.replace('{className}', className).replace('{endDate}', termEndText);
  const rangeText = isOpenTerm
    ? copy.joinedAtRangeOpen.replace('{termStart}', joinWindow.termStart)
    : copy.joinedAtRange
        .replace('{termStart}', joinWindow.termStart)
        .replace('{termEnd}', termEndText);
  const outOfRangeText = isOpenTerm
    ? copy.joinedAtOutOfRangeOpen.replace('{termStart}', joinWindow.termStart)
    : copy.joinedAtOutOfRange
        .replace('{termStart}', joinWindow.termStart)
        .replace('{termEnd}', termEndText);

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
              aria-hidden="true"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="closed-course-join-title"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl"
            >
              <div className="flex items-start justify-between border-b border-border-light bg-amber-600 p-6 text-white">
                <div className="flex gap-3">
                  <AlertTriangle className="h-6 w-6 shrink-0" />
                  <div>
                    <h2 id="closed-course-join-title" className="text-xl font-bold">
                      {copy.title}
                    </h2>
                    <p className="text-sm text-amber-100">{subtitle}</p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={copy.close}
                  onClick={onClose}
                  className="rounded-lg p-2 transition-colors hover:bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 p-6">
                {choice === 'unchosen' && (
                  <>
                    <p className="text-sm font-medium text-slate-700">{copy.question}</p>
                    <button
                      type="button"
                      onClick={() => setChoice('current_term')}
                      className="w-full rounded-xl border border-border-default p-4 text-left transition-colors hover:bg-hover"
                    >
                      <span className="block font-bold text-slate-700">
                        {copy.currentTermOption}
                      </span>
                      <span className="block text-sm text-slate-600">{copy.currentTermHint}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChoice('next_term')}
                      className="w-full rounded-xl border border-border-default p-4 text-left transition-colors hover:bg-hover"
                    >
                      <span className="block font-bold text-slate-700">{copy.nextTermOption}</span>
                      <span className="block text-sm text-slate-600">{copy.nextTermHint}</span>
                    </button>
                  </>
                )}

                {choice === 'current_term' && (
                  <>
                    <ApiDateTextInput
                      label={copy.joinedAtLabel}
                      required
                      value={joinedAt}
                      onChange={setJoinedAt}
                      inputClassName="w-full rounded-xl border-border-default bg-page px-4 py-2 focus:ring-amber-500"
                    />
                    <p className="text-xs text-slate-600">{rangeText}</p>
                    {joinedAt !== '' && !dateValid && (
                      <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                        {outOfRangeText}
                      </p>
                    )}
                    <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10">
                      {copy.attendanceNotice}
                    </p>
                    <div className="flex space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setChoice('unchosen')}
                        className="flex-1 rounded-xl border border-border-default px-4 py-2 font-medium text-slate-600 transition-colors hover:bg-hover"
                      >
                        {copy.back}
                      </button>
                      <button
                        type="button"
                        disabled={!dateValid || isBusy}
                        onClick={() => onConfirmCurrentTerm(joinedAt)}
                        className="flex-1 rounded-xl bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {copy.confirm}
                      </button>
                    </div>
                  </>
                )}

                {choice === 'next_term' && (
                  <>
                    <p className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10">
                      {copy.nextTermNotice}
                    </p>
                    <div className="flex space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setChoice('unchosen')}
                        className="flex-1 rounded-xl border border-border-default px-4 py-2 font-medium text-slate-600 transition-colors hover:bg-hover"
                      >
                        {copy.back}
                      </button>
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 rounded-xl bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700"
                      >
                        {copy.close}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
};
