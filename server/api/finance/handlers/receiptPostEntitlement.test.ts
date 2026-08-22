import { describe, expect, it } from 'vitest';
import { clampSiblingGrantForPost } from './receiptDiscount.js';

describe('clampSiblingGrantForPost', () => {
  it('leaves a receipt untouched when the entitlement is free', () => {
    expect(
      clampSiblingGrantForPost({
        ledgerAmount: 1_000_000,
        siblingDiscountTotal: 0,
        receiptDiscountAmount: 100_000,
        receiptSiblingAmount: 100_000,
      })
    ).toEqual({ siblingGrant: 100_000, discountAmount: 100_000, clamped: false });
  });

  it('clamps a stale draft to nothing when the entitlement was spent', () => {
    expect(
      clampSiblingGrantForPost({
        ledgerAmount: 1_000_000,
        siblingDiscountTotal: 100_000,
        receiptDiscountAmount: 100_000,
        receiptSiblingAmount: 100_000,
      })
    ).toEqual({ siblingGrant: 0, discountAmount: 0, clamped: true });
  });

  it('clamps down to the remaining shortfall', () => {
    expect(
      clampSiblingGrantForPost({
        ledgerAmount: 1_000_000,
        siblingDiscountTotal: 60_000,
        receiptDiscountAmount: 300_000,
        receiptSiblingAmount: 100_000,
      })
    ).toEqual({ siblingGrant: 40_000, discountAmount: 240_000, clamped: true });
  });

  it('preserves the base discount when clamping', () => {
    const result = clampSiblingGrantForPost({
      ledgerAmount: 1_000_000,
      siblingDiscountTotal: 100_000,
      receiptDiscountAmount: 300_000,
      receiptSiblingAmount: 100_000,
    });
    expect(result.discountAmount).toBe(200_000);
  });

  it('is a no-op for a receipt with no sibling component', () => {
    expect(
      clampSiblingGrantForPost({
        ledgerAmount: 1_000_000,
        siblingDiscountTotal: 100_000,
        receiptDiscountAmount: 200_000,
        receiptSiblingAmount: 0,
      })
    ).toEqual({ siblingGrant: 0, discountAmount: 200_000, clamped: false });
  });
});
