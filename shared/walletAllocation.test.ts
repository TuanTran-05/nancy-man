import { describe, expect, it } from 'vitest';
import {
  planManualReceiptVoid,
  planStandaloneAllocationVoid,
  planWalletAllocations,
  planWalletRefund,
} from './walletAllocation';

const ledgers = [
  {
    id: 'l1',
    studentId: 's1',
    classId: 'c1',
    amount: 1_000,
    paidTotal: 100,
    discountTotal: 0,
  },
  {
    id: 'l2',
    studentId: 's1',
    classId: 'c2',
    amount: 2_000,
    paidTotal: 0,
    discountTotal: 0,
  },
];

describe('planWalletAllocations', () => {
  it('uses the old balance plus the new receipt and leaves the chosen remainder', () => {
    expect(
      planWalletAllocations({
        studentId: 's1',
        walletBalance: 1_000,
        depositAmount: 2_000,
        allocations: [
          { ledgerId: 'l1', amount: 900 },
          { ledgerId: 'l2', amount: 1_100 },
        ],
        ledgers,
      })
    ).toMatchObject({
      availableBalance: 3_000,
      allocatedTotal: 2_000,
      endingBalance: 1_000,
      lines: [
        { ledgerId: 'l1', newPaidTotal: 1_000, newStatus: 'paid' },
        { ledgerId: 'l2', newPaidTotal: 1_100, newStatus: 'partial' },
      ],
    });
  });

  it('rejects duplicate ledgers', () => {
    expect(() =>
      planWalletAllocations({
        studentId: 's1',
        walletBalance: 100,
        depositAmount: 0,
        allocations: [
          { ledgerId: 'l1', amount: 50 },
          { ledgerId: 'l1', amount: 50 },
        ],
        ledgers,
      })
    ).toThrow(/duplicate ledger/i);
  });

  it('rejects a ledger belonging to another student', () => {
    expect(() =>
      planWalletAllocations({
        studentId: 's2',
        walletBalance: 1_000,
        depositAmount: 0,
        allocations: [{ ledgerId: 'l1', amount: 50 }],
        ledgers,
      })
    ).toThrow(/does not belong/i);
  });

  it('rejects an allocation above the remaining debt', () => {
    expect(() =>
      planWalletAllocations({
        studentId: 's1',
        walletBalance: 1_000,
        depositAmount: 0,
        allocations: [{ ledgerId: 'l1', amount: 901 }],
        ledgers,
      })
    ).toThrow(/remaining debt/i);
  });

  it('rejects allocations above the available wallet balance', () => {
    expect(() =>
      planWalletAllocations({
        studentId: 's1',
        walletBalance: 50,
        depositAmount: 0,
        allocations: [{ ledgerId: 'l1', amount: 100 }],
        ledgers,
      })
    ).toThrow(/available wallet/i);
  });
});

describe('void and refund planning', () => {
  it('restores allocations before removing the receipt deposit', () => {
    expect(
      planManualReceiptVoid({
        walletBalance: 200,
        receiptAmount: 500,
        allocations: [
          {
            ledgerId: 'l1',
            amount: 400,
            ledgerPaidTotal: 700,
            ledgerAmount: 1_000,
            ledgerDiscountTotal: 0,
          },
        ],
      })
    ).toMatchObject({
      endingBalance: 100,
      ledgerUpdates: [{ ledgerId: 'l1', newPaidTotal: 300, newStatus: 'partial' }],
    });
  });

  it('blocks a receipt void that would make the wallet negative', () => {
    expect(() =>
      planManualReceiptVoid({
        walletBalance: 0,
        receiptAmount: 500,
        allocations: [],
      })
    ).toThrow(/dependent wallet transactions/i);
  });

  it('blocks reversing an allocation that is no longer present in the ledger paid total', () => {
    expect(() =>
      planManualReceiptVoid({
        walletBalance: 500,
        receiptAmount: 500,
        allocations: [
          {
            ledgerId: 'l1',
            amount: 400,
            ledgerPaidTotal: 399,
            ledgerAmount: 1_000,
            ledgerDiscountTotal: 0,
          },
        ],
      })
    ).toThrow(/dependent ledger/i);
  });

  it('blocks a refund above the wallet balance', () => {
    expect(() => planWalletRefund(100, 101)).toThrow(/wallet balance/i);
  });

  it('voids a standalone allocation group by restoring wallet and every ledger', () => {
    expect(
      planStandaloneAllocationVoid({
        walletBalance: 200,
        allocations: [
          {
            ledgerId: 'l1',
            amount: 400,
            ledgerPaidTotal: 700,
            ledgerAmount: 1_000,
            ledgerDiscountTotal: 0,
          },
        ],
      })
    ).toEqual({
      endingBalance: 600,
      ledgerUpdates: [{ ledgerId: 'l1', newPaidTotal: 300, newStatus: 'partial' }],
    });
  });
});
