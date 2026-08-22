import { describe, expect, it } from 'vitest';
import { planWalletDepositVoid } from './walletCore.js';

describe('planWalletDepositVoid', () => {
  const postedDeposit = { type: 'deposit', status: 'posted', amount: 300 };

  it('subtracts the deposit from the balance', () => {
    expect(
      planWalletDepositVoid({
        walletTx: postedDeposit,
        student: { walletBalance: 500 },
        reason: 'nhầm',
      })
    ).toEqual({ newBalance: 200, amount: 300 });
  });

  it('refuses when the wallet no longer holds the money', () => {
    expect(() =>
      planWalletDepositVoid({
        walletTx: postedDeposit,
        student: { walletBalance: 100 },
        reason: 'nhầm',
      })
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it('refuses non-deposit and non-posted transactions', () => {
    expect(() =>
      planWalletDepositVoid({
        walletTx: { ...postedDeposit, type: 'refund' },
        student: { walletBalance: 500 },
        reason: 'x',
      })
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() =>
      planWalletDepositVoid({
        walletTx: { ...postedDeposit, status: 'void' },
        student: { walletBalance: 500 },
        reason: 'x',
      })
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it('requires a reason and an existing transaction', () => {
    expect(() =>
      planWalletDepositVoid({
        walletTx: postedDeposit,
        student: { walletBalance: 500 },
        reason: '  ',
      })
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() =>
      planWalletDepositVoid({ walletTx: undefined, student: { walletBalance: 500 }, reason: 'x' })
    ).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it('rejects a wallet transaction whose student is gone with 404, not a crash', () => {
    expect(() =>
      planWalletDepositVoid({ walletTx: postedDeposit, student: undefined, reason: 'x' })
    ).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });
});
