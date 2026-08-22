import { describe, expect, it } from 'vitest';
import {
  defaultStatusFilterForFinanceTab,
  getPaymentReviewDetailLines,
} from './financePaymentReview';
import type { OnlinePaymentRequest } from '../../types';

const basePayment: OnlinePaymentRequest = {
  id: 'payment-1',
  orderCode: 2605160001,
  ledgerId: 'ledger-1',
  studentId: 'stu-1',
  classId: 'class-1',
  parentUid: 'parent-uid',
  amount: 500000,
  currency: 'VND',
  provider: 'payos',
  status: 'needs_review',
  createdAt: '2026-05-26T01:00:00.000Z',
};

describe('finance PayOS review helpers', () => {
  it('opens the payments tab on the review queue by default', () => {
    expect(defaultStatusFilterForFinanceTab('payments')).toBe('needs_review');
    expect(defaultStatusFilterForFinanceTab('ledgers')).toBe('all');
    expect(defaultStatusFilterForFinanceTab('receipts')).toBe('all');
  });

  it('summarizes gateway and manual receipt conflict details for review rows', () => {
    const lines = getPaymentReviewDetailLines(
      {
        ...basePayment,
        gatewayAmount: 650000,
        gatewayReference: 'TF999',
        manualReceiptNo: 'PT-260513-001',
        manualReceiptAmount: 500000,
      },
      'en',
      (amount) => `${amount.toLocaleString('vi-VN')} đ`
    );

    expect(lines).toEqual([
      'Gateway amount: 650.000 đ',
      'Gateway ref: TF999',
      'Manual receipt: PT-260513-001',
      'Manual amount: 500.000 đ',
    ]);
  });
});
