import { describe, expect, it } from 'vitest';
import {
  calculateLedgerBalance,
  deriveLedgerDisplayStatus,
  calculateStudentFinanceSummary,
  formatLedgerPeriodKey,
  type LedgerLike,
} from './studentFinanceReport.js';

const TODAY = '2026-07-16';
const PAST = '2026-06-01';
const FUTURE = '2026-12-31';

function makeLedger(overrides: Partial<LedgerLike> = {}): LedgerLike {
  return {
    id: 'ledger-1',
    amount: 1_000_000,
    discountTotal: 0,
    paidTotal: 0,
    dueDate: FUTURE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateLedgerBalance
// ---------------------------------------------------------------------------

describe('calculateLedgerBalance', () => {
  it('computes zero outstanding when fully paid', () => {
    const b = calculateLedgerBalance(makeLedger({ paidTotal: 1_000_000 }));
    expect(b.outstanding).toBe(0);
    expect(b.paid).toBe(1_000_000);
  });

  it('deducts discount from gross to get netAmount', () => {
    const b = calculateLedgerBalance(makeLedger({ amount: 1_000_000, discountTotal: 200_000 }));
    expect(b.netAmount).toBe(800_000);
    expect(b.outstanding).toBe(800_000);
  });

  it('does not produce negative outstanding', () => {
    const b = calculateLedgerBalance(makeLedger({ amount: 500_000, paidTotal: 1_000_000 }));
    expect(b.outstanding).toBe(0);
  });

  it('handles missing/undefined fields gracefully', () => {
    const b = calculateLedgerBalance({});
    expect(b.grossAmount).toBe(0);
    expect(b.discount).toBe(0);
    expect(b.netAmount).toBe(0);
    expect(b.outstanding).toBe(0);
  });

  it('does not apply discount twice', () => {
    // discount of 100_000 subtracted once from 500_000 = 400_000 net; paid = 400_000 => 0 outstanding
    const b = calculateLedgerBalance(makeLedger({ amount: 500_000, discountTotal: 100_000, paidTotal: 400_000 }));
    expect(b.outstanding).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveLedgerDisplayStatus
// ---------------------------------------------------------------------------

describe('deriveLedgerDisplayStatus', () => {
  it('waived when netAmount is 0 (full discount)', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ amount: 1_000_000, discountTotal: 1_000_000 }),
      TODAY,
    );
    expect(info.displayStatus).toBe('waived');
  });

  it('paid when outstanding is 0', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ paidTotal: 1_000_000 }),
      TODAY,
    );
    expect(info.displayStatus).toBe('paid');
  });

  it('overdue when dueDate is in the past and still has outstanding', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ paidTotal: 0, dueDate: PAST }),
      TODAY,
    );
    expect(info.displayStatus).toBe('overdue');
    expect(info.isOverdue).toBe(true);
  });

  it('not overdue when dueDate is in the future', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ paidTotal: 0, dueDate: FUTURE }),
      TODAY,
    );
    expect(info.displayStatus).not.toBe('overdue');
  });

  it('partial when some paid but still outstanding', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ paidTotal: 300_000, dueDate: FUTURE }),
      TODAY,
    );
    expect(info.displayStatus).toBe('partial');
  });

  it('due_date_missing when outstanding and no dueDate', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ paidTotal: 0, dueDate: undefined }),
      TODAY,
    );
    expect(info.displayStatus).toBe('due_date_missing');
    expect(info.hasDueDate).toBe(false);
  });

  it('unpaid when no payment, future dueDate', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ paidTotal: 0, dueDate: FUTURE }),
      TODAY,
    );
    expect(info.displayStatus).toBe('unpaid');
  });

  it('does not mark as overdue when fully paid even with past dueDate', () => {
    const info = deriveLedgerDisplayStatus(
      makeLedger({ paidTotal: 1_000_000, dueDate: PAST }),
      TODAY,
    );
    expect(info.displayStatus).toBe('paid');
    expect(info.isOverdue).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateStudentFinanceSummary
// ---------------------------------------------------------------------------

describe('calculateStudentFinanceSummary', () => {
  it('returns all zeros for empty array', () => {
    const summary = calculateStudentFinanceSummary([], TODAY);
    expect(summary.grossAmount).toBe(0);
    expect(summary.unpaidTerms).toBe(0);
    expect(summary.overdueTerms).toBe(0);
  });

  it('aggregates correctly across multiple ledgers', () => {
    const ledgers: LedgerLike[] = [
      makeLedger({ amount: 1_000_000, paidTotal: 1_000_000, dueDate: FUTURE }), // paid
      makeLedger({ amount: 2_000_000, paidTotal: 0, dueDate: PAST }),           // overdue
      makeLedger({ amount: 1_500_000, paidTotal: 500_000, dueDate: FUTURE }),   // partial
    ];
    const s = calculateStudentFinanceSummary(ledgers, TODAY);
    expect(s.grossAmount).toBe(4_500_000);
    expect(s.paidTotal).toBe(1_500_000);
    expect(s.outstandingTotal).toBe(3_000_000);
    expect(s.unpaidTerms).toBe(2); // overdue + partial
    expect(s.overdueTerms).toBe(1);
  });

  it('draft/void receipts not counted as paid (paidTotal should not include them)', () => {
    // paidTotal = 0 means caller excluded draft/void; function trusts input
    const s = calculateStudentFinanceSummary([makeLedger({ paidTotal: 0 })], TODAY);
    expect(s.paidTotal).toBe(0);
    expect(s.outstandingTotal).toBe(1_000_000);
  });

  it('counts missingDueDateTerms only when outstanding > 0 and no dueDate', () => {
    const ledgers: LedgerLike[] = [
      makeLedger({ paidTotal: 0, dueDate: undefined }), // missing dueDate, outstanding
      makeLedger({ paidTotal: 1_000_000, dueDate: undefined }), // fully paid, no dueDate — NOT counted
    ];
    const s = calculateStudentFinanceSummary(ledgers, TODAY);
    expect(s.missingDueDateTerms).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatLedgerPeriodKey
// ---------------------------------------------------------------------------

describe('formatLedgerPeriodKey', () => {
  it('prefers termLabel', () => {
    expect(formatLedgerPeriodKey({ termLabel: 'Tháng 7/2026', dueDate: FUTURE, id: 'l1' })).toBe('Tháng 7/2026');
  });

  it('falls back to dueDate when no termLabel', () => {
    expect(formatLedgerPeriodKey({ dueDate: FUTURE, id: 'l1' })).toBe(FUTURE);
  });

  it('falls back to id when no termLabel and no dueDate', () => {
    expect(formatLedgerPeriodKey({ id: 'l1' })).toBe('l1');
  });

  it('returns — for empty ledger', () => {
    expect(formatLedgerPeriodKey({})).toBe('—');
  });
});
