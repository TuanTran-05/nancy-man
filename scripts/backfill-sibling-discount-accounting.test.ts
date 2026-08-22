import { describe, expect, it } from 'vitest';
import {
  buildSiblingAccountingBackfill,
  inferLegacySiblingAmount,
} from './backfill-sibling-discount-accounting';

describe('inferLegacySiblingAmount', () => {
  it('prefers the explicit component, capped by discountAmount', () => {
    expect(
      inferLegacySiblingAmount({
        siblingDiscount: true,
        siblingDiscountAmount: 500_000,
        discountAmount: 100_000,
      })
    ).toBe(100_000);
  });

  it('uses the explicit component as-is when it fits under discountAmount', () => {
    expect(
      inferLegacySiblingAmount({
        siblingDiscount: true,
        siblingDiscountAmount: 100_000,
        discountAmount: 300_000,
      })
    ).toBe(100_000);
  });

  it('infers 10% of originalAmount for a legacy flagged receipt with no explicit amount', () => {
    expect(
      inferLegacySiblingAmount({
        siblingDiscount: true,
        originalAmount: 1_000_000,
        discountAmount: 100_000,
      })
    ).toBe(100_000);
  });

  it('caps the legacy inference at discountAmount', () => {
    expect(
      inferLegacySiblingAmount({
        siblingDiscount: true,
        originalAmount: 5_000_000,
        discountAmount: 100_000,
      })
    ).toBe(100_000);
  });

  it('infers zero when discountAmount is not positive', () => {
    expect(
      inferLegacySiblingAmount({
        siblingDiscount: true,
        originalAmount: 1_000_000,
        discountAmount: 0,
      })
    ).toBe(0);
  });

  it('infers zero for a receipt with no sibling flag or component', () => {
    expect(inferLegacySiblingAmount({ discountAmount: 100_000, originalAmount: 1_000_000 })).toBe(
      0
    );
  });
});

describe('buildSiblingAccountingBackfill', () => {
  it('excludes draft and void receipts', () => {
    const result = buildSiblingAccountingBackfill(
      [
        {
          id: 'r1',
          status: 'draft',
          ledgerId: 'l1',
          siblingDiscount: true,
          originalAmount: 1_000_000,
          discountAmount: 100_000,
        },
        {
          id: 'r2',
          status: 'void',
          ledgerId: 'l1',
          siblingDiscount: true,
          originalAmount: 1_000_000,
          discountAmount: 100_000,
        },
      ],
      [{ id: 'l1', amount: 1_000_000 }]
    );
    expect(result.receiptPatches).toEqual([]);
    expect(result.ledgerPatches).toEqual([]);
  });

  it('produces exact receipt and ledger patches for a posted legacy receipt', () => {
    const result = buildSiblingAccountingBackfill(
      [
        {
          id: 'r1',
          status: 'posted',
          ledgerId: 'l1',
          siblingDiscount: true,
          originalAmount: 1_000_000,
          discountAmount: 100_000,
        },
      ],
      [{ id: 'l1', amount: 1_000_000, siblingDiscountTotal: 0 }]
    );
    expect(result.receiptPatches).toEqual([{ id: 'r1', siblingDiscountAmount: 100_000 }]);
    expect(result.ledgerPatches).toEqual([{ id: 'l1', siblingDiscountTotal: 100_000 }]);
  });

  it('caps several posted receipts sharing one ledger at a single entitlement', () => {
    const result = buildSiblingAccountingBackfill(
      [
        {
          id: 'r1',
          status: 'posted',
          ledgerId: 'l1',
          siblingDiscount: true,
          originalAmount: 1_000_000,
          discountAmount: 100_000,
        },
        {
          id: 'r2',
          status: 'posted',
          ledgerId: 'l1',
          siblingDiscount: true,
          originalAmount: 1_000_000,
          discountAmount: 100_000,
        },
      ],
      [{ id: 'l1', amount: 1_000_000, siblingDiscountTotal: 0 }]
    );
    expect(result.ledgerPatches).toEqual([{ id: 'l1', siblingDiscountTotal: 100_000 }]);
  });

  it('is idempotent: a second run over already-patched data produces empty patch arrays', () => {
    const receipts = [
      {
        id: 'r1',
        status: 'posted',
        ledgerId: 'l1',
        siblingDiscount: true,
        siblingDiscountAmount: 100_000,
        originalAmount: 1_000_000,
        discountAmount: 100_000,
      },
    ];
    const ledgers = [{ id: 'l1', amount: 1_000_000, siblingDiscountTotal: 100_000 }];
    const result = buildSiblingAccountingBackfill(receipts, ledgers);
    expect(result.receiptPatches).toEqual([]);
    expect(result.ledgerPatches).toEqual([]);
  });

  it('ignores a receipt with no sibling component', () => {
    const result = buildSiblingAccountingBackfill(
      [{ id: 'r1', status: 'posted', ledgerId: 'l1', discountAmount: 100_000 }],
      [{ id: 'l1', amount: 1_000_000 }]
    );
    expect(result.receiptPatches).toEqual([]);
    expect(result.ledgerPatches).toEqual([]);
  });
});
