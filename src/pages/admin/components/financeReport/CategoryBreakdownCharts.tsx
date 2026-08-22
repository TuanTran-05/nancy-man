import React from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';
import type { CategoryBreakdownText } from './types';

const fmt = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value));
const INCOME_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#6b7280'];
const EXPENSE_COLORS = ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#3b82f6', '#6b7280'];

export const CategoryBreakdownCharts = ({
  report,
  t,
  language,
}: {
  report: CenterFinanceReport;
  t: CategoryBreakdownText;
  language: 'vi' | 'en';
}) => {
  const income = report.incomeByLevel.map((item) => ({
    name: item.label[language] || item.label.vi,
    amount: item.amount,
  }));
  const expenses = report.expensesByCategory.map((item) => ({
    name: item.label[language] || item.label.vi,
    amount: item.amount,
  }));
  const block = (title: string, data: { name: string; amount: number }[], colors: string[]) => (
    <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
      <h3 className="mb-3 font-bold text-heading">{title}</h3>
      {data.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400">{t.noData}</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`}
              tick={{ fontSize: 11 }}
            />
            <Tooltip formatter={(value: number) => `${fmt(value)} đ`} />
            <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
              {data.map((item, index) => (
                <Cell key={item.name} fill={colors[index % colors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
  return (
    <>
      {block(t.incomeByLevel, income, INCOME_COLORS)}
      {block(t.expensesByCategory, expenses, EXPENSE_COLORS)}
    </>
  );
};
