// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchCenterFinanceReportDetails } from '../../../../lib/api/financeApi';
import {
  detailsText,
  expenseResponse,
  incomeResponse,
  secondReceipt,
} from './financeReportDetailsTestFixtures';
import {
  FinanceTransactionDetailsModal,
  type FinanceTransactionDetailsModalProps,
} from './FinanceTransactionDetailsModal';

vi.mock('../../../../lib/api/financeApi', () => ({
  fetchCenterFinanceReportDetails: vi.fn(),
}));

beforeEach(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderModal(overrides: Partial<FinanceTransactionDetailsModalProps> = {}) {
  const props: FinanceTransactionDetailsModalProps = {
    type: 'income',
    scope: { month: '2026-07' },
    expectedTotal: 1_000_000,
    language: 'vi',
    t: detailsText,
    onClose: vi.fn(),
    onSummaryStale: vi.fn(),
    ...overrides,
  };
  return { ...render(<FinanceTransactionDetailsModal {...props} />), props };
}

it('opens immediately, then renders income details and closes with Escape', async () => {
  vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue(incomeResponse);
  const onClose = vi.fn();
  render(
    <FinanceTransactionDetailsModal
      type="income"
      scope={{ month: '2026-07' }}
      expectedTotal={1_000_000}
      language="vi"
      t={detailsText}
      onClose={onClose}
      onSummaryStale={vi.fn()}
    />
  );
  expect(screen.getByRole('dialog', { name: 'Chi tiết khoản thu' })).toBeInTheDocument();
  expect(screen.getByText('Đang tải chi tiết...')).toBeInTheDocument();
  expect((await screen.findAllByText('PT-260730-001')).length).toBeGreaterThan(0);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes from both the header control and the backdrop', async () => {
  vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue(incomeResponse);
  const onClose = vi.fn();
  renderModal({ onClose });
  await screen.findAllByText('PT-260730-001');
  const closeButtons = screen.getAllByRole('button', { name: 'Đóng' });
  expect(closeButtons).toHaveLength(2);
  fireEvent.click(closeButtons[0]);
  fireEvent.click(closeButtons[1]);
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('uses the opaque next cursor and returns to the previous cursor', async () => {
  vi.mocked(fetchCenterFinanceReportDetails)
    .mockResolvedValueOnce({ ...incomeResponse, nextCursor: 'cursor-page-2' })
    .mockResolvedValueOnce({ ...incomeResponse, rows: [secondReceipt], nextCursor: null })
    .mockResolvedValueOnce({ ...incomeResponse, nextCursor: 'cursor-page-2' });
  renderModal();
  await screen.findAllByText('PT-260730-001');
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  await screen.findAllByText('PT-260730-004');
  expect(fetchCenterFinanceReportDetails).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cursor: 'cursor-page-2',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
  await screen.findAllByText('PT-260730-001');
  expect(fetchCenterFinanceReportDetails).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cursor: null,
    })
  );
});

it('notifies once when the aggregate differs from the visible KPI', async () => {
  vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
    ...incomeResponse,
    totalAmount: 1_100_000,
  });
  const onSummaryStale = vi.fn();
  renderModal({ expectedTotal: 1_000_000, onSummaryStale });
  await screen.findAllByText('PT-260730-001');
  await waitFor(() => expect(onSummaryStale).toHaveBeenCalledTimes(1));
});

it('renders an error and retries the same cursor', async () => {
  vi.mocked(fetchCenterFinanceReportDetails)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(incomeResponse);
  renderModal();
  expect(await screen.findByText('Không thể tải chi tiết giao dịch.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect((await screen.findAllByText('PT-260730-001')).length).toBeGreaterThan(0);
});

it('renders the typed empty state', async () => {
  vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue({
    ...incomeResponse,
    totalCount: 0,
    totalAmount: 0,
    rows: [],
  });
  renderModal({ expectedTotal: 0 });
  expect(await screen.findByText('Không có khoản thu trong kỳ này.')).toBeInTheDocument();
});

it('selects the expense presenter for an expense response', async () => {
  vi.mocked(fetchCenterFinanceReportDetails).mockResolvedValue(expenseResponse);
  renderModal({ type: 'expense', expectedTotal: 200_000 });
  expect((await screen.findAllByText('PC-260730-001')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Kế toán Lan').length).toBeGreaterThan(0);
});
