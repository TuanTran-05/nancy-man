import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { ModalPortal } from '../../../../components/common/ModalPortal';

interface StudentDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  handleDelete: () => void;
  isDeleting: boolean;
  t: any;
  tc: any;
}

export const StudentDeleteModal: React.FC<StudentDeleteModalProps> = ({
  isOpen,
  onClose,
  handleDelete,
  isDeleting,
  t,
  tc,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-hidden="true"
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
            >
              <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-heading mb-2">
                {t.messages.deleteConfirmTitle}
              </h3>
              <p className="text-muted mb-6">{t.messages.deleteConfirmDesc}</p>
              <div className="flex space-x-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border border-border-default text-slate-600 font-medium rounded-xl hover:bg-hover transition-colors"
                >
                  {tc.cancel}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? t.removing : t.messages.deleteBtn}
                </button>
              </div>
            </motion.div>
          </div>
        </ModalPortal>
      )}
    </AnimatePresence>
  );
};
