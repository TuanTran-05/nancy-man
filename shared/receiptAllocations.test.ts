import { describe, expect, it } from 'vitest';
import {
  receiptAmountForLedger,
  receiptClassIds,
  receiptMatchesClass,
} from './receiptAllocations';

describe('multi-ledger receipt adapters', () => {
  const receipt = {
    ledgerId: 'legacy-ledger',
    classId: 'legacy-class',
    amountReceived: 700,
    allocations: [
      { ledgerId: 'l1', classId: 'c1', amount: 300 },
      { ledgerId: 'l2', classId: 'c2', amount: 200 },
    ],
  };

  it('uses the matching allocation amount for a v2 receipt', () => {
    expect(receiptAmountForLedger(receipt, 'l2')).toBe(200);
  });

  it('uses the whole receipt amount for a matching legacy receipt', () => {
    expect(
      receiptAmountForLedger(
        { ledgerId: 'legacy-ledger', classId: 'legacy-class', amountReceived: 700 },
        'legacy-ledger'
      )
    ).toBe(700);
  });

  it('derives class membership from every allocation', () => {
    expect(receiptClassIds(receipt)).toEqual(['c1', 'c2']);
    expect(receiptMatchesClass(receipt, 'c2')).toBe(true);
    expect(receiptMatchesClass(receipt, 'c9')).toBe(false);
  });

  it('keeps legacy class membership when no allocation array exists', () => {
    const legacyReceipt = {
      ledgerId: 'legacy-ledger',
      classId: 'legacy-class',
      amountReceived: 700,
    };
    expect(receiptClassIds(legacyReceipt)).toEqual(['legacy-class']);
    expect(receiptMatchesClass(legacyReceipt, 'legacy-class')).toBe(true);
  });
});
