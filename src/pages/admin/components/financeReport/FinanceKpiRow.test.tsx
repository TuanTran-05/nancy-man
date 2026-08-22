// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';
import { FinanceKpiRow } from './FinanceKpiRow';

const t = {
  kpi: {
    projected: 'Doanh thu dự kiến',
    collected: 'Đã thu',
    outstanding: 'Công nợ còn lại',
    discount: 'Giảm giá',
    waiver: 'Miễn giảm',
    unclassified: 'Giảm trừ chưa phân loại',
    spent: 'Đã chi',
    fundBalance: 'Số dư quỹ',
  },
  details: { viewDetails: 'Xem chi tiết' },
};

const report: CenterFinanceReport = {
  success: true,
  selectedMonth: '2026-04',
  months: [],
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
  incomeByLevel: [],
  expensesByCategory: [],
  receivablesByStatus: [],
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

describe('FinanceKpiRow', () => {
  it('renders projected revenue and fund balance', () => {
    render(<FinanceKpiRow report={report} t={t} onOpenDetails={vi.fn()} />);
    expect(screen.getByText('Doanh thu dự kiến')).toBeInTheDocument();
    expect(screen.getByText('Số dư quỹ')).toBeInTheDocument();
    expect(screen.getAllByText(/500\.0K/).length).toBeGreaterThanOrEqual(1);
  });

  it('hides the unclassified card when it is zero', () => {
    render(<FinanceKpiRow report={report} t={t} onOpenDetails={vi.fn()} />);
    expect(screen.queryByText('Giảm trừ chưa phân loại')).not.toBeInTheDocument();
  });

  it('shows the unclassified card when it is non-zero', () => {
    const withUnclassified: CenterFinanceReport = {
      ...report,
      discountBreakdown: { discount: 0, waiver: 0, unclassified: 40_000 },
    };
    render(<FinanceKpiRow report={withUnclassified} t={t} onOpenDetails={vi.fn()} />);
    expect(screen.getByText('Giảm trừ chưa phân loại')).toBeInTheDocument();
  });

  it('makes only collected and spent cards actionable', () => {
    const onOpenDetails = vi.fn();
    render(<FinanceKpiRow report={report} t={t} onOpenDetails={onOpenDetails} />);
    fireEvent.click(screen.getByRole('button', { name: /Đã thu.*Xem chi tiết/ }));
    fireEvent.click(screen.getByRole('button', { name: /Đã chi.*Xem chi tiết/ }));
    expect(onOpenDetails).toHaveBeenNthCalledWith(1, 'income');
    expect(onOpenDetails).toHaveBeenNthCalledWith(2, 'expense');
    expect(screen.queryByRole('button', { name: /Doanh thu dự kiến/ })).not.toBeInTheDocument();
  });
});
