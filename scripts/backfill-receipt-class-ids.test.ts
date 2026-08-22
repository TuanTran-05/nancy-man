import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backfillReceiptClassIds,
  buildReceiptClassIdsBackfillPlan,
} from './backfill-receipt-class-ids';

function makeFakeDb(receipts: Array<{ id: string; data: Record<string, unknown> }>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let commitCalls = 0;
  const db = {
    collection(name: string) {
      return {
        async get() {
          return {
            docs:
              name === 'receipts'
                ? receipts.map((receipt) => ({
                    id: receipt.id,
                    data: () => receipt.data,
                  }))
                : [],
          };
        },
        doc(id: string) {
          return { id };
        },
      };
    },
    batch() {
      return {
        update(docRef: { id: string }, data: Record<string, unknown>) {
          updates.push({ id: docRef.id, data });
        },
        async commit() {
          commitCalls += 1;
        },
      };
    },
  };
  return {
    db: db as unknown as import('@/server/db/documentStore.js').DocumentStore,
    stats: () => ({ updates, commitCalls }),
  };
}

describe('buildReceiptClassIdsBackfillPlan', () => {
  afterEach(() => vi.restoreAllMocks());

  it('backfills only a derived classIds field on legacy receipts', () => {
    expect(
      buildReceiptClassIdsBackfillPlan([
        { id: 'legacy', data: { classId: 'c1', amountReceived: 500 } },
        { id: 'v2', data: { classIds: ['c1', 'c2'], allocations: [] } },
        { id: 'unknown', data: { amountReceived: 100 } },
      ])
    ).toEqual({
      scannedCount: 3,
      skippedCount: 2,
      operations: [{ receiptDocId: 'legacy', classIds: ['c1'] }],
    });
  });

  it('writes only classIds and chunks explicit apply operations', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { db, stats } = makeFakeDb([
      { id: 'r1', data: { classId: 'c1', amountReceived: 500, note: 'private' } },
      { id: 'r2', data: { classId: 'c2', amountReceived: 700, status: 'posted' } },
    ]);

    await backfillReceiptClassIds({ db, apply: true, maxBatchWrites: 1 });

    expect(stats().commitCalls).toBe(2);
    expect(stats().updates).toEqual([
      { id: 'r1', data: { classIds: ['c1'] } },
      { id: 'r2', data: { classIds: ['c2'] } },
    ]);
  });
});
