import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Send, X } from 'lucide-react';
import { useMotionSafe } from '../../hooks/useMotionSafe';
import { ModalPortal } from '../common/ModalPortal';

export interface ZaloActionDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  closeLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  isPending?: boolean;
  isConfirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}

export function ZaloActionDialog({
  isOpen,
  title,
  description,
  closeLabel,
  cancelLabel,
  confirmLabel,
  isPending = false,
  isConfirmDisabled = false,
  onClose,
  onConfirm,
  children,
}: ZaloActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { shouldReduceMotion, spring } = useMotionSafe();

  return (
    <ModalPortal lockScroll={isOpen} trapFocus={isOpen}>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              data-testid="zalo-action-dialog-backdrop"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descriptionId : undefined}
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 20 }}
              transition={spring}
              className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl overscroll-contain"
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-light p-6">
                <div className="min-w-0">
                  <h2 id={titleId} className="text-xl font-bold text-heading">
                    {title}
                  </h2>
                  {description && (
                    <p id={descriptionId} className="mt-1 text-sm text-subtle">
                      {description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  aria-label={closeLabel}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain p-6">
                {children}
                <div className="flex gap-3 pt-5">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isPending}
                    className="flex-1 rounded-xl border border-border-default px-4 py-2 font-medium text-slate-600 transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isPending || isConfirmDisabled}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white shadow-lg shadow-blue-100 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-none"
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {confirmLabel}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
