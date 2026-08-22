import type { DocumentStore } from '@/server/db/documentStore.js';
import { FieldValue } from '@/server/db/documentStore.js';
import { sendNeedsReviewNotification } from './tuitionPayments.js';

export type PaymentReviewCategory =
  | 'orphan_payment'
  | 'amount_mismatch'
  | 'payment_link_mismatch'
  | 'overpayment'
  | 'terminal_status_conflict'
  | 'manual_reconciliation';

export interface PaymentReviewCaseInput {
  dedupeKey: string;
  category: PaymentReviewCategory;
  severity: 'critical' | 'warning';
  source: 'payos_webhook' | 'payos_reconcile' | 'manual_action';
  paymentRequestId?: string;
  orderCode?: number;
  amount?: number;
  gatewayReference?: string;
  reason: string;
  rawEventId?: string;
}

export async function openPaymentReviewCase(db: DocumentStore, input: PaymentReviewCaseInput) {
  const ref = db.collection('payment_review_cases').doc(input.dedupeKey);
  await ref.set(
    {
      ...input,
      status: 'open',
      openedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await sendNeedsReviewNotification(db, {
      paymentId: input.paymentRequestId || input.dedupeKey,
      orderCode: input.orderCode || 0,
      amount: input.amount || 0,
      reason: input.reason,
      studentName: '',
      className: '',
    });
  } catch (err) {
    console.error('[payOS] Failed to send payment review notification:', err);
  }
}
