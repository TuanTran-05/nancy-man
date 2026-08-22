import type { Receipt } from '../../types';
import { receiptAmountForLedger } from '../../../shared/receiptAllocations';

export function parentReceiptsForLedger(receipts: Receipt[], ledgerId: string): Receipt[] {
  return receipts.flatMap((receipt) => {
    const amountReceived = receiptAmountForLedger(receipt, ledgerId);
    if (amountReceived <= 0) return [];
    return [{ ...receipt, ledgerId, amountReceived }];
  });
}
