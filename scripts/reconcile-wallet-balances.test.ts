import { describe, expect, it } from 'vitest';
import { buildWalletReconcilePlan, reconcileWalletBalances } from './reconcile-wallet-balances';

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeDb(students: FakeDoc[], transactions: Record<string, unknown>[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let batchCalls = 0;
  let commitCalls = 0;
  let maxWritesInASingleBatch = 0;

  const collections: Record<string, FakeDoc[] | Record<string, unknown>[]> = {
    students,
    wallet_transactions: transactions,
  };

  const db = {
    collection(name: string) {
      const docs = collections[name] || [];
      return {
        async get() {
          return {
            docs: docs.map((doc: any) => ({
              id: doc.id,
              data: () => doc.data ?? doc,
            })),
          };
        },
        doc(id: string) {
          return { id };
        },
      };
    },
    batch() {
      batchCalls += 1;
      let writesInThisBatch = 0;
      return {
        update(docRef: { id: string }, data: Record<string, unknown>) {
          updates.push({ id: docRef.id, data });
          writesInThisBatch += 1;
          maxWritesInASingleBatch = Math.max(maxWritesInASingleBatch, writesInThisBatch);
        },
        async commit() {
          commitCalls += 1;
        },
      };
    },
  };

  return {
    db: db as unknown as import('@/server/db/documentStore.js').DocumentStore,
    getStats: () => ({ updates, batchCalls, commitCalls, maxWritesInASingleBatch }),
  };
}

describe('reconcileWalletBalances --fix batch chunking', () => {
  it('refuses every fix when a computed v2 balance is negative', async () => {
    const { db, getStats } = makeFakeDb(
      [
        {
          id: 's1',
          data: {
            walletBalance: 0,
            walletOpeningBalance: 100,
            walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
          },
        },
      ],
      [
        {
          studentId: 's1',
          schemaVersion: 2,
          type: 'allocation',
          status: 'posted',
          amount: 600,
        },
      ]
    );

    await expect(reconcileWalletBalances({ db, fix: true })).rejects.toThrow(
      /computed wallet balances are negative/
    );
    expect(getStats().updates).toHaveLength(0);
  });

  it('splits writes across multiple batches when mismatches exceed the batch size limit', async () => {
    const maxBatchWrites = 5;
    const studentCount = 12;
    const students = Array.from({ length: studentCount }, (_, i) => ({
      id: `s${i}`,
      data: { walletBalance: 0 },
    }));
    const transactions = Array.from({ length: studentCount }, (_, i) => ({
      studentId: `s${i}`,
      type: 'deposit',
      status: 'posted',
      amount: 10,
    }));

    const { db, getStats } = makeFakeDb(students, transactions);
    const plan = await reconcileWalletBalances({ db, fix: true, maxBatchWrites });

    expect(plan.mismatchCount).toBe(studentCount);

    const stats = getStats();
    expect(stats.updates).toHaveLength(studentCount);
    expect(stats.maxWritesInASingleBatch).toBeLessThanOrEqual(maxBatchWrites);
    // 12 operations at 5 per batch => 3 batches (5, 5, 2)
    expect(stats.batchCalls).toBe(3);
    expect(stats.commitCalls).toBe(3);
  });

  it('commits a single batch when mismatches fit within one batch', async () => {
    const students = [
      { id: 's1', data: { walletBalance: 0 } },
      { id: 's2', data: { walletBalance: 0 } },
    ];
    const transactions = [
      { studentId: 's1', type: 'deposit', status: 'posted', amount: 10 },
      { studentId: 's2', type: 'deposit', status: 'posted', amount: 20 },
    ];

    const { db, getStats } = makeFakeDb(students, transactions);
    await reconcileWalletBalances({ db, fix: true });

    const stats = getStats();
    expect(stats.batchCalls).toBe(1);
    expect(stats.commitCalls).toBe(1);
    expect(stats.updates).toHaveLength(2);
  });
});

describe('buildWalletReconcilePlan', () => {
  it('reconciles opening balance plus posted v2 movements to the cached balance', () => {
    const plan = buildWalletReconcilePlan(
      [
        {
          id: 's1',
          data: {
            walletBalance: 1_300,
            walletOpeningBalance: 1_000,
            walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
          },
        },
      ],
      [
        {
          studentId: 's1',
          schemaVersion: 2,
          type: 'deposit',
          status: 'posted',
          amount: 500,
        },
        {
          studentId: 's1',
          schemaVersion: 2,
          type: 'allocation',
          status: 'posted',
          amount: 200,
        },
      ]
    );
    expect(plan.mismatchCount).toBe(0);
    expect(plan.unsafeCount).toBe(0);
  });

  it('uses implicit opening zero for v2-only activity without opening metadata', () => {
    const plan = buildWalletReconcilePlan(
      [{ id: 's1', data: { walletBalance: 300 } }],
      [
        {
          studentId: 's1',
          schemaVersion: 2,
          type: 'deposit',
          status: 'posted',
          amount: 500,
        },
        {
          studentId: 's1',
          schemaVersion: 2,
          type: 'allocation',
          status: 'posted',
          amount: 200,
        },
      ]
    );
    expect(plan.mismatchCount).toBe(0);
    expect(plan.unsafeCount).toBe(0);
  });

  it('reports mixed legacy and v2 rows without an opening snapshot as unsafe', () => {
    const plan = buildWalletReconcilePlan(
      [{ id: 's1', data: { walletBalance: 300 } }],
      [
        { studentId: 's1', type: 'deposit', status: 'posted', amount: 100 },
        {
          studentId: 's1',
          schemaVersion: 2,
          type: 'deposit',
          status: 'posted',
          amount: 200,
        },
      ]
    );
    expect(plan.mismatchCount).toBe(1);
    expect(plan.unsafeCount).toBe(1);
    expect(plan.operations[0]).toMatchObject({
      studentDocId: 's1',
      cachedBalance: 300,
      unsafeReason: 'missing_opening_for_mixed_history',
    });
  });

  it('reports a raw negative v2 result as critical instead of matching cached zero', () => {
    const plan = buildWalletReconcilePlan(
      [
        {
          id: 's1',
          data: {
            walletBalance: 0,
            walletOpeningBalance: 100,
            walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
          },
        },
      ],
      [
        {
          studentId: 's1',
          schemaVersion: 2,
          type: 'allocation',
          status: 'posted',
          amount: 600,
        },
      ]
    );
    expect(plan.mismatchCount).toBe(1);
    expect(plan.unsafeCount).toBe(1);
    expect(plan.operations[0]).toMatchObject({
      cachedBalance: 0,
      computedBalance: -500,
      unsafeReason: 'negative_computed_balance',
    });
  });

  it('flags students whose cached balance drifts from the transaction log', () => {
    const plan = buildWalletReconcilePlan(
      [
        { id: 's1', data: { walletBalance: 100 } },
        { id: 's2', data: { walletBalance: 50 } },
        { id: 's3', data: {} },
      ],
      [
        { studentId: 's1', type: 'deposit', status: 'posted', amount: 100 },
        { studentId: 's2', type: 'deposit', status: 'posted', amount: 80 },
        { studentId: 's2', type: 'refund', status: 'posted', amount: 10 },
      ]
    );
    expect(plan.scannedStudents).toBe(3);
    expect(plan.mismatchCount).toBe(1);
    expect(plan.operations).toEqual([
      { studentDocId: 's2', cachedBalance: 50, computedBalance: 70 },
    ]);
  });

  it('treats a missing cache as 0 and reports drift only when the log disagrees', () => {
    const plan = buildWalletReconcilePlan(
      [{ id: 's3', data: {} }],
      [{ studentId: 's3', type: 'deposit', status: 'proposed', amount: 40 }]
    );
    expect(plan.mismatchCount).toBe(0);
  });
});
