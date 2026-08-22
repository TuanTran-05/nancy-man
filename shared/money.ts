export type LedgerLike = {
  amount?: unknown;
  paidTotal?: unknown;
  discountTotal?: unknown;
};

export function finiteMoney(value: unknown): number {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function ledgerAmount(ledger: LedgerLike): number {
  return finiteMoney(ledger.amount);
}

export function ledgerPaidTotal(ledger: LedgerLike): number {
  return finiteMoney(ledger.paidTotal);
}

export function ledgerDiscountTotal(ledger: LedgerLike): number {
  return finiteMoney(ledger.discountTotal);
}

export function ledgerRemaining(ledger: LedgerLike, additionalDiscount = 0): number {
  return Math.max(
    0,
    ledgerAmount(ledger) -
      ledgerPaidTotal(ledger) -
      ledgerDiscountTotal(ledger) -
      finiteMoney(additionalDiscount)
  );
}

export type LedgerStatusValue = 'unpaid' | 'partial' | 'paid' | 'waived';

/**
 * Single source of truth for ledger status recompute.
 * `requirePositiveEffective` reproduces the void path, which refuses to call a
 * zero-effective-amount ledger "paid" (receipts void behavior).
 */
export function resolveLedgerStatus(input: {
  amount: number;
  paidTotal: number;
  discountTotal: number;
  isFullWaiver?: boolean;
  requirePositiveEffective?: boolean;
}): LedgerStatusValue {
  if (input.isFullWaiver) return 'waived';
  const effectiveAmount = finiteMoney(input.amount) - finiteMoney(input.discountTotal);
  const paidTotal = finiteMoney(input.paidTotal);
  const paidReached = input.requirePositiveEffective
    ? paidTotal >= effectiveAmount && effectiveAmount > 0
    : paidTotal >= effectiveAmount;
  if (paidReached) return 'paid';
  if (paidTotal <= 0 && finiteMoney(input.discountTotal) <= 0) return 'unpaid';
  return 'partial';
}
