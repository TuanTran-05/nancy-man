import React from 'react';
import {
  ALL,
  listFilterClasses,
  listFilterTerms,
  type ReportFilter,
} from '../../../../lib/reports/studentReportFilter';
import type { StudentTimelineSegment } from '../../../../lib/api/studentAdminReportApi';

type Props = {
  timeline: StudentTimelineSegment[];
  filter: ReportFilter;
  onChange: (next: ReportFilter) => void;
  t: any;
};

export function formatTermOption(segment: StudentTimelineSegment, t: any): string {
  const f = t.filters;
  if (segment.term.termId === 'unknown') return f.termUnknown;

  const template = segment.term.isCurrent
    ? segment.term.endDate
      ? f.termOptionCurrent
      : f.termOptionOpen
    : f.termOption;

  return template
    .replace('{index}', String(segment.term.index))
    .replace('{start}', segment.term.startDate)
    .replace('{end}', segment.term.endDate || f.ongoing);
}

export function formatClassOption(
  option: { classId: string; className: string; classMissing: boolean },
  t: any
): string {
  if (option.classMissing || !option.className) {
    return t.filters.classUnknown.replace('{id}', option.classId);
  }
  return option.className;
}

const SELECT_CLASS =
  'px-3 py-1.5 rounded-xl border border-border-default text-heading bg-surface text-sm';

export const StudentReportFilters: React.FC<Props> = ({ timeline, filter, onChange, t }) => {
  const f = t.filters;
  const classes = listFilterClasses(timeline);
  const terms = listFilterTerms(timeline, filter.classId);

  return (
    <div className="flex flex-wrap items-end gap-3 mb-6" id="report-filters">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted font-medium">{f.classLabel}</span>
        <select
          data-testid="filter-class"
          id="filter-class"
          className={SELECT_CLASS}
          value={filter.classId}
          onChange={(e) =>
            // Courses belong to one class, so a class change invalidates the
            // course selection — reset it rather than leave an empty result.
            onChange({ ...filter, classId: e.target.value, termKey: ALL })
          }
        >
          <option value={ALL}>{f.allClasses}</option>
          {classes.map((option) => (
            <option key={option.classId} value={option.classId}>
              {formatClassOption(option, t)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted font-medium">{f.termLabel}</span>
        <select
          data-testid="filter-term"
          id="filter-term"
          className={SELECT_CLASS}
          value={filter.termKey}
          onChange={(e) => onChange({ ...filter, termKey: e.target.value })}
        >
          <option value={ALL}>{f.allTerms}</option>
          {terms.map((segment) => (
            // Option value is the full termKey — bare termId collides across
            // classes ('current' exists in every class) when classId is ALL.
            <option key={segment.key} value={segment.key}>
              {formatTermOption(segment, t)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted font-medium">{f.dateFrom}</span>
        <input
          type="date"
          data-testid="filter-from"
          id="filter-from"
          className={SELECT_CLASS}
          value={filter.from ?? ''}
          onChange={(e) => onChange({ ...filter, from: e.target.value || undefined })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted font-medium">{f.dateTo}</span>
        <input
          type="date"
          data-testid="filter-to"
          id="filter-to"
          className={SELECT_CLASS}
          value={filter.to ?? ''}
          onChange={(e) => onChange({ ...filter, to: e.target.value || undefined })}
        />
      </label>

      {(filter.from || filter.to) && (
        <button
          id="filter-clear-dates"
          data-testid="filter-clear-dates"
          onClick={() => onChange({ ...filter, from: undefined, to: undefined })}
          className="px-3 py-1.5 text-sm text-indigo-600 hover:underline"
        >
          {f.clearDates}
        </button>
      )}
    </div>
  );
};
