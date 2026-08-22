import React from 'react';
import { AlertTriangle, Download, Filter, Search } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n/useLanguage.js';
import { exportCourseClosingRecordsToCsv } from '../courseClosingRecordExport.js';
import { useCourseClosingRecordsStore } from '../courseClosingRecordsStore.js';

interface CourseClosingRecordsHeaderProps {
  month: string;
  onMonthChange: (month: string) => void;
  onSearchSubmit: () => void;
  records: any[];
  truncated: boolean;
  role: string;
}

export function CourseClosingRecordsHeader({
  month,
  onMonthChange,
  onSearchSubmit,
  records,
  truncated,
  role,
}: CourseClosingRecordsHeaderProps) {
  const { t } = useLanguage();
  const copy = t.courseClosingRecordsPage;
  const {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    documentTypeFilter,
    setDocumentTypeFilter,
  } = useCourseClosingRecordsStore();

  const statusOptions =
    role === 'accounting'
      ? ['not_requested', 'pending', 'ready', 'retrying', 'failed']
      : [
          'complete',
          'missing_evaluation',
          'missing_tuition',
          'pending',
          'not_requested',
          'retrying',
          'failed',
        ];

  const handleExportCsv = () => {
    const csvData = exportCourseClosingRecordsToCsv(records, role, month);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `course_closing_records_${month}_${role}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{copy.title}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{copy.subtitle}</p>
        </div>

        <div className="flex items-end gap-3">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="mb-1 block">{copy.closingMonth}</span>
            <input
              aria-label={copy.closingMonth}
              type="month"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <button
            type="button"
            aria-label={copy.exportCsv}
            onClick={handleExportCsv}
            disabled={records.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {copy.exportCsv}
          </button>
        </div>
      </div>

      <form
        role="search"
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label={copy.searchLabel}
            placeholder={copy.searchPlaceholder}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300"
        >
          {copy.search}
        </button>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-slate-400" />
          <select
            aria-label={copy.status}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as any)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="all">{copy.allStatuses}</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {copy.statuses[status]}
              </option>
            ))}
          </select>

          {role !== 'accounting' && (
            <select
              aria-label={copy.documentType}
              value={documentTypeFilter}
              onChange={(event) => setDocumentTypeFilter(event.target.value as any)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="all">{copy.allDocuments}</option>
              <option value="evaluation">{copy.evaluation}</option>
              <option value="tuition">{copy.tuition}</option>
            </select>
          )}
        </div>
      </form>

      {truncated && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{copy.truncated}</span>
        </div>
      )}
    </div>
  );
}
