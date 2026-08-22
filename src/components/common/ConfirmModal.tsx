import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Trash2 } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from './ModalPortal';
import { useMotionSafe } from '../../hooks/useMotionSafe';
import { Magnetic } from './Magnetic';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  isLoading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  isDanger = true,
  isLoading = false,
}: ConfirmModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const resolvedConfirmText = confirmText ?? t.confirmModal.defaultConfirm;
  const resolvedCancelText = cancelText ?? t.confirmModal.defaultCancel;
  const { shouldReduceMotion } = useMotionSafe();

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
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 6 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 380, damping: 26 }
              }
              className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-sm w-full overflow-hidden flex flex-col border border-slate-100 dark:border-slate-700/50 z-10"
            >
              <div className="p-6">
                <div
                  className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${isDanger ? 'bg-red-100 dark:bg-red-500/10' : 'bg-blue-100 dark:bg-blue-500/10'} mb-4`}
                >
                  {isDanger ? (
                    <Trash2 className="h-6 w-6 text-red-600 dark:text-red-400" />
                  ) : (
                    <AlertCircle className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <h3 className="text-lg font-bold text-center text-slate-900 dark:text-slate-100 mb-2">
                  {title}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center">{message}</p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-100 dark:border-slate-700/50 flex gap-3 justify-end items-center">
                <Magnetic>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors flex-1 w-full shadow-sm"
                  >
                    {resolvedCancelText}
                  </button>
                </Magnetic>
                <Magnetic>
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isLoading}
                    className={`px-4 py-2 text-sm font-bold text-white rounded-xl transition-colors flex-1 w-full shadow-sm flex justify-center items-center ${
                      isDanger
                        ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-400'
                        : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400'
                    }`}
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      resolvedConfirmText
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
