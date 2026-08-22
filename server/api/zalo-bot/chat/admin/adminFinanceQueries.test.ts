import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import { queryAdminCenterFinance } from './adminFinanceQueries.js';

describe('adminFinanceQueries', () => {
  const now = new Date('2026-08-16T10:00:00Z');

  it('queries center finance report for current month with correct metric breakdown', async () => {
    const { db } = createInMemoryDocumentStore({
      'course_fee_ledgers/l1': {
        studentId: 's1',
        amount: 3_000_000,
        discountTotal: 500_000, // net = 2.5M
        paidTotal: 1_500_000,
        month: '2026-08',
        periodType: 'monthly',
      },
      'receipts/r1': {
        amountReceived: 1_500_000,
        receivedDate: '2026-08-05',
        status: 'posted',
        discountAmount: 500_000,
        discountType: 'first_prize', // commercial discount
      },
      'expenses/e1': {
        amount: 800_000,
        paidDate: '2026-08-10',
        status: 'posted',
      },
      'expenses/e_draft': {
        amount: 2_000_000,
        paidDate: '2026-08-12',
        status: 'draft', // Draft expense must not be counted in cash-out
      },
    });

    const res = await queryAdminCenterFinance(
      db as any,
      {
        period: 'current_month',
        requestedMetrics: ['net_billed', 'cash_in', 'cash_out', 'net_cash_flow', 'discount'],
      },
      now
    );

    expect(res.kind).toBe('center_finance');
    expect(res.period.monthKey).toBe('2026-08');
    expect(res.grossBilled).toBe(3_000_000);
    expect(res.netBilled).toBe(2_500_000);
    expect(res.cashIn).toBe(1_500_000);
    expect(res.cashOut).toBe(800_000);
    expect(res.netCashFlow).toBe(700_000); // 1.5M - 800k
    expect(res.discount).toBe(500_000);
    expect(res.quality.status).toBe('complete');
  });

  it('handles service errors safely without coercing null metrics to 0', async () => {
    const brokenDb = {
      collection: () => {
        throw new Error('Database connection failed');
      },
    };

    const res = await queryAdminCenterFinance(
      brokenDb as any,
      {
        period: '2026-08',
      },
      now
    );

    expect(res.kind).toBe('center_finance');
    expect(res.quality.status).toBe('failed');
    expect(res.netBilled).toBeNull();
    expect(res.cashIn).toBeNull();
    expect(res.cashOut).toBeNull();
    expect(res.netCashFlow).toBeNull();
  });
});
