import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  buildAttendanceMonthGrid,
  listAttendanceMonths,
  resolveSelectedMonth,
} from '../../../../lib/reports/studentAttendanceCalendar';
import { StudentAttendanceCalendar } from './StudentAttendanceCalendar';
import type { FilteredReport } from '../../../../lib/reports/studentReportFilter';
import type {
  StudentAttendanceReportRow,
  TermSessionValue,
} from '../../../../lib/api/studentAdminReportApi';

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

type Props = {
  rows: StudentAttendanceReportRow[];
  classMap: Record<string, string>;
  showClassName: boolean; // true when classId filter === ALL
  attendanceMode: FilteredReport['attendanceMode'];
  todayIso: string;
  dateRangeFrom?: string;
  dateRangeTo?: string;
  /** Display-only estimate for the selected course. null when unavailable. */
  sessionValue?: TermSessionValue | null;
  t: any;
};

export const StudentAttendanceReportTab: React.FC<Props> = ({
  rows,
  classMap,
  showClassName,
  attendanceMode,
  todayIso,
  dateRangeFrom,
  dateRangeTo,
  sessionValue,
  t,
}) => {
  const at = t.attendance;

  const [selectedMonthState, setSelectedMonth] = useState<string | null>(null);

  // Derive available months from filtered rows
  const availableMonths = useMemo(() => listAttendanceMonths(rows), [rows]);

  // Clamp selection during render (useMemo, not useEffect — avoids stale-month frame)
  const selectedMonth = useMemo(
    () => resolveSelectedMonth(availableMonths, selectedMonthState),
    [availableMonths, selectedMonthState]
  );

  // Unmarked count across the whole filter (not just visible month)
  const unmarkedCount = rows.filter((r) => r.status === 'unmarked').length;

  // Empty state: no rows or attendanceMode === 'none'
  if (rows.length === 0 || attendanceMode === 'none') {
    return (
      <div className="text-center py-12 text-muted text-sm" id="attendance-empty-state">
        {at.emptyLabel}
      </div>
    );
  }

  // Build grid for the selected month
  const range = dateRangeFrom || dateRangeTo ? { from: dateRangeFrom, to: dateRangeTo } : undefined;

  const cells = selectedMonth ? buildAttendanceMonthGrid(rows, selectedMonth, todayIso, range) : [];

  // Navigation: step through availableMonths array, not calendar arithmetic
  const monthIndex = selectedMonth ? availableMonths.indexOf(selectedMonth) : -1;
  const canGoPrev = monthIndex > 0;
  const canGoNext = monthIndex >= 0 && monthIndex < availableMonths.length - 1;

  const handlePrev = () => {
    if (canGoPrev) setSelectedMonth(availableMonths[monthIndex - 1]);
  };
  const handleGoNext = () => {
    if (canGoNext) setSelectedMonth(availableMonths[monthIndex + 1]);
  };

  // Mode caption for marked_only / mixed
  const modeCaption =
    attendanceMode === 'marked_only'
      ? (at.modes?.markedOnlyHint ?? t.modes?.markedOnlyHint)
      : attendanceMode === 'mixed'
        ? t.modes?.mixed
        : null;

  // Format month display label
  function formatMonthLabel(month: string): string {
    if (!month) return '';
    const [year, m] = month.split('-');
    return at.monthLabel.replace('{month}', m).replace('{year}', year);
  }

  return (
    <div>
      {/* Unmarked warning — counts the whole filter, not just the visible month */}
      {unmarkedCount > 0 && (
        <div
          id="attendance-unmarked-warning"
          className="mb-4 px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-sm text-amber-700 dark:text-amber-300 font-medium"
        >
          ⚠️ {at.unmarkedWarning.replace('{count}', String(unmarkedCount))}
        </div>
      )}

      {/* Mode caption */}
      {modeCaption && (
        <div className="mb-4 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-border-light rounded-xl text-sm text-muted">
          {modeCaption}
        </div>
      )}

      {/* Session value — DISPLAY ONLY. Never posted to a ledger. */}
      {sessionValue && (
        <div
          id="attendance-session-value"
          className="mb-4 px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border border-border-light rounded-xl"
        >
          <p className="text-sm font-semibold text-heading mb-2">{at.sessionValueTitle}</p>

          {sessionValue.pricePerSession === null ? (
            <p className="text-sm text-muted">
              <span className="font-semibold">—</span> · {at.sessionValueUnavailable}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">
                {at.pricePerSession}:{' '}
                <span className="font-semibold text-heading">
                  {formatVnd(sessionValue.pricePerSession)}
                </span>
              </p>

              <div>
                <p className="text-sm">
                  {at.refundable}:{' '}
                  <span className="font-bold text-emerald-600">
                    {formatVnd(sessionValue.refundable.amount)}
                  </span>{' '}
                  <span className="text-muted">
                    ({sessionValue.refundable.sessions} {at.sessions ?? ''})
                  </span>
                </p>
                <p className="text-xs text-muted">{at.refundableHint}</p>
              </div>

              {/* Most students never joined mid-course; a permanent zero row is noise. */}
              {sessionValue.notEnrolled.sessions > 0 && (
                <div>
                  <p className="text-sm">
                    {at.notEnrolledValue}:{' '}
                    <span className="font-bold text-indigo-600">
                      {formatVnd(sessionValue.notEnrolled.amount)}
                    </span>{' '}
                    <span className="text-muted">
                      ({sessionValue.notEnrolled.sessions} {at.sessions ?? ''})
                    </span>
                  </p>
                  <p className="text-xs text-muted">{at.notEnrolledHint}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-heading" id="attendance-calendar-month-label">
          {selectedMonth ? formatMonthLabel(selectedMonth) : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrev}
            disabled={!canGoPrev}
            aria-label={at.prevMonth}
            id="attendance-calendar-prev"
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoNext}
            disabled={!canGoNext}
            aria-label={at.nextMonth}
            id="attendance-calendar-next"
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      {selectedMonth && cells.length > 0 && (
        <StudentAttendanceCalendar
          cells={cells}
          classMap={classMap}
          showClassName={showClassName}
          attendanceMode={attendanceMode}
          t={t}
        />
      )}
    </div>
  );
};
