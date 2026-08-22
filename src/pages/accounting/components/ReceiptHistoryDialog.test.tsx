// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../../../lib/i18n/translations';
import type { ReceiptHistoryDialogProps } from './ReceiptHistoryDialog';
import { ReceiptHistoryDialog } from './ReceiptHistoryDialog';

const baseProps: ReceiptHistoryDialogProps = {
  onClose: vi.fn(),
  receipts: [],
  studentMap: {},
  classMap: {},
  actionLoading: null,
  onPostReceipt: vi.fn(),
  onVoidReceipt: vi.fn(),
  hasMore: false,
  loading: false,
  onLoadMore: vi.fn(),
  language: 'vi',
  t: translations.vi,
  classFilter: '',
  setClassFilter: vi.fn(),
  statusFilter: 'all',
  setStatusFilter: vi.fn(),
  dateFrom: '',
  setDateFrom: vi.fn(),
  dateTo: '',
  setDateTo: vi.fn(),
  searchQuery: '',
  setSearchQuery: vi.fn(),
  sortedClasses: [],
  teachers: [],
  referenceDataLoading: false,
  referenceDataError: null,
  onRetryReferenceData: vi.fn(),
  historyError: null,
  onRetryHistory: vi.fn(),
};

describe('ReceiptHistoryDialog', () => {
  it('renders an accessible filtered history dialog without a create action', () => {
    render(<ReceiptHistoryDialog {...baseProps} />);

    expect(screen.getByRole('dialog', { name: 'Lịch sử thu' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Tìm kiếm/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tạo phiếu thu/i })).not.toBeInTheDocument();
  });

  it('shows reference-data failure and retries without rendering stale names', async () => {
    const user = userEvent.setup();
    const onRetryReferenceData = vi.fn();
    render(
      <ReceiptHistoryDialog
        {...baseProps}
        referenceDataError="Không tải được danh bạ học sinh"
        onRetryReferenceData={onRetryReferenceData}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh bạ học sinh');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetryReferenceData).toHaveBeenCalledOnce();
  });

  it('shows a receipt-history load failure and retries in place', async () => {
    const user = userEvent.setup();
    const onRetryHistory = vi.fn();
    render(
      <ReceiptHistoryDialog
        {...baseProps}
        historyError="Không tải được lịch sử thu"
        onRetryHistory={onRetryHistory}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được lịch sử thu');
    await user.click(screen.getByRole('button', { name: 'Tải lại lịch sử' }));
    expect(onRetryHistory).toHaveBeenCalledOnce();
  });

  it('shows initial history loading instead of an empty receipt state', () => {
    render(<ReceiptHistoryDialog {...baseProps} loading />);

    expect(screen.getByLabelText('Đang tải lịch sử thu')).toBeInTheDocument();
    expect(screen.queryByText(translations.vi.financePage.noReceipts)).not.toBeInTheDocument();
  });

  it('closes on Escape but yields to a nested modal', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ReceiptHistoryDialog {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    rerender(
      <>
        <ReceiptHistoryDialog {...baseProps} onClose={onClose} />
        <div role="dialog" aria-modal="true" aria-label="Hủy phiếu" />
      </>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
