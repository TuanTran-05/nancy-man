import React from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';
import type { TrendText } from './types';

const fmt = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value));

export const MonthlyTrendChart = ({ report, t }: { report: CenterFinanceReport; t: TrendText }) => {
  const data = report.months.map((month) => ({
    name: `${month.month.slice(5)}/${month.month.slice(2, 4)}`,
    projected: month.netBilled,
    collected: month.cashIn,
    spent: month.cashOut,
  }));
  return (
    <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
      <h3 className="mb-3 font-bold text-heading">{t.trend.title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(value) => `${(value / 1_000_000).toFixed(0)}M`}
            tick={{ fontSize: 11 }}
          />
          <Tooltip formatter={(value: number) => `${fmt(value)} đ`} />
          <Legend />
          <Bar dataKey="collected" name={t.trend.collected} fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="spent" name={t.trend.spent} fill="#ef4444" radius={[4, 4, 0, 0]} />
          <Line
            dataKey="projected"
            name={t.trend.projected}
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
