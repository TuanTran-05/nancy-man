/**
 * Domain module: student finance report calculations.
 * Pure functions — no DocumentStore, no side-effects.
 *
 * Key semantics (pending business confirmation):
 *   amount      = gross tuition fee (before discount)
 *   discountTotal = total discount/waiver amount
 *   paidTotal   = total receipts posted (excluding draft/void)
 */

export type LedgerStatus = 'waived' | 'paid' | 'overdue' | 'partial' | 'unpaid';

export type LedgerDisplayStatus = LedgerStatus | 'due_date_missing';

export type LedgerLike = {
  id?: string;
  amount?: unknown;
  discountTotal?: unknown;
  paidTotal?: unknown;
  dueDate?: string | null; // YYYY-MM-DD
  status?: string;
  classId?: string;
  termLabel?: string;
};

export type LedgerBalance = {
  grossAmount: number;
  discount: number;
  netAmount: number;
  paid: number;
  outstanding: number;
};

export type LedgerDisplayInfo = LedgerBalance & {
  displayStatus: LedgerDisplayStatus;
  isOverdue: boolean;
  hasDueDate: boolean;
};

export type FinanceSummary = {
  grossAmount: number;
  discountTotal: number;
  netAmount: number;
  paidTotal: number;
  outstandingTotal: number;
  unpaidTerms: number;
  overdueTerms: number;
  missingDueDateTerms: number;
};

function safePositiveNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Calculate the balance for a single ledger entry.
 * No side-effects; safe to call with incomplete data.
 *
 * Note: Deducts `discountTotal` from `amount` once. If `amount` is
 * already net (after discount), the caller should zero out `discountTotal`
 * to avoid double-deduction. Confirm with posting logic before locking.
 */
export function calculateLedgerBalance(ledger: LedgerLike): LedgerBalance {
  const grossAmount = safePositiveNumber(ledger.amount);
  const discount = Math.max(safePositiveNumber(ledger.discountTotal), 0);
  const netAmount = Math.max(grossAmount - discount, 0);
  const paid = Math.max(safePositiveNumber(ledger.paidTotal), 0);
  const outstanding = Math.max(netAmount - paid, 0);

  return { grossAmount, discount, netAmount, paid, outstanding };
}

/**
 * Derive the display status for a ledger entry.
 * Does NOT mutate the canonical `status` field on the ledger.
 */
export function deriveLedgerDisplayStatus(
  ledger: LedgerLike,
  todayStr: string,
): LedgerDisplayInfo {
  const balance = calculateLedgerBalance(ledger);
  const { netAmount, outstanding } = balance;

  const hasDueDate = typeof ledger.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ledger.dueDate);
  const isOverdue = hasDueDate && outstanding > 0 && ledger.dueDate! < todayStr;

  let displayStatus: LedgerDisplayStatus;

  if (netAmount === 0) {
    displayStatus = 'waived';
  } else if (outstanding === 0) {
    displayStatus = 'paid';
  } else if (isOverdue) {
    displayStatus = 'overdue';
  } else if (balance.paid > 0) {
    displayStatus = 'partial';
  } else if (!hasDueDate) {
    displayStatus = 'due_date_missing';
  } else {
    displayStatus = 'unpaid';
  }

  return {
    ...balance,
    displayStatus,
    isOverdue,
    hasDueDate,
  };
}

/**
 * Aggregate ledger display infos into a finance summary.
 */
export function calculateStudentFinanceSummary(
  ledgers: LedgerLike[],
  todayStr: string,
): FinanceSummary {
  let grossAmount = 0;
  let discountTotal = 0;
  let netAmount = 0;
  let paidTotal = 0;
  let outstandingTotal = 0;
  let unpaidTerms = 0;
  let overdueTerms = 0;
  let missingDueDateTerms = 0;

  for (const ledger of ledgers) {
    const info = deriveLedgerDisplayStatus(ledger, todayStr);
    grossAmount += info.grossAmount;
    discountTotal += info.discount;
    netAmount += info.netAmount;
    paidTotal += info.paid;
    outstandingTotal += info.outstanding;

    if (info.outstanding > 0) {
      unpaidTerms++;
    }
    if (info.isOverdue) {
      overdueTerms++;
    }
    if (info.outstanding > 0 && !info.hasDueDate) {
      missingDueDateTerms++;
    }
  }

  return {
    grossAmount,
    discountTotal,
    netAmount,
    paidTotal,
    outstandingTotal,
    unpaidTerms,
    overdueTerms,
    missingDueDateTerms,
  };
}

/**
 * Format a human-readable period key for a ledger.
 * Falls back gracefully when fields are missing.
 */
export function formatLedgerPeriodKey(ledger: LedgerLike): string {
  if (typeof ledger.termLabel === 'string' && ledger.termLabel) {
    return ledger.termLabel;
  }
  if (typeof ledger.dueDate === 'string' && ledger.dueDate) {
    return ledger.dueDate;
  }
  if (typeof ledger.id === 'string' && ledger.id) {
    return ledger.id;
  }
  return '—';
}
