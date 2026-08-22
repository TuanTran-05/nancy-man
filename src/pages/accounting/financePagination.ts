import type { FinanceTab } from './financePaymentReview';
import {
  ledgerAmount,
  ledgerDiscountTotal,
  ledgerPaidTotal,
  ledgerRemaining,
} from '../../../shared/money';

export type FinancePagedResource = 'ledgers' | 'receipts' | 'expenses';
export type FinancePageMode = 'reset' | 'append';
export type FinanceLedgerSummary = {
  count: number;
  total: number;
  discount: number;
  paid: number;
  remaining: number;
};

export function financeResourceForTab(tab: FinanceTab): FinancePagedResource | null {
  return tab === 'ledgers' || tab === 'receipts' || tab === 'expenses' ? tab : null;
}

export function mergeFinancePage<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  mode: FinancePageMode
): T[] {
  if (mode === 'reset') return incoming;
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function selectLedgerStats(
  aggregate: FinanceLedgerSummary | null,
  loadedRows: Array<{ id: string; amount?: unknown; discountTotal?: unknown; paidTotal?: unknown }>,
  localSearchApplied: boolean
): FinanceLedgerSummary {
  if (aggregate && !localSearchApplied) return aggregate;
  return loadedRows.reduce<FinanceLedgerSummary>(
    (stats, row) => ({
      count: stats.count + 1,
      total: stats.total + ledgerAmount(row),
      discount: stats.discount + ledgerDiscountTotal(row),
      paid: stats.paid + ledgerPaidTotal(row),
      remaining: stats.remaining + ledgerRemaining(row),
    }),
    { count: 0, total: 0, discount: 0, paid: 0, remaining: 0 }
  );
}
