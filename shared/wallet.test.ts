import { describe, expect, it } from 'vitest';
import {
  computeWalletBalance,
  computeWalletBalanceFromOpening,
  walletSignedAmount,
} from './wallet';

describe('walletSignedAmount', () => {
  it('deposit and credit are positive', () => {
    expect(walletSignedAmount({ type: 'deposit', amount: 100 })).toBe(100);
    expect(walletSignedAmount({ type: 'credit', amount: 50 })).toBe(50);
  });

  it('allocation and refund are negative', () => {
    expect(walletSignedAmount({ type: 'allocation', amount: 40 })).toBe(-40);
    expect(walletSignedAmount({ type: 'refund', amount: 10 })).toBe(-10);
  });

  it('adjustment follows direction', () => {
    expect(walletSignedAmount({ type: 'adjustment', amount: 5, direction: 'in' })).toBe(5);
    expect(walletSignedAmount({ type: 'adjustment', amount: 5, direction: 'out' })).toBe(-5);
  });

  it('invalid amounts and unknown types contribute 0', () => {
    expect(walletSignedAmount({ type: 'deposit', amount: -3 })).toBe(0);
    expect(walletSignedAmount({ type: 'deposit', amount: Number.NaN })).toBe(0);
    expect(walletSignedAmount({ type: 'mystery', amount: 100 })).toBe(0);
  });
});

describe('computeWalletBalance', () => {
  it('sums posted transactions only', () => {
    expect(
      computeWalletBalance([
        { type: 'deposit', status: 'posted', amount: 100 },
        { type: 'allocation', status: 'posted', amount: 30 },
        { type: 'deposit', status: 'proposed', amount: 999 },
        { type: 'deposit', status: 'void', amount: 999 },
      ])
    ).toBe(70);
  });

  it('never returns a negative balance', () => {
    expect(
      computeWalletBalance([
        { type: 'deposit', status: 'posted', amount: 10 },
        { type: 'refund', status: 'posted', amount: 40 },
      ])
    ).toBe(0);
  });

  it('empty input is 0', () => {
    expect(computeWalletBalance([])).toBe(0);
  });
});

describe('computeWalletBalanceFromOpening', () => {
  it('does not clamp an impossible negative opening-based balance', () => {
    expect(
      computeWalletBalanceFromOpening(100, [
        { type: 'allocation', status: 'posted', amount: 500 },
      ])
    ).toBe(-400);
  });
});
