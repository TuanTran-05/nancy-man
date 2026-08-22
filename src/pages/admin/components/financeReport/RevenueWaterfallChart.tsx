import React from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';
import type { WaterfallText } from './types';

const fmt = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value));

export const RevenueWaterfallChart = ({
  report,
  t,
}: {
  report: CenterFinanceReport;
  t: WaterfallText;
}) => {
  const c = report.current;
  const steps = [
    { name: t.waterfall.gross, base: 0, delta: c.grossBilled, fill: '#3b82f6' },
    { name: t.waterfall.totalDiscount, base: c.netBilled, delta: c.discountTotal, fill: '#38bdf8' },
    { name: t.waterfall.projected, base: 0, delta: c.netBilled, fill: '#2563eb' },
    { name: t.waterfall.collected, base: c.outstanding, delta: c.collectedCohort, fill: '#10b981' },
    { name: t.waterfall.outstanding, base: 0, delta: c.outstanding, fill: '#f59e0b' },
  ];
  return (
    <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
      <h3 className="mb-3 font-bold text-heading">{t.waterfall.title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={steps}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
          <YAxis
            tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`}
            tick={{ fontSize: 11 }}
          />
          <Tooltip formatter={(value: number) => `${fmt(value)} đ`} />
          <Bar dataKey="base" stackId="w" fill="transparent" />
          <Bar dataKey="delta" stackId="w" radius={[6, 6, 0, 0]}>
            {steps.map((step) => (
              <Cell key={step.name} fill={step.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
