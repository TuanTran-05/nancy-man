import React from 'react';
import type {
  CalendarCell,
  CalendarCoverage,
} from '../../../../lib/reports/studentAttendanceCalendar';
import type { FilteredReport } from '../../../../lib/reports/studentReportFilter';

const STATUS_CHIP: Record<string, string> = {
  present: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  late: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  absent_with_permission: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  absent_without_permission: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  unmarked: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  // Muted and low-contrast: "not applicable", not "missing data" — distinct
  // from unmarked, which flags an actual data gap.
  not_enrolled: 'bg-slate-50 text-slate-400 dark:bg-slate-800/40 dark:text-slate-500',
  on_leave: 'bg-slate-50 text-slate-400 dark:bg-slate-800/40 dark:text-slate-500',
};

type Props = {
  cells: CalendarCell[];
  classMap: Record<string, string>;
  showClassName: boolean; // true when class filter is ALL
  attendanceMode: FilteredReport['attendanceMode'];
  t: any;
};

/**
 * Determines whether an empty cell should show "no class" (covered + expected)
 * or "no data" (all other cases).
 */
function emptyCellCoverage(
  coverage: CalendarCoverage,
  attendanceMode: FilteredReport['attendanceMode']
): 'no_class' | 'no_data' {
  if (attendanceMode === 'expected' && coverage === 'covered') {
    return 'no_class';
  }
  return 'no_data';
}

export const StudentAttendanceCalendar: React.FC<Props> = ({
  cells,
  classMap,
  showClassName,
  attendanceMode,
  t,
}) => {
  const at = t.attendance;

  // Determine which legend entries are needed by scanning visible (inMonth) empty cells
  const inMonthEmptyCells = cells.filter((c) => c.inMonth && c.sessions.length === 0);
  const needsNoClass = inMonthEmptyCells.some(
    (c) => emptyCellCoverage(c.coverage, attendanceMode) === 'no_class'
  );
  const needsNoData = inMonthEmptyCells.some(
    (c) => emptyCellCoverage(c.coverage, attendanceMode) === 'no_data'
  );
  const inMonthSessions = cells.filter((c) => c.inMonth).flatMap((c) => c.sessions);
  const needsNotEnrolled = inMonthSessions.some((s) => s.statusKey === 'not_enrolled');
  const needsOnLeave = inMonthSessions.some((s) => s.statusKey === 'on_leave');

  // Weekdays header (Monday-first)
  const weekdays: string[] = at.weekdays;

  return (
    <div
      className="rounded-2xl border border-border-light overflow-hidden"
      id="attendance-calendar"
    >
      {/* Weekday headers */}
      <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-800/60">
        {weekdays.map((day: string) => (
          <div
            key={day}
            className="py-2 text-center text-[10px] font-bold text-slate-400 uppercase"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const isOutOfMonth = !cell.inMonth;
          const isEmpty = cell.sessions.length === 0;
          const emptyKind = isEmpty ? emptyCellCoverage(cell.coverage, attendanceMode) : null;

          return (
            <div
              key={cell.iso}
              data-date={cell.iso}
              className={[
                'min-h-[80px] p-1.5 border-r border-b border-slate-100 dark:border-slate-800 transition-colors',
                isOutOfMonth ? 'bg-slate-50/50 dark:bg-slate-900/30 opacity-30' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/* Date number */}
              <div
                className={[
                  'text-[10px] font-bold mb-1 w-5 h-5 flex items-center justify-center rounded-full',
                  cell.isToday ? 'bg-indigo-600 text-white' : 'text-slate-400',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {cell.day}
              </div>

              {/* Sessions */}
              <div className="space-y-1">
                {cell.sessions.map((session, idx) => {
                  const chipClass = STATUS_CHIP[session.statusKey] ?? '';
                  const className = classMap[session.classId] ?? session.classId;

                  return (
                    <div
                      key={`${session.classId}-${idx}`}
                      className={`text-[9px] px-1.5 py-0.5 rounded leading-tight font-semibold ${chipClass}`}
                    >
                      {showClassName && (
                        <span className="font-bold truncate block">{className}</span>
                      )}
                      <span>
                        {at.statuses[session.statusKey as keyof typeof at.statuses] ??
                          session.statusKey}
                      </span>
                      {session.isMakeup && (
                        <span className="ml-1 opacity-70">{at.makeupLabel}</span>
                      )}
                      {session.statusKey === 'late' && session.minutesLate > 0 && (
                        <span className="ml-1 opacity-70">
                          {at.minutesLateShort.replace('{n}', String(session.minutesLate))}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Empty cell treatment */}
                {isEmpty && !isOutOfMonth && emptyKind === 'no_data' && (
                  <div
                    className="text-[9px] text-slate-400 dark:text-slate-600 leading-tight px-1"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(148,163,184,0.15) 2px, rgba(148,163,184,0.15) 4px)',
                      borderRadius: 4,
                      paddingTop: 2,
                      paddingBottom: 2,
                    }}
                  >
                    {at.noDataLabel}
                  </div>
                )}
                {isEmpty && !isOutOfMonth && emptyKind === 'no_class' && (
                  <div className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight px-1">
                    {at.noClassLabel}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      {(needsNoClass || needsNoData || needsNotEnrolled || needsOnLeave) && (
        <div className="flex gap-4 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500">
          {needsNoClass && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded border border-slate-200 dark:border-slate-600" />
              {at.noClassLabel}
            </span>
          )}
          {needsNoData && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(148,163,184,0.4) 2px, rgba(148,163,184,0.4) 4px)',
                }}
              />
              {at.noDataLabel}
            </span>
          )}
          {needsNotEnrolled && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700" />
              {at.statuses.not_enrolled}
            </span>
          )}
          {needsOnLeave && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700" />
              {at.statuses.on_leave}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
