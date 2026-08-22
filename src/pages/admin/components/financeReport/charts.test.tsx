// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';

// recharts renders nothing at 0×0 in jsdom. Replace ResponsiveContainer with one that injects
// explicit width/height into its single chart child so the SVG (incl. axis tick text) renders.
// `children` must be typed with the width/height props or cloneElement won't typecheck.
type SizedElement = React.ReactElement<{ width?: number; height?: number }>;
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: SizedElement }) =>
      React.cloneElement(children, { width: 500, height: 300 }),
  };
});

import { RevenueWaterfallChart } from './RevenueWaterfallChart';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { CategoryBreakdownCharts } from './CategoryBreakdownCharts';
import { ReceivablesByStatusChart } from './ReceivablesByStatusChart';

const t = {
  waterfall: {
    title: 'Cấu trúc',
    gross: 'Gốc',
    totalDiscount: 'Tổng giảm trừ',
    projected: 'Dự kiến',
    collected: 'Đã thu',
    outstanding: 'Công nợ',
  },
  trend: { title: 'Xu hướng', projected: 'Dự kiến', collected: 'Đã thu', spent: 'Đã chi' },
  incomeByLevel: 'Thu theo cấp',
  expensesByCategory: 'Chi theo hạng mục',
  receivablesByStatus: 'Công nợ theo trạng thái',
  receivableCount: 'Số hồ sơ',
  statusLabels: { partial: 'Thu một phần' },
  noData: 'Không có dữ liệu',
};

const report: CenterFinanceReport = {
  success: true,
  selectedMonth: '2026-04',
  current: {
    month: '2026-04',
    grossBilled: 3_000_000,
    discountTotal: 300_000,
    netBilled: 2_700_000,
    collectedCohort: 1_000_000,
    outstanding: 1_700_000,
    cashIn: 1_000_000,
    cashOut: 500_000,
  },
  discountBreakdown: { discount: 200_000, waiver: 100_000, unclassified: 0 },
  months: [
    {
      month: '2026-04',
      grossBilled: 3_000_000,
      discountTotal: 300_000,
      netBilled: 2_700_000,
      collectedCohort: 1_000_000,
      outstanding: 1_700_000,
      cashIn: 1_000_000,
      cashOut: 500_000,
    },
  ],
  incomeByLevel: [
    { level: 'primary', label: { vi: 'Tiểu học', en: 'Primary' }, amount: 1_000_000 },
  ],
  expensesByCategory: [
    { category: 'salary', label: { vi: 'Lương', en: 'Salary' }, amount: 500_000 },
  ],
  receivablesByStatus: [{ status: 'partial', count: 2, outstanding: 1_700_000 }],
  studentPayments: {
    summary: {
      total: 0,
      paid: 0,
      partial: 0,
      unpaid: 0,
      waived: 0,
      withOutstanding: 0,
      overdue: 0,
    },
    rows: [],
  },
  source: 'live',
};

describe('finance report charts', () => {
  it('waterfall renders its title and the total-reduction step label', () => {
    render(<RevenueWaterfallChart report={report} t={t} />);
    expect(screen.getByText('Cấu trúc')).toBeInTheDocument();
    expect(screen.getByText('Tổng giảm trừ')).toBeInTheDocument();
  });

  it('trend renders its title', () => {
    render(<MonthlyTrendChart report={report} t={t} />);
    expect(screen.getByText('Xu hướng')).toBeInTheDocument();
    expect(screen.getByText('04/26')).toBeInTheDocument();
  });

  it('category charts render level/category labels', () => {
    render(<CategoryBreakdownCharts report={report} t={t} language="vi" />);
    expect(screen.getByText('Thu theo cấp')).toBeInTheDocument();
    expect(screen.getByText('Chi theo hạng mục')).toBeInTheDocument();
  });

  it('category charts show the empty state when a series is empty', () => {
    render(
      <CategoryBreakdownCharts
        report={{ ...report, incomeByLevel: [], expensesByCategory: [] }}
        t={t}
        language="vi"
      />
    );
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(2);
  });

  it('receivables chart maps status codes to labels', () => {
    render(<ReceivablesByStatusChart report={report} t={t} />);
    expect(screen.getByText('Công nợ theo trạng thái')).toBeInTheDocument();
    expect(screen.getAllByText('Thu một phần').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('receivables chart shows the empty state when there are no open receivables', () => {
    render(<ReceivablesByStatusChart report={{ ...report, receivablesByStatus: [] }} t={t} />);
    expect(screen.getByText('Không có dữ liệu')).toBeInTheDocument();
  });
});
