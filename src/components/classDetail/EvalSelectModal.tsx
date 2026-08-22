import React from 'react';
import { motion } from 'framer-motion';
import { X, FileText, Award, Edit2, Plus } from 'lucide-react';
import { Student, Evaluation } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';

interface EvalSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  midtermEval: Evaluation | null;
  finalEval: Evaluation | null;
  onSelect: (type: 'midterm' | 'final', existingEval?: Evaluation) => void;
}

export const EvalSelectModal: React.FC<EvalSelectModalProps> = ({
  isOpen,
  onClose,
  student,
  midtermEval,
  finalEval,
  onSelect,
}) => {
  const { language } = useLanguage();
  const t = translations[language].evalSelect;
  const tc = translations[language].common;
  useBodyScrollLock(isOpen);

  if (!isOpen || !student) return null;

  const renderOption = (
    type: 'midterm' | 'final',
    existingEval: Evaluation | null,
    icon: React.ReactNode,
    color: string
  ) => {
    const hasEval = !!existingEval;
    const colorClasses =
      type === 'midterm'
        ? {
            bg: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20',
            border: 'border-amber-200 dark:border-amber-500/30',
            icon: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
            badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
            btn: 'bg-amber-600 hover:bg-amber-700',
          }
        : {
            bg: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20',
            border: 'border-emerald-200 dark:border-emerald-500/30',
            icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
            badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
            btn: 'bg-emerald-600 hover:bg-emerald-700',
          };

    return (
      <button
        onClick={() => {
          onSelect(type, existingEval || undefined);
          onClose();
        }}
        className={`w-full p-4 rounded-xl border ${colorClasses.border} ${colorClasses.bg} transition-all text-left group`}
      >
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-xl ${colorClasses.icon}`}>{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-slate-900 dark:text-slate-100">
                {type === 'midterm' ? t.midterm : t.final}
              </h3>
              {hasEval && (
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${colorClasses.badge}`}
                >
                  {t.hasEval}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              {type === 'midterm' ? t.midtermDesc : t.finalDesc}
            </p>
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white ${colorClasses.btn} transition-colors`}
            >
              {hasEval ? (
                <>
                  <Edit2 className="w-3 h-3" />
                  {t.viewEdit}
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  {t.createNew}
                </>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-xl"
        >
          <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t.title}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{student.name}</p>
            </div>
            <button
              type="button"
              aria-label={translations[language].evaluationModal.close}
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {renderOption('midterm', midtermEval, <FileText className="w-5 h-5" />, 'amber')}
            {renderOption('final', finalEval, <Award className="w-5 h-5" />, 'emerald')}
          </div>

          <div className="px-5 pb-5">
            <button
              onClick={onClose}
              className="w-full py-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              {tc.cancel}
            </button>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
};
