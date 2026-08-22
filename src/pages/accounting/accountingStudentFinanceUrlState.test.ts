import { describe, expect, it } from 'vitest';
import {
  parseAccountingStudentFinanceUrl,
  serializeAccountingStudentFinanceUrl,
} from './accountingStudentFinanceUrlState';

describe('accounting student finance URL state', () => {
  it('round-trips filters while preserving unrelated params', () => {
    const state = parseAccountingStudentFinanceUrl(
      '?tab=students&studentSearch=Nguyen&studentPaymentStatus=overdue'
    );
    expect(state).toMatchObject({
      search: 'Nguyen',
      paymentStatus: 'overdue',
      lifecycleScope: 'current',
      enrollmentStatus: 'all',
    });
    expect(
      serializeAccountingStudentFinanceUrl(
        { search: 'Lan', paymentStatus: 'paid' },
        '?tab=students'
      )
    ).toBe('?tab=students&studentSearch=Lan&studentPaymentStatus=paid');
  });

  it('normalizes invalid statuses and removes defaults', () => {
    expect(parseAccountingStudentFinanceUrl('?studentPaymentStatus=unknown')).toMatchObject({
      search: '',
      paymentStatus: 'all',
      lifecycleScope: 'current',
      enrollmentStatus: 'all',
    });
    expect(
      serializeAccountingStudentFinanceUrl(
        { search: '', paymentStatus: 'all' },
        '?tab=students&studentSearch=x'
      )
    ).toBe('?tab=students');
  });
});
