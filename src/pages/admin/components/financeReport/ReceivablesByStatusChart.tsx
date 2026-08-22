import React from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';
import type { ReceivablesText } from './types';

const fmt = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value));
const STATUS_COLORS: Record<string, string> = {
  overdue: '#ef4444',
  unpaid: '#f97316',
  partial: '#eab308',
  due_date_missing: '#6b7280',
  paid: '#10b981',
  waived: '#a855f7',
};

type ReceivableChartDatum = {
  name: string;
  amount: number;
  count: number;
  status: string;
};

export const ReceivablesByStatusChart = ({
  report,
  t,
}: {
  report: CenterFinanceReport;
  t: ReceivablesText;
}) => {
  const data: ReceivableChartDatum[] = report.receivablesByStatus.map((row) => ({
    name: t.statusLabels[row.status] || row.status,
    amount: row.outstanding,
    count: row.count,
    status: row.status,
  }));
  return (
    <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
      <h3 className="mb-3 font-bold text-heading">{t.receivablesByStatus}</h3>
      {data.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400">{t.noData}</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} layout="vertical" margin={{ right: 28 }}>
              <XAxis
                type="number"
                tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`}
                tick={{ fontSize: 11 }}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
              <Tooltip
                formatter={(value, _name, item) => {
                  const datum = item.payload as ReceivableChartDatum;
                  return [
                    `${fmt(Number(value))} đ · ${t.receivableCount}: ${datum.count}`,
                    t.receivablesByStatus,
                  ];
                }}
              />
              <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                {data.map((item) => (
                  <Cell key={item.status} fill={STATUS_COLORS[item.status] || '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {data.map((item) => (
              <li key={item.status}>
                {item.name}: <strong className="text-slate-700">{item.count}</strong>{' '}
                {t.receivableCount}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
