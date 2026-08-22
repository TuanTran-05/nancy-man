import React from 'react';
import { Calendar, Download } from 'lucide-react';
import { Class } from '../../types';
import { formatVN } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ApiDateTextInput } from '../forms/ApiDateTimeInputs';

interface ClassExportControlsProps {
  classData: Class;
  coursePeriod: { start: string; end: string };
  setCoursePeriod: (period: { start: string; end: string }) => void;
  setSelectedMonth: (date: Date) => void;
  exportWord: () => void;
  isExporting: boolean;
  reportDataLength: number;
}

export const ClassExportControls: React.FC<ClassExportControlsProps> = ({
  classData,
  coursePeriod,
  setCoursePeriod,
  setSelectedMonth,
  exportWord,
  isExporting,
  reportDataLength,
}) => {
  const { t } = useLanguage();
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
              {t.classExportControls.selectTerm}
            </label>
            <select
              className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 outline-none"
              onChange={(e) => {
                if (e.target.value === 'current') {
                  setCoursePeriod({ start: classData.startDate, end: classData.endDate });
                  setSelectedMonth(new Date(classData.startDate));
                } else {
                  const term = classData.terms?.find((t) => t.id === e.target.value);
                  if (term) {
                    setCoursePeriod({ start: term.startDate, end: term.endDate });
                    setSelectedMonth(new Date(term.startDate));
                  }
                }
              }}
            >
              <option value="current">
                {t.classExportControls.currentTerm} ({formatVN(classData.startDate, 'dd/MM/yyyy')} -{' '}
                {formatVN(classData.endDate, 'dd/MM/yyyy')})
              </option>
              {classData.terms?.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
              {t.classExportControls.customRange}
            </label>
            <div className="flex items-center space-x-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <ApiDateTextInput
                label={`${t.classExportControls.customRange} start`}
                hideLabel
                value={coursePeriod.start}
                onChange={(start) => {
                  setCoursePeriod({ ...coursePeriod, start });
                  if (start) {
                    setSelectedMonth(new Date(start));
                  }
                }}
                inputClassName="h-auto w-28 rounded-none border-0 bg-transparent p-0 text-sm font-medium text-slate-600 focus:border-transparent focus:ring-0"
              />
              <span className="text-slate-300">→</span>
              <ApiDateTextInput
                label={`${t.classExportControls.customRange} end`}
                hideLabel
                value={coursePeriod.end}
                onChange={(end) => setCoursePeriod({ ...coursePeriod, end })}
                inputClassName="h-auto w-28 rounded-none border-0 bg-transparent p-0 text-sm font-medium text-slate-600 focus:border-transparent focus:ring-0"
              />
            </div>
          </div>
        </div>
        <button
          onClick={exportWord}
          disabled={isExporting || reportDataLength === 0}
          className="flex items-center space-x-2 bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 disabled:opacity-50"
        >
          {isExporting ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span>{t.classExportControls.exportReport}</span>
        </button>
      </div>
    </div>
  );
};
