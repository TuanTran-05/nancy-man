/**
 * Domain module: student wallet money math.
 * Pure functions — no DocumentStore, no side-effects.
 *
 * Amounts on wallet transactions are ALWAYS positive; direction comes from
 * `type`. Only `adjustment` carries an explicit `direction`.
 * Legacy balance counts `posted` transactions only and never goes below 0.
 * Opening-based v2 balance returns raw arithmetic so reconciliation can expose
 * impossible negative state instead of hiding it.
 */
import { finiteMoney } from './money.js';

export type WalletTransactionType =
  | 'deposit'
  | 'allocation'
  | 'credit'
  | 'refund'
  | 'adjustment';

export type WalletTransactionStatus = 'proposed' | 'posted' | 'rejected' | 'void';

export type WalletTransactionLike = {
  type?: unknown;
  status?: unknown;
  amount?: unknown;
  direction?: unknown;
};

const POSITIVE_TYPES = new Set<string>(['deposit', 'credit']);
const NEGATIVE_TYPES = new Set<string>(['allocation', 'refund']);

export function walletSignedAmount(tx: WalletTransactionLike): number {
  const amount = finiteMoney(tx.amount);
  if (amount <= 0) return 0;
  const type = String(tx.type || '');
  if (POSITIVE_TYPES.has(type)) return amount;
  if (NEGATIVE_TYPES.has(type)) return -amount;
  if (type === 'adjustment') return tx.direction === 'out' ? -amount : amount;
  return 0;
}

export function computeWalletBalance(txs: WalletTransactionLike[]): number {
  const total = txs
    .filter((tx) => String(tx.status || '') === 'posted')
    .reduce((sum, tx) => sum + walletSignedAmount(tx), 0);
  return Math.max(0, total);
}

export function computeWalletBalanceFromOpening(
  openingBalance: number,
  transactions: WalletTransactionLike[]
): number {
  return (
    finiteMoney(openingBalance) +
    transactions
      .filter((tx) => String(tx.status || '') === 'posted')
      .reduce((sum, tx) => sum + walletSignedAmount(tx), 0)
  );
}
