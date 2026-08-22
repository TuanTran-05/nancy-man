import { describe, expect, it } from 'vitest';
import {
  isReceiptHistoryRequested,
  setReceiptHistoryView,
} from './accountingReceiptHistoryUrlState';

describe('accounting receipt history URL state', () => {
  it('recognizes both the workspace view and the legacy receipt tab', () => {
    expect(isReceiptHistoryRequested('?tab=students&view=receipt-history')).toBe(true);
    expect(isReceiptHistoryRequested('?tab=receipts')).toBe(true);
    expect(isReceiptHistoryRequested('?tab=students')).toBe(false);
  });

  it('opens history while preserving workspace filters and cursor', () => {
    expect(
      setReceiptHistoryView('?tab=students&studentSearch=Lan&studentCursor=next-1', true)
    ).toBe('?tab=students&studentSearch=Lan&studentCursor=next-1&view=receipt-history');
  });

  it('normalizes a legacy link and closes without dropping unrelated params', () => {
    const normalized = setReceiptHistoryView('?tab=receipts&studentPaymentStatus=overdue', true);
    expect(normalized).toBe('?tab=students&studentPaymentStatus=overdue&view=receipt-history');
    expect(setReceiptHistoryView(normalized, false)).toBe(
      '?tab=students&studentPaymentStatus=overdue'
    );
  });
});
