// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCenterFinanceReportDetails } from '../../../lib/api/financeApi';
import { translations } from '../../../lib/i18n/translations';
import {
  expenseResponse,
  incomeResponse,
} from '../../admin/components/financeReport/financeReportDetailsTestFixtures';
import { ReportTab } from './ReportTab';

vi.mock('../../../lib/api/financeApi', () => ({
  fetchCenterFinanceReportDetails: vi.fn(),
}));

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
  fullMonthDetailHint: 'Select one full month to view transaction details.',
  reloadReportDetailHint: 'Load the report after changing dates to view transaction details.',
  byDay: 'By day',
  byMonth: 'Group by month',
  reportPeriod: 'Report period',
  today: 'Today',
  aggregationMode: 'Group results',
  dailyBreakdown: 'Daily Breakdown',
  date: 'Date',
  noDailyData: 'No posted transactions in this period.',
  reportTooLarge:
    'The selected period contains too many transactions. Choose a shorter date range.',
};

const report = {
  totalIncome: 3_000_000,
  totalExpenses: 800_000,
  totalScholarships: 500_000,
  balance: 2_200_000,
  source: 'live' as const,
  dailyBreakdown: [
    { date: '2026-06-05', income: 2_000_000, expenses: 0, balance: 2_000_000 },
    { date: '2026-06-10', income: 1_000_000, expenses: 800_000, balance: 200_000 },
  ],
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
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

type ReportTabTestProps = React.ComponentProps<typeof ReportTab> & {
  reportRange: { from: string; to: string } | null;
};

function renderReportTab(overrides: Partial<ReportTabTestProps> = {}) {
  const props = {
    activeTab: 'report',
    reportFrom: '2026-06-01',
    setReportFrom: vi.fn(),
    reportTo: '2026-06-30',
    setReportTo: vi.fn(),
    handleLoadReport: vi.fn(),
    reportLoading: false,
    language: 'en',
    t: { financePage },
    report,
    reportRange: { from: '2026-06-01', to: '2026-06-30' },
    ...overrides,
  } as ReportTabTestProps;

  return { ...render(<ReportTab {...props} />), props };
}

describe('ReportTab', () => {
  it.each([
    {
      language: 'en',
      byDay: 'By day',
      byMonth: 'Group by month',
      empty: 'No posted transactions in this period.',
    },
    {
      language: 'vi',
      byDay: 'Từng ngày',
      byMonth: 'Gộp theo tháng',
      empty: 'Không có giao dịch đã ghi sổ trong kỳ này.',
    },
  ])(
    'renders daily controls with the production $language locale',
    ({ language, byDay, byMonth, empty }) => {
      renderReportTab({
        language,
        t: { financePage: translations[language as 'en' | 'vi'].financePage },
        report: { ...report, dailyBreakdown: [] },
      });

      expect(screen.getByRole('button', { name: byDay })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: byMonth })).toBeInTheDocument();
      expect(screen.getByText(empty)).toBeInTheDocument();
    }
  );

  it('separates report period controls from aggregation controls', () => {
    renderReportTab();

    expect(screen.getByRole('group', { name: 'Report period' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Group results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
  });

  it('renders loaded fund report charts without throwing', async () => {
    renderReportTab();

    expect(await screen.findByText('Income by level')).toBeInTheDocument();
    expect(screen.getByText('Expenses by category')).toBeInTheDocument();
  });

  it('renders income, expenses, and scholarships in the fund composition pie chart', () => {
    renderReportTab();

    expect(
      screen.getByRole('img', { name: 'Income, expenses and scholarships' })
    ).toBeInTheDocument();
    expect(screen.getByText('Scholarships')).toBeInTheDocument();
    expect(screen.getByText('500.000 đ')).toBeInTheDocument();
  });

  it('opens synchronized income details from a complete-month report', async () => {
    vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
      ...incomeResponse,
      month: '2026-06',
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      totalAmount: 3_000_000,
    });
    renderReportTab();

    fireEvent.click(screen.getByRole('button', { name: 'Total income: View details' }));

    expect(
      await screen.findByRole('dialog', { name: 'Income transaction details' })
    ).toBeInTheDocument();
    expect((await screen.findAllByText('PT-260730-001')).length).toBeGreaterThan(0);
    expect(fetchCenterFinanceReportDetails).toHaveBeenCalledWith({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      type: 'income',
      pageSize: 25,
      cursor: null,
    });
  });

  it('opens synchronized expense details from a complete-month report', async () => {
    vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
      ...expenseResponse,
      month: '2026-06',
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      totalAmount: 800_000,
    });
    renderReportTab();

    fireEvent.click(screen.getByRole('button', { name: 'Total expenses: View details' }));

    expect(
      await screen.findByRole('dialog', { name: 'Expense transaction details' })
    ).toBeInTheDocument();
    expect((await screen.findAllByText('PC-260730-001')).length).toBeGreaterThan(0);
    expect(fetchCenterFinanceReportDetails).toHaveBeenCalledWith({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      type: 'expense',
      pageSize: 25,
      cursor: null,
    });
  });

  it('opens total income details for the exact loaded partial-month range', async () => {
    vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
      ...incomeResponse,
      month: undefined,
      period: { startDate: '2026-06-01', endDate: '2026-06-15' },
      totalAmount: 3_000_000,
    });
    renderReportTab({
      reportTo: '2026-06-15',
      reportRange: { from: '2026-06-01', to: '2026-06-15' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Total income: View details' }));
    await screen.findByRole('dialog', { name: 'Income transaction details' });

    expect(fetchCenterFinanceReportDetails).toHaveBeenCalledWith({
      startDate: '2026-06-01',
      endDate: '2026-06-15',
      type: 'income',
      pageSize: 25,
      cursor: null,
    });
  });

  it('shows daily rows by default and drills into one day', async () => {
    vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
      ...expenseResponse,
      month: undefined,
      period: { startDate: '2026-06-10', endDate: '2026-06-10' },
      totalAmount: 800_000,
    });
    renderReportTab();

    expect(screen.getByRole('button', { name: 'By day' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Total expenses 10\/06\/2026/i }));
    await screen.findByRole('dialog', { name: 'Expense transaction details' });
    expect(fetchCenterFinanceReportDetails).toHaveBeenCalledWith({
      startDate: '2026-06-10',
      endDate: '2026-06-10',
      type: 'expense',
      pageSize: 25,
      cursor: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Group by month' }));
    expect(screen.getByText('Monthly breakdown')).toBeInTheDocument();
  });

  it('does not create a drill-down button for a zero daily amount', () => {
    renderReportTab();
    expect(
      screen.queryByRole('button', { name: /Total expenses 05\/06\/2026/i })
    ).not.toBeInTheDocument();
  });

  it('keeps detail actions disabled until edited filters are loaded', () => {
    renderReportTab({ reportFrom: '2026-07-01', reportTo: '2026-07-31' });

    expect(
      screen.queryByRole('button', { name: 'Total income: View details' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Total expenses: View details' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Load the report after changing dates to view transaction details.')
    ).toBeInTheDocument();
  });

  it('requests a live summary refresh when detail totals are stale', async () => {
    vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
      ...incomeResponse,
      month: '2026-06',
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      totalAmount: 3_100_000,
    });
    const handleLoadReport = vi.fn();
    renderReportTab({ handleLoadReport });

    fireEvent.click(screen.getByRole('button', { name: 'Total income: View details' }));

    await waitFor(() => expect(handleLoadReport).toHaveBeenCalledWith({ forceLive: true }));
  });

  it('does not refetch open details when the parent callback identity changes', async () => {
    vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
      ...incomeResponse,
      month: '2026-06',
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      totalAmount: 3_000_000,
    });
    const rendered = renderReportTab();
    fireEvent.click(screen.getByRole('button', { name: 'Total income: View details' }));
    await screen.findByRole('dialog', { name: 'Income transaction details' });
    expect(fetchCenterFinanceReportDetails).toHaveBeenCalledTimes(1);

    rendered.rerender(<ReportTab {...rendered.props} reportLoading handleLoadReport={vi.fn()} />);

    expect(fetchCenterFinanceReportDetails).toHaveBeenCalledTimes(1);
  });

  it('does not reopen details from the previous period after new filters are loaded', async () => {
    vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
      ...incomeResponse,
      month: undefined,
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      totalAmount: 3_000_000,
    });
    const rendered = renderReportTab();

    fireEvent.click(screen.getByRole('button', { name: 'Total income: View details' }));
    await screen.findByRole('dialog', { name: 'Income transaction details' });

    rendered.rerender(
      <ReportTab {...rendered.props} reportFrom="2026-07-01" reportTo="2026-07-31" />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rendered.rerender(
      <ReportTab
        {...rendered.props}
        reportFrom="2026-07-01"
        reportTo="2026-07-31"
        reportRange={{ from: '2026-07-01', to: '2026-07-31' }}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchCenterFinanceReportDetails).toHaveBeenCalledTimes(1);
  });

  it('sets the current-month preset through the final calendar day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T08:00:00+07:00'));
    const setReportFrom = vi.fn();
    const setReportTo = vi.fn();
    const handleLoadReport = vi.fn();
    const rendered = renderReportTab({ setReportFrom, setReportTo, handleLoadReport });

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));

    expect(setReportFrom).toHaveBeenCalledWith('2026-07-01');
    expect(setReportTo).toHaveBeenCalledWith('2026-07-31');
    expect(handleLoadReport).toHaveBeenCalledWith({
      range: { from: '2026-07-01', to: '2026-07-31' },
    });
  });

  it('loads the exact Today range immediately without waiting for React state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 6, 8));
    const setReportFrom = vi.fn();
    const setReportTo = vi.fn();
    const handleLoadReport = vi.fn();
    renderReportTab({ setReportFrom, setReportTo, handleLoadReport });

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    const range = { from: '2026-08-06', to: '2026-08-06' };
    expect(setReportFrom).toHaveBeenCalledWith(range.from);
    expect(setReportTo).toHaveBeenCalledWith(range.to);
    expect(handleLoadReport).toHaveBeenCalledWith({ range });
  });

  it('rolls Today forward when the report tab stays open across local midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 6, 23, 59, 59, 900));
    const setReportFrom = vi.fn();
    const setReportTo = vi.fn();
    const handleLoadReport = vi.fn();
    renderReportTab({
      reportFrom: '2026-08-06',
      reportTo: '2026-08-06',
      reportRange: { from: '2026-08-06', to: '2026-08-06' },
      setReportFrom,
      setReportTo,
      handleLoadReport,
    });

    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    const nextDayRange = { from: '2026-08-07', to: '2026-08-07' };
    expect(setReportFrom).toHaveBeenCalledWith(nextDayRange.from);
    expect(setReportTo).toHaveBeenCalledWith(nextDayRange.to);
    expect(handleLoadReport).toHaveBeenCalledWith({ range: nextDayRange });
  });

  it('resolves Today from the activation time when the midnight timer has not run yet', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 6, 23, 59, 59, 900));
    const setReportFrom = vi.fn();
    const setReportTo = vi.fn();
    const handleLoadReport = vi.fn();
    const rendered = renderReportTab({ setReportFrom, setReportTo, handleLoadReport });

    vi.setSystemTime(new Date(2026, 7, 7, 0, 0, 0, 100));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    const nextDayRange = { from: '2026-08-07', to: '2026-08-07' };
    expect(setReportFrom).toHaveBeenCalledWith(nextDayRange.from);
    expect(setReportTo).toHaveBeenCalledWith(nextDayRange.to);
    expect(handleLoadReport).toHaveBeenCalledWith({ range: nextDayRange });

    rendered.rerender(
      <ReportTab
        {...rendered.props}
        reportFrom={nextDayRange.from}
        reportTo={nextDayRange.to}
        reportRange={nextDayRange}
      />
    );
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('synchronizes presets when midnight passes between render and effect setup', () => {
    const RealDate = Date;
    const beforeMidnight = new RealDate(2026, 7, 6, 23, 59, 59, 999);
    const afterMidnight = new RealDate(2026, 7, 7, 0, 0, 0, 1);
    let currentDateCalls = 0;
    const MockDate = function (...args: unknown[]) {
      if (args.length === 0) {
        return new RealDate(currentDateCalls++ === 0 ? beforeMidnight : afterMidnight);
      }
      return Reflect.construct(RealDate, args);
    } as unknown as typeof Date;
    vi.spyOn(globalThis, 'Date').mockImplementation(MockDate);

    renderReportTab({
      reportFrom: '2026-08-07',
      reportTo: '2026-08-07',
      reportRange: { from: '2026-08-07', to: '2026-08-07' },
    });

    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks a preset applied only when the inputs and loaded range both match', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 8));

    const applied = renderReportTab();
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    applied.rerender(
      <ReportTab {...applied.props} reportRange={{ from: '2026-05-01', to: '2026-05-31' }} />
    );
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('keeps the selected aggregation mode when filters and loaded range change', () => {
    const rendered = renderReportTab();
    fireEvent.click(screen.getByRole('button', { name: 'Group by month' }));
    expect(screen.getByRole('button', { name: 'Group by month' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    rendered.rerender(
      <ReportTab
        {...rendered.props}
        reportFrom="2026-07-01"
        reportTo="2026-07-31"
        reportRange={{ from: '2026-07-01', to: '2026-07-31' }}
      />
    );

    expect(screen.getByRole('button', { name: 'Group by month' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
