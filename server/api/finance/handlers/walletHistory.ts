import { finiteMoney } from '../../../../shared/money.js';
import { walletSignedAmount } from '../../../../shared/wallet.js';
import type { WalletHistoryResponse, WalletTransaction } from '../../../../src/types/finance';

function historyError(errorCode: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode: 409, errorCode });
}

function chronologicalCompare(a: WalletTransaction, b: WalletTransaction): number {
  const byTime = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  if (byTime) return byTime;
  const byGroup = String(a.transactionGroupId || '').localeCompare(
    String(b.transactionGroupId || '')
  );
  if (byGroup) return byGroup;
  const bySequence = finiteMoney(a.groupSequence) - finiteMoney(b.groupSequence);
  if (bySequence) return bySequence;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

export function buildWalletHistory(input: {
  opening: { startedAt: string; balance: number } | null;
  transactions: WalletTransaction[];
  fallbackWalletBalance: number;
}): WalletHistoryResponse {
  let runningBalance = finiteMoney(input.opening?.balance);
  const chronologicalRows = input.transactions
    .filter((transaction) => transaction.schemaVersion === 2)
    .sort(chronologicalCompare)
    .map((transaction) => {
      const signedAmount = transaction.status === 'posted' ? walletSignedAmount(transaction) : 0;
      runningBalance += signedAmount;
      if (runningBalance < 0) {
        throw historyError(
          'wallet_history_negative_balance',
          `Wallet history has a negative running balance at transaction ${transaction.id}`
        );
      }
      return { ...transaction, signedAmount, balanceAfter: runningBalance };
    });

  const fallbackWalletBalance = finiteMoney(input.fallbackWalletBalance);
  if (runningBalance !== fallbackWalletBalance) {
    throw historyError(
      'wallet_history_balance_mismatch',
      `Computed wallet history ${runningBalance} does not match cached wallet balance ${fallbackWalletBalance}`
    );
  }

  return {
    walletBalance: fallbackWalletBalance,
    opening: input.opening,
    transactions: chronologicalRows.reverse(),
  };
}
