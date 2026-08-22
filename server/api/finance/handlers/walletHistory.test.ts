import { describe, expect, it } from 'vitest';
import type { WalletTransaction } from '../../../../src/types/finance';
import { buildWalletHistory } from './walletHistory';

describe('buildWalletHistory', () => {
  it('starts at the opening balance and ignores old schema transactions', () => {
    const response = buildWalletHistory({
      opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 1_000 },
      fallbackWalletBalance: 1_300,
      transactions: [
        {
          id: 'old',
          studentId: 's1',
          type: 'deposit',
          amount: 9_000,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'd1',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 0,
          source: 'manual_receipt',
          studentId: 's1',
          type: 'deposit',
          amount: 500,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'a1',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 1,
          source: 'manual_receipt',
          studentId: 's1',
          type: 'allocation',
          amount: 200,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      ] as WalletTransaction[],
    });
    expect(response.walletBalance).toBe(1_300);
    expect(
      response.transactions.map((row) => [row.id, row.signedAmount, row.balanceAfter])
    ).toEqual([
      ['a1', -200, 1_300],
      ['d1', 500, 1_500],
    ]);
  });

  it('treats a missing opening as zero for a post-rollout student', () => {
    const response = buildWalletHistory({
      opening: null,
      fallbackWalletBalance: 300,
      transactions: [
        {
          id: 'd1',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 0,
          source: 'manual_receipt',
          studentId: 'new-student',
          type: 'deposit',
          amount: 500,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'a1',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 1,
          source: 'manual_receipt',
          studentId: 'new-student',
          type: 'allocation',
          amount: 200,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      ] as WalletTransaction[],
    });
    expect(response.opening).toBeNull();
    expect(response.walletBalance).toBe(300);
  });

  it('keeps void rows visible without applying their signed amount', () => {
    const response = buildWalletHistory({
      opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 500 },
      fallbackWalletBalance: 500,
      transactions: [
        {
          id: 'void-allocation',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 0,
          source: 'manual_allocation',
          studentId: 's1',
          type: 'allocation',
          amount: 200,
          status: 'void',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      ] as WalletTransaction[],
    });
    expect(response.transactions[0]).toMatchObject({
      id: 'void-allocation',
      status: 'void',
      signedAmount: 0,
      balanceAfter: 500,
    });
  });

  it('rejects cached mismatches and negative running balances', () => {
    const transaction = {
      id: 'a1',
      schemaVersion: 2,
      transactionGroupId: 'g1',
      groupSequence: 0,
      source: 'manual_allocation',
      studentId: 's1',
      type: 'allocation',
      amount: 200,
      status: 'posted',
      createdBy: 'u1',
      createdAt: '2026-07-28T00:00:00.000Z',
    } as WalletTransaction;
    expect(() =>
      buildWalletHistory({
        opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 500 },
        fallbackWalletBalance: 400,
        transactions: [transaction],
      })
    ).toThrow(/cached wallet balance/i);
    try {
      buildWalletHistory({
        opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 100 },
        fallbackWalletBalance: -100,
        transactions: [transaction],
      });
      throw new Error('expected a negative history error');
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 409,
        errorCode: 'wallet_history_negative_balance',
      });
    }
  });
});
