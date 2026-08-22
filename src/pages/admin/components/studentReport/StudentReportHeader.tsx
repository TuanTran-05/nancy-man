import React from 'react';
import { ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react';

type Props = {
  studentName: string;
  studentCode: string;
  studentStatus: string;
  onBack: () => void;
  onRefresh: () => void;
  generatedAt: string | null;
  isRefreshing: boolean;
  t: any;
};

export const StudentReportHeader: React.FC<Props> = ({
  studentName,
  studentCode,
  studentStatus,
  onBack,
  onRefresh,
  generatedAt,
  isRefreshing,
  t,
}) => {
  return (
    <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div className="flex items-center gap-3">
        <button
          id="student-report-back-btn"
          onClick={onBack}
          className="p-2 rounded-xl border border-border-light hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-muted"
          aria-label={t.backLabel}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-heading">{t.title}</h1>
          <div className="flex items-center gap-2 mt-0.5 text-sm text-muted">
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">
              {studentName}
            </span>
            {studentCode && (
              <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                {studentCode}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {generatedAt && (
          <span className="text-xs text-muted">
            {t.generatedAt}: {new Date(generatedAt).toLocaleTimeString('vi-VN')}
          </span>
        )}
        <button
          id="student-report-refresh-btn"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-xl border border-border-light hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-muted disabled:opacity-50"
          aria-label={t.refreshLabel}
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
};
