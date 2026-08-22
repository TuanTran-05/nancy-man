import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWalletOpeningSnapshotPlan,
  snapshotWalletHistoryOpening,
} from './snapshot-wallet-history-opening';

function makeFakeDb(
  students: Array<{ id: string; data: Record<string, unknown> }>,
  transactions: Array<Record<string, unknown>>
) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let commitCalls = 0;
  const collections: Record<string, Array<{ id?: string; data?: Record<string, unknown> }>> = {
    students,
    wallet_transactions: transactions.map((data, index) => ({ id: `tx${index}`, data })),
  };
  const db = {
    collection(name: string) {
      return {
        async get() {
          return {
            docs: (collections[name] || []).map((doc, index) => ({
              id: doc.id || `${name}-${index}`,
              data: () => doc.data || {},
            })),
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

describe('buildWalletOpeningSnapshotPlan', () => {
  afterEach(() => vi.restoreAllMocks());

  it('snapshots current balance without overwriting an existing opening', () => {
    expect(
      buildWalletOpeningSnapshotPlan(
        [
          { id: 's1', data: { walletBalance: 500 } },
          {
            id: 's2',
            data: {
              walletBalance: 700,
              walletHistoryStartedAt: '2026-07-20T00:00:00.000Z',
              walletOpeningBalance: 600,
            },
          },
        ],
        '2026-07-27T00:00:00.000Z'
      )
    ).toEqual({
      scannedCount: 2,
      skippedCount: 1,
      operations: [
        {
          studentDocId: 's1',
          walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
          walletOpeningBalance: 500,
        },
      ],
    });
  });

  it('refuses apply when a student without an opening already has v2 traffic', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { db, stats } = makeFakeDb(
      [{ id: 's1', data: { walletBalance: 500 } }],
      [{ studentId: 's1', schemaVersion: 2, type: 'deposit', amount: 500 }]
    );

    await expect(
      snapshotWalletHistoryOpening({
        db,
        apply: true,
        startedAt: '2026-07-27T00:00:00.000Z',
      })
    ).rejects.toThrow(/Refusing to create wallet openings after v2 traffic/);
    expect(stats().updates).toHaveLength(0);
    expect(stats().commitCalls).toBe(0);
  });

  it('writes only opening metadata in batches when apply is explicit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { db, stats } = makeFakeDb(
      [
        { id: 's1', data: { walletBalance: 500, name: 'Student One' } },
        { id: 's2', data: { walletBalance: 700, contact: 'private' } },
      ],
      []
    );

    await snapshotWalletHistoryOpening({
      db,
      apply: true,
      startedAt: '2026-07-27T00:00:00.000Z',
      maxBatchWrites: 1,
    });

    expect(stats().commitCalls).toBe(2);
    expect(stats().updates).toEqual([
      {
        id: 's1',
        data: {
          walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
          walletOpeningBalance: 500,
          updatedAt: expect.any(String),
        },
      },
      {
        id: 's2',
        data: {
          walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
          walletOpeningBalance: 700,
          updatedAt: expect.any(String),
        },
      },
    ]);
  });
});
