import { finiteMoney } from './money.js';

export type ReceiptLike = {
  ledgerId?: unknown;
  classId?: unknown;
  amountReceived?: unknown;
  allocations?: unknown;
};

type ReceiptAllocationLike = {
  ledgerId?: unknown;
  classId?: unknown;
  amount?: unknown;
};

function allocationRows(receipt: ReceiptLike): ReceiptAllocationLike[] | null {
  if (!Array.isArray(receipt.allocations)) return null;
  return receipt.allocations.filter(
    (allocation): allocation is ReceiptAllocationLike =>
      Boolean(allocation) && typeof allocation === 'object'
  );
}

export function receiptAmountForLedger(receipt: ReceiptLike, ledgerId: string): number {
  const allocations = allocationRows(receipt);
  if (allocations) {
    return allocations
      .filter((allocation) => String(allocation.ledgerId || '') === ledgerId)
      .reduce((sum, allocation) => sum + finiteMoney(allocation.amount), 0);
  }
  return String(receipt.ledgerId || '') === ledgerId ? finiteMoney(receipt.amountReceived) : 0;
}

export function receiptClassIds(receipt: ReceiptLike): string[] {
  const allocations = allocationRows(receipt);
  if (allocations) {
    return [
      ...new Set(
        allocations
          .map((allocation) => String(allocation.classId || '').trim())
          .filter(Boolean)
      ),
    ];
  }
  const classId = String(receipt.classId || '').trim();
  return classId ? [classId] : [];
}

export function receiptMatchesClass(receipt: ReceiptLike, classId: string): boolean {
  return receiptClassIds(receipt).includes(classId);
}
