import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../../lib/core/utils';
import type { OverviewCardProps, ProgressMetricBarProps } from '../types';
import { useLanguage } from '../../../lib/i18n/useLanguage';

export function PillInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/22 bg-white/14 px-3.5 py-2 text-white/95 backdrop-blur-xl">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100/80">
        {label}
      </span>
      <span className="ml-2 text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

export function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
  className,
  headerAction,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-[28px] border border-slate-100/70 dark:border-slate-700/60 bg-white/90 dark:bg-slate-800/90 p-5 lg:p-6 shadow-[0_14px_45px_rgba(15,23,42,0.07)] dark:shadow-none backdrop-blur-xl',
        className
      )}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-blue-50 dark:bg-blue-500/10 p-2.5 text-blue-600 dark:text-blue-400">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base lg:text-lg font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            {subtitle ? (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {headerAction}
      </div>
      {children}
    </div>
  );
}

export function OverviewCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  color,
  delay,
}: OverviewCardProps & { delay: number; language?: 'vi' | 'en' }) {
  const { t } = useLanguage();
  const palette = {
    blue: 'from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700',
    orange: 'from-orange-500 to-orange-600 dark:from-orange-600 dark:to-orange-700',
    emerald: 'from-emerald-500 to-emerald-600 dark:from-emerald-600 dark:to-emerald-700',
    violet: 'from-violet-500 to-violet-600 dark:from-violet-600 dark:to-violet-700',
  }[color];

  const trendPositive = (trend ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4, scale: 1.02 }}
      className="group relative overflow-hidden rounded-[26px] border border-slate-100/70 dark:border-slate-700/60 bg-white/92 dark:bg-slate-800/95 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.07)] dark:shadow-none"
    >
      <div
        className={cn(
          'absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-15 dark:opacity-20 blur-2xl transition group-hover:scale-125',
          palette
        )}
      />
      <div className="relative flex h-full flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
            <h4 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {value}
            </h4>
          </div>
          <motion.div
            whileHover={{ rotate: 8, scale: 1.08 }}
            className={cn(
              'rounded-2xl bg-gradient-to-br p-3 text-white shadow-lg dark:shadow-none',
              palette
            )}
          >
            <Icon className="w-5 h-5" />
          </motion.div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{sub}</p>
          {typeof trend === 'number' ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
                trendPositive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                  : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
              )}
            >
              {trendPositive ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              {trendPositive ? '+' : ''}
              {trend.toFixed(1)} {t.parent.vsPrevious}
            </span>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

export function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-slate-100 dark:border-slate-700/60 bg-slate-50/75 dark:bg-slate-800/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <div className="h-64">{children}</div>
    </div>
  );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn('h-3 w-3 rounded-[4px]', color)} />
      {label}
    </span>
  );
}

export function ProgressMetricBar({
  label,
  studentValue,
  classAverage,
  suffix = '',
}: ProgressMetricBarProps) {
  const { t } = useLanguage();
  const maxValue = suffix === '%' ? 100 : 10;
  const classAvgLabel = t.parent.classAvg;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700 dark:text-slate-300">{label}</span>
        <span className="font-bold text-blue-600 dark:text-blue-400">
          {studentValue}
          {suffix}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-slate-100 dark:bg-slate-700/50">
        {classAverage !== null && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(classAverage / maxValue) * 100}%` }}
            className="absolute inset-y-0 left-0 rounded-full bg-slate-300/70 dark:bg-slate-600/70"
          />
        )}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${(studentValue / maxValue) * 100}%` }}
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,_#3B82F6,_#2563EB,_#F97316)] shadow-[0_0_18px_rgba(59,130,246,0.32)] dark:shadow-none"
        />
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {classAverage !== null
          ? `${classAvgLabel} ${classAverage}${suffix}`
          : `${classAvgLabel} --`}
      </p>
    </div>
  );
}

export function AIFeedbackCard({ feedback }: { language?: 'vi' | 'en'; feedback: string }) {
  const { t } = useLanguage();

  return (
    <motion.div
      animate={{
        boxShadow: [
          '0 0 0 rgba(59,130,246,0.12)',
          '0 0 28px rgba(59,130,246,0.22)',
          '0 0 0 rgba(249,115,22,0.16)',
        ],
      }}
      transition={{ duration: 4, repeat: Infinity }}
      className="rounded-[30px] bg-[linear-gradient(135deg,_rgba(37,99,235,0.12),_rgba(255,255,255,0.96),_rgba(249,115,22,0.14))] dark:bg-[linear-gradient(135deg,_rgba(37,99,235,0.2),_rgba(15,23,42,0.96),_rgba(249,115,22,0.2))] p-[1px]"
    >
      <div className="rounded-[29px] bg-white/95 dark:bg-slate-800/95 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[linear-gradient(135deg,_#3B82F6,_#F97316)] p-2.5 text-white shadow-lg shadow-blue-200/70 dark:shadow-none">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              AI Feedback Card
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
              AI Learning Insight
            </h3>
          </div>
        </div>

        <p className="mt-4 text-sm leading-7 text-slate-700 dark:text-slate-300">{feedback}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-blue-50 dark:bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
            {t.parent.speaking}
          </span>
          <span className="rounded-full bg-orange-50 dark:bg-orange-500/10 px-3 py-1 text-[11px] font-semibold text-orange-700 dark:text-orange-400">
            {t.parent.homework}
          </span>
          <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            {t.parent.course}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
