import { describe, expect, it } from 'vitest';
import { projectReceiptDoc } from './parentDashboardService';

describe('projectReceiptDoc', () => {
  it('projects v2 receipt linkage without reducing it to one ledger', () => {
    expect(
      projectReceiptDoc({
        id: 'r1',
        data: () => ({
          receiptNo: 'PT-260727-001',
          amountReceived: 1_000,
          studentId: 's1',
          flowVersion: 'wallet-manual-v2',
          classIds: ['c1', 'c2'],
          allocations: [
            { ledgerId: 'l1', classId: 'c1', amount: 300 },
            { ledgerId: 'l2', classId: 'c2', amount: 200 },
          ],
        }),
      })
    ).toMatchObject({
      id: 'r1',
      receiptNo: 'PT-260727-001',
      amountReceived: 1_000,
      classIds: ['c1', 'c2'],
      allocations: [
        { ledgerId: 'l1', classId: 'c1', amount: 300 },
        { ledgerId: 'l2', classId: 'c2', amount: 200 },
      ],
    });
    expect(
      projectReceiptDoc({
        id: 'r1',
        data: () => ({ flowVersion: 'wallet-manual-v2', allocations: [] }),
      })
    ).not.toHaveProperty('ledgerId');
  });
});
