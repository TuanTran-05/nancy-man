import React from 'react';
import type { CenterFinanceReport, FinanceDetailType } from '../../../../lib/api/financeApi';
import type { FinanceKpiText } from './types';

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

type KpiCard = {
  label: string;
  value: number;
  tone: string;
  detailType?: FinanceDetailType;
};

export const FinanceKpiRow = ({
  report,
  t,
  onOpenDetails,
}: {
  report: CenterFinanceReport;
  t: FinanceKpiText;
  onOpenDetails: (type: FinanceDetailType) => void;
}) => {
  const c = report.current;
  const fundBalance = c.cashIn - c.cashOut;
  const cards: KpiCard[] = [
    { label: t.kpi.projected, value: c.netBilled, tone: 'text-blue-600' },
    { label: t.kpi.collected, value: c.cashIn, tone: 'text-emerald-600', detailType: 'income' },
    { label: t.kpi.outstanding, value: c.outstanding, tone: 'text-amber-600' },
    { label: t.kpi.discount, value: report.discountBreakdown.discount, tone: 'text-sky-600' },
    { label: t.kpi.waiver, value: report.discountBreakdown.waiver, tone: 'text-purple-600' },
    ...(report.discountBreakdown.unclassified > 0
      ? [
          {
            label: t.kpi.unclassified,
            value: report.discountBreakdown.unclassified,
            tone: 'text-orange-600',
          },
        ]
      : []),
    { label: t.kpi.spent, value: c.cashOut, tone: 'text-rose-600', detailType: 'expense' },
    {
      label: t.kpi.fundBalance,
      value: fundBalance,
      tone: fundBalance >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) =>
        card.detailType ? (
          <button
            key={card.label}
            type="button"
            onClick={() => onOpenDetails(card.detailType!)}
            aria-label={`${card.label} ${t.details.viewDetails}`}
            className="rounded-2xl border border-border-default bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {card.label}
            </p>
            <p className={`mt-1 text-xl font-black ${card.tone}`}>
              {compact(card.value)} <span className="text-xs font-medium text-slate-400">đ</span>
            </p>
            <p className="mt-2 text-xs font-semibold text-blue-600">{t.details.viewDetails}</p>
          </button>
        ) : (
          <div
            key={card.label}
            className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {card.label}
            </p>
            <p className={`mt-1 text-xl font-black ${card.tone}`}>
              {compact(card.value)} <span className="text-xs font-medium text-slate-400">đ</span>
            </p>
          </div>
        )
      )}
    </div>
  );
};
