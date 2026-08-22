import { describe, expect, it } from 'vitest';
import { resolveLedgerStatus } from './money';

describe('resolveLedgerStatus', () => {
  it('returns waived for full waiver regardless of totals', () => {
    expect(
      resolveLedgerStatus({ amount: 100, paidTotal: 0, discountTotal: 100, isFullWaiver: true })
    ).toBe('waived');
  });

  it('returns paid when paidTotal covers amount minus discount', () => {
    expect(resolveLedgerStatus({ amount: 100, paidTotal: 60, discountTotal: 40 })).toBe('paid');
  });

  it('returns unpaid when nothing paid and nothing discounted', () => {
    expect(resolveLedgerStatus({ amount: 100, paidTotal: 0, discountTotal: 0 })).toBe('unpaid');
  });

  it('returns partial for a partial payment', () => {
    expect(resolveLedgerStatus({ amount: 100, paidTotal: 30, discountTotal: 0 })).toBe('partial');
  });

  it('post/create variant: zero effective amount counts as paid', () => {
    expect(resolveLedgerStatus({ amount: 0, paidTotal: 0, discountTotal: 0 })).toBe('paid');
  });

  it('void variant: zero effective amount is NOT paid when requirePositiveEffective', () => {
    expect(
      resolveLedgerStatus({
        amount: 0,
        paidTotal: 0,
        discountTotal: 0,
        requirePositiveEffective: true,
      })
    ).toBe('unpaid');
  });
});
