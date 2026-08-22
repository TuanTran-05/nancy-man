import { Crown } from 'lucide-react';
import { ProgressMetricBar } from './CommonWidgets';
import { useLanguage } from '../../../lib/i18n/useLanguage';

export function ComparisonSection({
  scoreStudent,
  scoreClassAverage,
  attendanceStudent,
  attendanceClassAverage,
  rankLabel,
}: {
  language?: 'vi' | 'en';
  scoreStudent: number;
  scoreClassAverage: number | null;
  attendanceStudent: number;
  attendanceClassAverage: number | null;
  rankLabel: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/60 dark:border-slate-700/60 bg-[linear-gradient(145deg,_rgba(255,255,255,0.9),_rgba(239,246,255,0.82))] dark:bg-[linear-gradient(145deg,_rgba(30,41,59,0.9),_rgba(15,23,42,0.82))] p-5 shadow-[0_20px_55px_rgba(15,23,42,0.08)] dark:shadow-none backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
            {t.parent.classComparison}
          </p>
          <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
            {t.parent.whereStudentStands}
          </h3>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-500">
          <Crown className="w-4 h-4" />
          {rankLabel}
        </div>
      </div>

      <div className="mt-6 space-y-5">
        <ProgressMetricBar
          label={t.parent.finalEvalScore}
          studentValue={scoreStudent}
          classAverage={scoreClassAverage}
        />

        <ProgressMetricBar
          label={t.parent.attendance}
          studentValue={attendanceStudent}
          classAverage={attendanceClassAverage}
          suffix="%"
        />
      </div>
    </div>
  );
}
