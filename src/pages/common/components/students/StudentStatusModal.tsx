import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw } from 'lucide-react';
import { ModalPortal } from '../../../../components/common/ModalPortal';
import type { SafeStudent } from '../../../../types';

interface StudentStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentToChangeStatus: SafeStudent | null;
  statusFormData: {
    enrollmentStatus: string;
    statusNote: string;
  };
  setStatusFormData: React.Dispatch<
    React.SetStateAction<{
      enrollmentStatus: string;
      statusNote: string;
    }>
  >;
  handleStatusChangeSubmit: (e: React.FormEvent) => void;
  isSaving: boolean;
  t: any;
  tc: any;
}

export const StudentStatusModal: React.FC<StudentStatusModalProps> = ({
  isOpen,
  onClose,
  studentToChangeStatus,
  statusFormData,
  setStatusFormData,
  handleStatusChangeSubmit,
  isSaving,
  t,
  tc,
}) => {
  if (!isOpen || !studentToChangeStatus) return null;

  return (
    <AnimatePresence>
      <ModalPortal>
        <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
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
            className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border-light px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-heading">{t.statusModal.title}</h2>
                <p className="mt-1 truncate text-sm text-muted">{studentToChangeStatus.name}</p>
              </div>
              <button
                onClick={onClose}
                className="flex-shrink-0 rounded-lg p-2 transition-colors hover:bg-slate-100"
              >
                <X className="w-5 h-5 text-muted" />
              </button>
            </div>
            <form
              onSubmit={handleStatusChangeSubmit}
              className="space-y-5 overflow-y-auto p-5 sm:p-6"
            >
              <div className="rounded-2xl border border-border-light bg-page px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-widest text-subtle">
                  {t.studentLabel}
                </p>
                <p className="mt-1 break-words text-sm font-semibold text-heading">
                  {studentToChangeStatus.name}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.statusModal.label}
                </label>
                <select
                  value={statusFormData.enrollmentStatus}
                  onChange={(e) =>
                    setStatusFormData({ ...statusFormData, enrollmentStatus: e.target.value })
                  }
                  className="w-full rounded-xl border border-border-default bg-page px-4 py-2.5 text-heading outline-none transition-all focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">{t.filterActive}</option>
                  <option value="on_leave">{t.filterOnLeave}</option>
                  <option value="dropped">{t.filterDropped}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.statusModal.noteLabel}
                </label>
                <textarea
                  value={statusFormData.statusNote}
                  onChange={(e) =>
                    setStatusFormData({ ...statusFormData, statusNote: e.target.value })
                  }
                  className="w-full resize-none rounded-xl border border-border-default bg-page px-4 py-2.5 text-heading outline-none transition-all focus:ring-2 focus:ring-blue-500"
                  placeholder={t.statusModal.notePlaceholder}
                  rows={3}
                />
              </div>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 flex-1 rounded-xl border border-border-default px-4 py-2 font-medium text-slate-600 transition-colors hover:bg-hover"
                >
                  {tc.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-blue-600 px-4 py-2 font-medium text-white shadow-lg shadow-blue-100 transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      <span>{t.saving}</span>
                    </>
                  ) : (
                    t.statusModal.save
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      </ModalPortal>
    </AnimatePresence>
  );
};
