import React from 'react';
import { TrendingUp, TrendingDown, Minus, MoreVertical } from 'lucide-react';
import { cn } from '../../lib/core/utils';

export const Sparkline = ({ values, color }: { values: number[]; color: string }) => {
  const normalizedValues = values.length > 1 ? values : [0, values[0] || 0, 0, values[0] || 0];
  const max = Math.max(...normalizedValues, 1);
  const min = Math.min(...normalizedValues);
  const range = Math.max(max - min, 1);
  const points = normalizedValues
    .map((value, index) => {
      const x = (index / (normalizedValues.length - 1)) * 120;
      const y = 42 - ((value - min) / range) * 32;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 120 48" className="h-12 w-28 overflow-visible" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline points={`0,48 ${points} 120,48`} fill={color} opacity="0.08" stroke="none" />
    </svg>
  );
};

export const DashboardMetricCard = ({
  label,
  value,
  note,
  trend,
  icon: Icon,
  color,
  bg,
  sparkline,
}: {
  label: string;
  value: string | number;
  note: string;
  trend?: 'up' | 'down' | 'flat';
  icon: React.ElementType;
  color: string;
  bg: string;
  sparkline: number[];
}) => {
  const TrendIcon = trend === 'down' ? TrendingDown : trend === 'flat' ? Minus : TrendingUp;

  return (
    <div className="relative min-h-[156px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_50px_rgba(15,23,42,0.1)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', bg)}>
            <Icon className="h-6 w-6" style={{ color }} />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label="More"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <div className="flex flex-1 min-w-0 items-start gap-1.5 text-[11px] font-semibold text-slate-500">
          <TrendIcon
            className={cn(
              'h-3.5 w-3.5 shrink-0 mt-[1px]',
              trend === 'down'
                ? 'text-rose-500'
                : trend === 'flat'
                  ? 'text-slate-400'
                  : 'text-emerald-500'
            )}
          />
          <span className="line-clamp-2 leading-tight">{note}</span>
        </div>
        <Sparkline values={sparkline} color={color} />
      </div>
    </div>
  );
};

export const DashboardCard = ({
  title,
  icon: Icon,
  iconColor,
  action,
  children,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="relative isolate min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
    <div className="mb-5 flex items-center justify-between gap-4">
      <h3 className="flex items-center gap-2 text-base font-bold text-slate-950">
        <Icon className="h-5 w-5" style={{ color: iconColor }} />
        {title}
      </h3>
      {action || (
        <button
          type="button"
          className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label="More"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      )}
    </div>
    {children}
  </section>
);

export const DashboardMiniStat = ({
  icon: Icon,
  label,
  value,
  color = '#2563eb',
  bg = 'bg-blue-50',
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  color?: string;
  bg?: string;
}) => (
  <div className="flex min-w-0 items-center gap-3 px-4 py-3.5">
    <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', bg)}>
      <Icon className="h-5 w-5" style={{ color }} />
    </div>
    <div className="min-w-0">
      <p className="line-clamp-2 text-[11px] font-medium leading-tight text-slate-500">{label}</p>
      <p className="mt-1 line-clamp-2 text-[14px] font-bold leading-tight text-slate-950">
        {value}
      </p>
    </div>
  </div>
);

export const DonutLegend = ({
  data,
  total,
}: {
  data: { label: string; value: number; color?: string }[];
  total: number;
}) => (
  <div className="space-y-4">
    {data.map((item) => (
      <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-3 text-slate-600">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: item.color || '#3b82f6' }}
          />
          <span className="font-medium">{item.label}</span>
        </div>
        <div className="flex items-center gap-2 font-semibold text-slate-900">
          <span>{item.value}</span>
          <span className="text-slate-400">
            ({total > 0 ? Math.round((item.value / total) * 1000) / 10 : 0}%)
          </span>
        </div>
      </div>
    ))}
  </div>
);
