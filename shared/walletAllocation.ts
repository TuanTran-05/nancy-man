import { finiteMoney, ledgerRemaining, resolveLedgerStatus } from './money.js';

export type WalletAllocationRequest = { ledgerId: string; amount: number };

export type WalletAllocationLedger = {
  id: string;
  studentId: string;
  classId: string;
  amount: number;
  paidTotal: number;
  discountTotal?: number;
  siblingDiscountTotal?: number;
};

export type PlannedWalletAllocation = {
  ledgerId: string;
  classId: string;
  amount: number;
  newPaidTotal: number;
  newStatus: 'unpaid' | 'partial' | 'paid' | 'waived';
};

type VoidAllocation = {
  ledgerId: string;
  amount: number;
  ledgerPaidTotal: number;
  ledgerAmount: number;
  ledgerDiscountTotal: number;
};

type PlannedVoid = {
  endingBalance: number;
  ledgerUpdates: Array<{
    ledgerId: string;
    newPaidTotal: number;
    newStatus: 'unpaid' | 'partial' | 'paid' | 'waived';
  }>;
};

function domainError(errorCode: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400, errorCode });
}

function requireNonNegativeMoney(value: unknown, errorCode: string, label: string): number {
  const amount = finiteMoney(value);
  if (amount < 0) {
    throw domainError(errorCode, `${label} must not be negative`);
  }
  return amount;
}

export function planWalletAllocations(input: {
  studentId: string;
  walletBalance: number;
  depositAmount: number;
  allocations: WalletAllocationRequest[];
  ledgers: WalletAllocationLedger[];
}): {
  availableBalance: number;
  allocatedTotal: number;
  endingBalance: number;
  lines: PlannedWalletAllocation[];
} {
  const walletBalance = requireNonNegativeMoney(
    input.walletBalance,
    'wallet_invalid_balance',
    'Wallet balance'
  );
  const depositAmount = requireNonNegativeMoney(
    input.depositAmount,
    'wallet_invalid_deposit',
    'Deposit amount'
  );
  if (input.allocations.length > 20) {
    throw domainError(
      'wallet_allocation_limit_exceeded',
      'A wallet request cannot contain more than 20 allocations'
    );
  }

  const availableBalance = walletBalance + depositAmount;
  const ledgersById = new Map(input.ledgers.map((ledger) => [ledger.id, ledger]));
  const selectedLedgerIds = new Set<string>();
  const lines = input.allocations.map((allocation): PlannedWalletAllocation => {
    const ledgerId = String(allocation.ledgerId || '');
    if (selectedLedgerIds.has(ledgerId)) {
      throw domainError('wallet_duplicate_ledger', `Duplicate ledger allocation: ${ledgerId}`);
    }
    selectedLedgerIds.add(ledgerId);

    const ledger = ledgersById.get(ledgerId);
    if (!ledger) {
      throw domainError('wallet_ledger_not_found', `Ledger not found: ${ledgerId}`);
    }
    if (ledger.studentId !== input.studentId) {
      throw domainError(
        'wallet_ledger_wrong_student',
        `Ledger ${ledgerId} does not belong to the selected student`
      );
    }

    const allocationAmount = finiteMoney(allocation.amount);
    if (allocationAmount <= 0) {
      throw domainError(
        'wallet_invalid_allocation_amount',
        'Wallet allocation amount must be positive'
      );
    }
    if (allocationAmount > ledgerRemaining(ledger)) {
      throw domainError(
        'wallet_allocation_exceeds_debt',
        `Allocation exceeds remaining debt for ledger ${ledgerId}`
      );
    }

    const newPaidTotal = finiteMoney(ledger.paidTotal) + allocationAmount;
    return {
      ledgerId,
      classId: String(ledger.classId || ''),
      amount: allocationAmount,
      newPaidTotal,
      newStatus: resolveLedgerStatus({
        amount: finiteMoney(ledger.amount),
        paidTotal: newPaidTotal,
        discountTotal: finiteMoney(ledger.discountTotal),
      }),
    };
  });

  const allocatedTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  if (allocatedTotal > availableBalance) {
    throw domainError(
      'wallet_insufficient_balance',
      'Allocations exceed available wallet balance'
    );
  }

  return {
    availableBalance,
    allocatedTotal,
    endingBalance: availableBalance - allocatedTotal,
    lines,
  };
}

export function planManualReceiptVoid(input: {
  walletBalance: number;
  receiptAmount: number;
  allocations: VoidAllocation[];
}): PlannedVoid {
  const ledgerUpdates = input.allocations.map((allocation) => {
    const allocationAmount = requireNonNegativeMoney(
      allocation.amount,
      'wallet_invalid_allocation_amount',
      'Allocation amount'
    );
    const ledgerPaidTotal = requireNonNegativeMoney(
      allocation.ledgerPaidTotal,
      'wallet_invalid_ledger_paid_total',
      'Ledger paid total'
    );
    if (ledgerPaidTotal < allocationAmount) {
      throw domainError(
        'wallet_void_ledger_dependency',
        `Cannot void allocation for ${allocation.ledgerId}: dependent ledger changes exist`
      );
    }

    const newPaidTotal = ledgerPaidTotal - allocationAmount;
    return {
      ledgerId: String(allocation.ledgerId || ''),
      newPaidTotal,
      newStatus: resolveLedgerStatus({
        amount: finiteMoney(allocation.ledgerAmount),
        paidTotal: newPaidTotal,
        discountTotal: finiteMoney(allocation.ledgerDiscountTotal),
      }),
    };
  });

  const restored = input.allocations.reduce(
    (sum, allocation) => sum + finiteMoney(allocation.amount),
    0
  );
  const endingBalance =
    finiteMoney(input.walletBalance) + restored - finiteMoney(input.receiptAmount);
  if (endingBalance < 0) {
    throw domainError(
      'wallet_void_has_dependencies',
      'Void dependent wallet transactions before voiding this receipt'
    );
  }

  return { endingBalance, ledgerUpdates };
}

export function planStandaloneAllocationVoid(input: {
  walletBalance: number;
  allocations: VoidAllocation[];
}): PlannedVoid {
  return planManualReceiptVoid({
    walletBalance: input.walletBalance,
    receiptAmount: 0,
    allocations: input.allocations,
  });
}

export function planWalletRefund(walletBalance: number, amount: number): number {
  const currentBalance = requireNonNegativeMoney(
    walletBalance,
    'wallet_invalid_balance',
    'Wallet balance'
  );
  const refundAmount = finiteMoney(amount);
  if (refundAmount <= 0) {
    throw domainError('wallet_invalid_refund_amount', 'Refund amount must be positive');
  }
  if (refundAmount > currentBalance) {
    throw domainError('wallet_insufficient_balance', 'Refund exceeds wallet balance');
  }
  return currentBalance - refundAmount;
}
