import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../types';
import { parentReceiptsForLedger } from './parentTuitionReceipts';

describe('parentReceiptsForLedger', () => {
  it('normalizes only the amount allocated to the requested ledger', () => {
    expect(
      parentReceiptsForLedger(
        [
          {
            id: 'r1',
            receiptNo: 'PT-260727-001',
            amountReceived: 1_000,
            receivedDate: '2026-07-27',
            status: 'posted',
            allocations: [
              { ledgerId: 'l1', classId: 'c1', amount: 300 },
              { ledgerId: 'l2', classId: 'c2', amount: 200 },
            ],
          },
        ] as Receipt[],
        'l2'
      )
    ).toEqual([
      expect.objectContaining({
        id: 'r1',
        ledgerId: 'l2',
        amountReceived: 200,
      }),
    ]);
  });

  it('keeps legacy one-ledger receipts unchanged apart from normalization', () => {
    const receipt = {
      id: 'legacy',
      ledgerId: 'l1',
      amountReceived: 500,
      status: 'posted',
    } as Receipt;
    expect(parentReceiptsForLedger([receipt], 'l1')).toEqual([
      expect.objectContaining({ id: 'legacy', ledgerId: 'l1', amountReceived: 500 }),
    ]);
  });
});
