// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReportTab } from './ReportTab';

const financePage = {
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisQuarter: 'This quarter',
  thisYear: 'This year',
  lastYear: 'Last year',
  fromDate: 'From',
  toDate: 'To',
  loadReport: 'Load report',
  totalIncome: 'Total income',
  totalExpenses: 'Total expenses',
  scholarships: 'Scholarships',
  fundComposition: 'Income, expenses and scholarships',
  noFundComposition: 'No income, expense or scholarship data in this period.',
  balance: 'Balance',
  incomeByLevel: 'Income by level',
  expensesByCategory: 'Expenses by category',
  monthlyBreakdown: 'Monthly breakdown',
  month: 'Month',
  income: 'Income',
  expenses: 'Expenses',
};

describe('ReportTab chart loading', () => {
  it('does not depend on React.lazy payloads for chart components', () => {
    const lazySpy = vi.spyOn(React, 'lazy');

    render(
      <ReportTab
        activeTab="report"
        reportFrom="2026-06-01"
        setReportFrom={vi.fn()}
        reportTo="2026-06-30"
        setReportTo={vi.fn()}
        handleLoadReport={vi.fn()}
        reportLoading={false}
        reportRange={{ from: '2026-06-01', to: '2026-06-30' }}
        language="en"
        t={{ financePage }}
        report={{
          totalIncome: 3_000_000,
          totalExpenses: 800_000,
          totalScholarships: 500_000,
          balance: 2_200_000,
          source: 'live',
          incomeByLevel: [
            {
              level: 'primary',
              label: { vi: 'Tieu hoc', en: 'Primary' },
              amount: 3_000_000,
            },
          ],
          expensesByCategory: [
            {
              category: 'rent',
              label: { vi: 'Tien thue', en: 'Rent' },
              amount: 800_000,
            },
          ],
          monthlyBreakdown: [
            { month: '2026-06', income: 3_000_000, expenses: 800_000, balance: 2_200_000 },
          ],
        }}
      />
    );

    expect(screen.getByText('Income by level')).toBeInTheDocument();
    expect(screen.getByText('Expenses by category')).toBeInTheDocument();
    expect(lazySpy).not.toHaveBeenCalled();
    lazySpy.mockRestore();
  });
});
