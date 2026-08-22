import React from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../lib/i18n/useLanguage';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function StudentDictionaryPanel({ open, onClose }: Props) {
  const { t } = useLanguage();
  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-[1010] w-80 bg-white dark:bg-slate-800 shadow-2xl flex flex-col border-l border-slate-100 dark:border-slate-700">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-blue-600 text-white">
        <h3 className="font-bold">{t.studentDictionaryPanel.title}</h3>
        <button
          type="button"
          aria-label={t.studentDictionaryPanel.close}
          onClick={onClose}
          className="p-1 hover:bg-white/20 rounded"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 flex-1 overflow-y-auto">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.studentDictionaryPanel.comingSoon}
        </p>
      </div>
    </div>
  );
}
