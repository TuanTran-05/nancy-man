// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceReport from './FinanceReport';
import * as financeApi from '../../lib/api/financeApi';
import type { CenterFinanceReport } from '../../lib/api/financeApi';

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'vi' }),
}));

const sample: CenterFinanceReport = {
  success: true,
  selectedMonth: '2026-04',
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

beforeEach(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
  vi.spyOn(financeApi, 'fetchClassReconciliationOptions').mockResolvedValue({
    success: true,
    mode: 'classes',
    classes: [
      {
        id: 'c1',
        name: 'Tiếng Anh 1A',
        status: 'active',
        teacherId: 't1',
        teacherName: 'Nguyễn Văn A',
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FinanceReport page', () => {
  it('fetches and renders the projected revenue headline', async () => {
    vi.spyOn(financeApi, 'fetchCenterFinanceReport').mockResolvedValue(sample);
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );
    await waitFor(() => expect(financeApi.fetchCenterFinanceReport).toHaveBeenCalled());
    expect(await screen.findByText('Doanh thu dự kiến')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Mở sổ thu/chi' })).toHaveAttribute(
      'href',
      '/tuition'
    );
  });

  it('shows the "range too large" message on a 413 (errorCode report_too_large)', async () => {
    const error = Object.assign(new Error('too large'), {
      errorCode: 'report_too_large',
      status: 413,
    });
    vi.spyOn(financeApi, 'fetchCenterFinanceReport').mockRejectedValue(error);
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );
    expect(await screen.findByText(/quá lớn/i)).toBeInTheDocument();
  });

  it('hides the previous report while a new month is loading', async () => {
    vi.spyOn(financeApi, 'fetchCenterFinanceReport')
      .mockResolvedValueOnce(sample)
      .mockImplementationOnce(() => new Promise<CenterFinanceReport>(() => undefined));
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );
    expect(await screen.findByText(/2\.7M/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tháng'), { target: { value: '2026-05' } });

    expect(await screen.findByText('Đang tải báo cáo...')).toBeInTheDocument();
    expect(screen.queryByText(/2\.7M/)).not.toBeInTheDocument();
  });

  it('opens income details for the selected report month', async () => {
    vi.spyOn(financeApi, 'fetchCenterFinanceReport').mockResolvedValue(sample);
    vi.spyOn(financeApi, 'fetchCenterFinanceReportDetails').mockResolvedValue({
      success: true,
      month: sample.selectedMonth,
      type: 'income',
      period: { startDate: '2026-04-01', endDate: '2026-04-30' },
      totalCount: 0,
      totalAmount: sample.current.cashIn,
      rows: [],
      nextCursor: null,
    });
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: /Đã thu.*Xem chi tiết/ }));
    expect(await screen.findByRole('dialog', { name: 'Chi tiết khoản thu' })).toBeInTheDocument();
    expect(financeApi.fetchCenterFinanceReportDetails).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'income' })
    );
  });

  it('refreshes the summary in place when detail aggregate changed', async () => {
    const refreshed = {
      ...sample,
      current: { ...sample.current, cashIn: 1_100_000 },
    };
    vi.spyOn(financeApi, 'fetchCenterFinanceReport')
      .mockResolvedValueOnce(sample)
      .mockResolvedValueOnce(refreshed);
    vi.spyOn(financeApi, 'fetchCenterFinanceReportDetails').mockResolvedValue({
      success: true,
      month: sample.selectedMonth,
      type: 'income',
      period: { startDate: '2026-04-01', endDate: '2026-04-30' },
      totalCount: 1,
      totalAmount: 1_100_000,
      rows: [],
      nextCursor: null,
    });
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: /Đã thu.*Xem chi tiết/ }));
    await waitFor(() => expect(financeApi.fetchCenterFinanceReport).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('dialog', { name: 'Chi tiết khoản thu' })).toBeInTheDocument();
  });
});

describe('FinanceReport class tuition reconciliation placement', () => {
  function textPositions(labels: string[]): number[] {
    const body = document.body.textContent || '';
    return labels.map((label) => body.indexOf(label));
  }

  it('places the class reconciliation block between the KPI row and student reconciliation', async () => {
    vi.spyOn(financeApi, 'fetchCenterFinanceReport').mockResolvedValue(sample);
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );

    await screen.findByText('Đối soát học phí học sinh');
    const [kpi, classBlock, studentBlock, chart] = textPositions([
      'Doanh thu dự kiến',
      'Đối soát học phí lớp',
      'Đối soát học phí học sinh',
      'Cấu trúc doanh thu tháng',
    ]);

    expect(kpi).toBeGreaterThanOrEqual(0);
    expect(classBlock).toBeGreaterThan(kpi);
    expect(studentBlock).toBeGreaterThan(classBlock);
    expect(chart).toBeGreaterThan(studentBlock);
  });

  it('keeps the class block mounted while a new month is loading', async () => {
    vi.spyOn(financeApi, 'fetchCenterFinanceReport')
      .mockResolvedValueOnce(sample)
      .mockImplementationOnce(() => new Promise<CenterFinanceReport>(() => undefined));
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );
    await screen.findByText('Đối soát học phí lớp');
    const classSelect = (await screen.findByLabelText('Lớp')) as HTMLSelectElement;
    fireEvent.change(classSelect, { target: { value: 'c1' } });
    await waitFor(() => expect(classSelect.value).toBe('c1'));

    fireEvent.change(screen.getByLabelText('Tháng'), { target: { value: '2026-05' } });
    expect(await screen.findByText('Đang tải báo cáo...')).toBeInTheDocument();

    // the month request owns only the center report; the class scope must survive it
    expect(screen.getByText('Đối soát học phí lớp')).toBeInTheDocument();
    expect((screen.getByLabelText('Lớp') as HTMLSelectElement).value).toBe('c1');
  });

  it('does not refetch class options when the month changes', async () => {
    vi.spyOn(financeApi, 'fetchCenterFinanceReport').mockResolvedValue(sample);
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );
    await screen.findByText('Đối soát học phí lớp');
    await waitFor(() =>
      expect(financeApi.fetchClassReconciliationOptions).toHaveBeenCalledTimes(1)
    );

    fireEvent.change(screen.getByLabelText('Tháng'), { target: { value: '2026-05' } });
    await waitFor(() => expect(financeApi.fetchCenterFinanceReport).toHaveBeenCalledTimes(2));

    expect(financeApi.fetchClassReconciliationOptions).toHaveBeenCalledTimes(1);
  });

  it('keeps the center report visible when the class block fails to load', async () => {
    vi.spyOn(financeApi, 'fetchCenterFinanceReport').mockResolvedValue(sample);
    vi.mocked(financeApi.fetchClassReconciliationOptions).mockRejectedValue(
      new Error('class options down')
    );
    render(
      <MemoryRouter>
        <FinanceReport />
      </MemoryRouter>
    );

    expect(await screen.findByText('class options down')).toBeInTheDocument();
    expect(screen.getByText('Doanh thu dự kiến')).toBeInTheDocument();
    expect(screen.getByText('Đối soát học phí học sinh')).toBeInTheDocument();
    expect(screen.getByText('Cấu trúc doanh thu tháng')).toBeInTheDocument();
  });
});
