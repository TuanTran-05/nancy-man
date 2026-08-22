// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../../../lib/i18n/translations';
import type { Class, Receipt, Student } from '../../../types';
import { ReceiptHistoryTable } from './ReceiptHistoryTable';

describe('ReceiptHistoryTable', () => {
  it('summarizes multiple debts and expands their stored allocation details', async () => {
    const user = userEvent.setup();
    const classes = {
      c1: { id: 'c1', name: 'A1' } as Class,
      c2: { id: 'c2', name: 'B1' } as Class,
    };
    const receipt = {
      id: 'r1',
      receiptNo: 'PT-260728-001',
      type: 'tuition',
      flowVersion: 'wallet-manual-v2',
      studentId: 's1',
      classId: 'c1',
      classIds: ['c1', 'c2'],
      amountReceived: 1_500_000,
      allocations: [
        { ledgerId: 'l1', classId: 'c1', amount: 900_000 },
        { ledgerId: 'l2', classId: 'c2', amount: 600_000 },
      ],
      paymentMethod: 'cash',
      receivedDate: '2026-07-28',
      createdBy: 'u1',
      createdByRole: 'accounting',
      status: 'posted',
      createdAt: '2026-07-28T00:00:00.000Z',
    } as Receipt;

    render(
      <ReceiptHistoryTable
        receipts={[receipt]}
        studentMap={{ s1: { id: 's1', name: 'Nguyễn An' } as Student }}
        classMap={classes}
        actionLoading={null}
        onPostReceipt={vi.fn()}
        onVoidReceipt={vi.fn()}
        hasMore={false}
        loading={false}
        onLoadMore={vi.fn()}
        language="vi"
        t={translations.vi}
      />
    );

    expect(screen.queryByRole('button', { name: /Tạo phiếu thu/i })).not.toBeInTheDocument();
    expect(screen.getByText('2 khoản công nợ')).toBeInTheDocument();

    const detailsButton = screen.getByRole('button', {
      name: 'Xem chi tiết phân bổ',
    });
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(detailsButton);
    expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('900.000 đ')).toBeInTheDocument();
    expect(screen.getByText('600.000 đ')).toBeInTheDocument();
  });

  it('links the student name to the finance profile in a new browser tab', () => {
    const receipt = {
      id: 'r1',
      receiptNo: 'PT-260728-001',
      type: 'tuition',
      studentId: 's1',
      classId: 'c1',
      amountReceived: 900_000,
      paymentMethod: 'cash',
      receivedDate: '2026-07-28',
      createdBy: 'u1',
      createdByRole: 'accounting',
      status: 'posted',
      createdAt: '2026-07-28T00:00:00.000Z',
    } as Receipt;

    render(
      <ReceiptHistoryTable
        receipts={[receipt]}
        studentMap={{ s1: { id: 's1', name: 'Nguyễn An' } as Student }}
        classMap={{ c1: { id: 'c1', name: 'A1' } as Class }}
        actionLoading={null}
        onPostReceipt={vi.fn()}
        onVoidReceipt={vi.fn()}
        hasMore={false}
        loading={false}
        onLoadMore={vi.fn()}
        language="vi"
        t={translations.vi}
      />
    );

    const link = screen.getByRole('link', { name: /Nguyễn An/ });
    expect(link).toHaveAttribute('href', '/students/s1?tab=finance');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
