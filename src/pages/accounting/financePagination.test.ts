import { describe, expect, it } from 'vitest';
import { financeResourceForTab, mergeFinancePage, selectLedgerStats } from './financePagination';

describe('finance pagination helpers', () => {
  it('loads records only for tabs backed by paged resources', () => {
    expect(financeResourceForTab('ledgers')).toBe('ledgers');
    expect(financeResourceForTab('receipts')).toBe('receipts');
    expect(financeResourceForTab('expenses')).toBe('expenses');
    expect(financeResourceForTab('payments')).toBeNull();
    expect(financeResourceForTab('report')).toBeNull();
  });

  it('resets or appends unique rows without duplicating cursor overlaps', () => {
    expect(mergeFinancePage([{ id: 'old' }], [{ id: 'new' }], 'reset')).toEqual([{ id: 'new' }]);
    expect(
      mergeFinancePage([{ id: 'one' }, { id: 'two' }], [{ id: 'two' }, { id: 'three' }], 'append')
    ).toEqual([{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
  });

  it('uses aggregate ledger totals unless a local text search narrows loaded rows only', () => {
    const rows = [{ id: 'ledger-1', amount: 100, discountTotal: 10, paidTotal: 30 }];
    const summary = { count: 3, total: 500, discount: 20, paid: 120, remaining: 360 };

    expect(selectLedgerStats(summary, rows, false)).toEqual(summary);
    expect(selectLedgerStats(summary, rows, true)).toEqual({
      count: 1,
      total: 100,
      discount: 10,
      paid: 30,
      remaining: 60,
    });
  });
});
