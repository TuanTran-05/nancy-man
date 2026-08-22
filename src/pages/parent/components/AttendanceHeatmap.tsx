import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import { cn } from '../../../lib/core/utils';
import type { HeatmapCell } from '../types';
import { LegendDot, SectionCard } from './CommonWidgets';
import { useLanguage } from '../../../lib/i18n/useLanguage';

export function AttendanceHeatmap({
  data,
  months,
}: {
  language?: 'vi' | 'en';
  data: HeatmapCell[][];
  months: HeatmapCell[];
}) {
  const { t } = useLanguage();

  return (
    <SectionCard
      icon={Calendar}
      title={t.parent.courseAttendanceMap}
      subtitle={t.parent.attendanceGridDesc}
    >
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[max-content]">
          <div className="flex gap-2">
            <div className="grid grid-rows-7 gap-1 pt-[25px] text-[10px] text-slate-400 w-5">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
                <div key={`day-${index}`} className="h-4 leading-4 text-center">
                  {day}
                </div>
              ))}
            </div>

            <div className="flex flex-col">
              <div
                className="mb-2 grid gap-1 w-full"
                style={{ gridTemplateColumns: `repeat(${data.length}, 16px)` }}
              >
                {months.map((cell, index) => {
                  const prevCell = index > 0 ? months[index - 1] : null;
                  const isNewMonth =
                    !prevCell || format(cell.date, 'MMM') !== format(prevCell.date, 'MMM');
                  return (
                    <div
                      key={`${cell.iso}-month-${index}`}
                      className="text-[10px] text-slate-400 -ml-1"
                    >
                      {isNewMonth ? format(cell.date, 'MMM') : ''}
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-flow-col grid-rows-7 gap-1">
                {data.map((week, weekIndex) =>
                  week.map((cell) => (
                    <div
                      key={`${cell.iso}-${weekIndex}`}
                      title={`${format(cell.date, 'dd/MM/yyyy')} • ${cell.label}`}
                      className={cn(
                        'h-4 w-4 rounded-[4px] border border-white dark:border-slate-800',
                        cell.status === 'present' && 'bg-emerald-400 dark:bg-emerald-500',
                        cell.status === 'late' && 'bg-amber-400 dark:bg-amber-500',
                        cell.status === 'absent' && 'bg-red-400 dark:bg-red-500',
                        cell.status === 'empty' && 'bg-slate-100 dark:bg-slate-700/50'
                      )}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <LegendDot color="bg-slate-100 dark:bg-slate-700/50" label={t.parent.noClassNoData} />
        <LegendDot color="bg-emerald-400 dark:bg-emerald-500" label={t.parent.present} />
        <LegendDot color="bg-amber-400 dark:bg-amber-500" label={t.parent.lateLabel} />
        <LegendDot color="bg-red-400 dark:bg-red-500" label={t.parent.absent} />
      </div>
    </SectionCard>
  );
}
