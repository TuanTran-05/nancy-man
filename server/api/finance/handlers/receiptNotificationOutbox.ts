import type { DocumentStore } from '@/server/db/documentStore.js';
import { createOutboxJob } from '../../lib/jobs/outbox.js';
import type { StudentIdentityMutationContext } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import { AUTOMATIC_PAYMENT_CONFIRMATIONS_ENABLED } from '../../lib/payments/paymentConfirmationPolicy.js';

export async function enqueueReceiptPaymentConfirmation(
  db: DocumentStore,
  receipt: Record<string, unknown>,
  context: StudentIdentityMutationContext
): Promise<string | null> {
  if (!AUTOMATIC_PAYMENT_CONFIRMATIONS_ENABLED) return null;

  const receiptId = String(receipt.id || receipt.receiptId || '');
  if (!receiptId) {
    throw new Error('Receipt confirmation outbox job requires a receipt id');
  }

  return createOutboxJob(
    db,
    {
      type: 'send_zalo_receipt_confirmation',
      payload: { receipt },
      idempotencyKey: `receipt-confirmation:${receiptId}`,
    },
    context
  );
}
