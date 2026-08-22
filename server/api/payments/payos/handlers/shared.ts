import { createHash } from 'crypto';
import { writeRequiredAuditLog } from '../../../lib/logging/auditLog.js';
import { createLogger } from '../../../lib/logging/logger.js';
import { getPayOSClient } from '../../../lib/payments/payosClient.js';
import { formatCoursePeriodForZalo } from '../../../lib/zalo/zaloFormat.js';
import {
  FieldValue,
  formatDateForZalo,
  getRemainingTuition,
  sendNeedsReviewNotification,
  sendServerPaymentConfirmation,
  type ServerPaymentConfirmPayload,
} from '../../../lib/payments/tuitionPayments.js';
import { AUTOMATIC_PAYMENT_CONFIRMATIONS_ENABLED } from '../../../lib/payments/paymentConfirmationPolicy.js';
import {
  compactDateKey,
  reserveNextCounterSequence,
} from '../../../lib/documentStore/counterSequence.js';
import { finiteMoney } from '../../../../../shared/money.js';
import { touchRealtimeEvent } from '../../../lib/realtime/events.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../../lib/services/accountingStudentSummaryService.js';
import {
  runStudentIdentityMutationTransaction,
  type StudentIdentityMutationContext,
} from '../../../lib/maintenance/studentIdentityMutationTransaction.js';

export type PaymentStatus =
  | 'creating_gateway_session'
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'expired'
  | 'stale'
  | 'failed'
  | 'create_failed'
  | 'needs_review'
  | 'manually_voided';

export const ACTIVE_PAYMENT_STATUSES = new Set<PaymentStatus>([
  'creating_gateway_session',
  'pending',
]);
export const TERMINAL_PAYMENT_STATUSES = new Set<PaymentStatus>([
  'paid',
  'cancelled',
  'expired',
  'stale',
  'failed',
  'create_failed',
  'needs_review',
  'manually_voided',
]);
const REVIEW_ON_GATEWAY_PAID_STATUSES = new Set<PaymentStatus>([
  'cancelled',
  'expired',
  'stale',
  'failed',
  'create_failed',
  'manually_voided',
]);
export const PAYMENT_SESSION_TTL_MS = 30 * 60 * 1000;
export const WEBHOOK_MAX_PAYLOAD_BYTES = 64 * 1024;
export const INVALID_WEBHOOK_LIMIT = 20;
export const INVALID_WEBHOOK_WINDOW_MS = 60 * 1000;
export const PAYMENT_CREATE_FAILED_REASON = 'Payment session could not be created';
export const TERMINAL_WEBHOOK_STATUSES = new Set([
  'processed',
  'duplicate',
  'posted',
  'already_paid',
  'ignored',
  'orphan',
  'needs_review',
  'invalid_signature',
  'failed',
]);
export type GatewayPayment = Awaited<
  ReturnType<ReturnType<typeof getPayOSClient>['paymentRequests']['get']>
>;
export type PaymentConfirmation = {
  source: 'webhook' | 'gateway_status' | 'gateway_reconcile';
  orderCode: number;
  amount: number;
  paymentLinkId: string;
  reference: string;
  transactionDateTime: string;
  rawPayload?: Record<string, unknown>;
  gatewaySnapshot?: GatewayPayment;
};
export type PaymentPostingResult = {
  alreadyPaid: boolean;
  receiptId: string;
  needsReview: boolean;
  reviewReason: string;
  zaloPayload: ServerPaymentConfirmPayload | null;
};
export type WebhookEventClaim = {
  ref: AppDocumentStore.DocumentReference;
  eventHash: string;
  alreadyExists: boolean;
  existingStatus: string;
  claimed: boolean;
  duplicateReason?: 'terminal_duplicate' | 'active_lease' | 'max_attempts';
  attempt?: number;
};

export const log = createLogger('payOS');

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function payloadByteLength(body: unknown): number {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return 0;
  }
}

export async function sendPaymentConfirmationIfNeeded(
  db: AppDocumentStore.DocumentStore,
  result: PaymentPostingResult | null
) {
  if (!AUTOMATIC_PAYMENT_CONFIRMATIONS_ENABLED) return;
  if (!result?.zaloPayload) return;

  try {
    await sendServerPaymentConfirmation(db, result.zaloPayload);
  } catch (err) {
    log.warn('Zalo payment confirmation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function refreshPaymentFromGateway(
  db: AppDocumentStore.DocumentStore,
  paymentDoc: AppDocumentStore.DocumentSnapshot,
  gatewayPayment: GatewayPayment,
  source: 'gateway_status' | 'gateway_reconcile',
  context: StudentIdentityMutationContext
): Promise<PaymentPostingResult | null> {
  const gatewayStatus = gatewayPayment.status;
  if (gatewayStatus !== 'PAID') {
    const now = new Date().toISOString();
    await paymentDoc.ref.update({
      ...(gatewayStatus === 'CANCELLED'
        ? { status: 'cancelled' satisfies PaymentStatus }
        : gatewayStatus === 'EXPIRED'
          ? { status: 'expired' satisfies PaymentStatus }
          : {}),
      gatewayStatus,
      reconciliationCheckedAt: now,
      gatewaySnapshot: gatewayPayment,
      updatedAt: now,
    });
    return null;
  }

  const latestTransaction = getLatestGatewayTransaction(gatewayPayment);
  const result = await postConfirmedPayment(
    db,
    paymentDoc,
    {
      source,
      orderCode: Number(gatewayPayment.orderCode || 0),
      amount: Number(gatewayPayment.amount || 0),
      paymentLinkId: String(gatewayPayment.id || ''),
      reference: String(latestTransaction?.reference || ''),
      transactionDateTime: String(latestTransaction?.transactionDateTime || ''),
      gatewaySnapshot: gatewayPayment,
    },
    context
  );

  await writeRequiredAuditLog(
    db,
    {
      userId: 'payos',
      userRole: 'system',
      userName: 'payOS',
      action: 'update',
      collection: 'payment_requests',
      documentId: paymentDoc.id,
      metadata: {
        provider: 'payos',
        orderCode: gatewayPayment.orderCode,
        source,
        receiptId: result.receiptId,
        alreadyPaid: result.alreadyPaid,
        needsReview: result.needsReview,
        reason: result.reviewReason,
      },
    },
    'payment'
  );

  if (result.needsReview) {
    const pd = paymentDoc.data();
    void sendNeedsReviewNotification(db, {
      paymentId: paymentDoc.id,
      orderCode: Number(pd.orderCode || 0),
      amount: Number(pd.amount || 0),
      reason: result.reviewReason,
      studentName: String(pd.studentName || ''),
      className: String(pd.className || ''),
    }).catch((err) => {
      log.error('Failed to send payment needs-review notification', {
        paymentId: paymentDoc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return result;
}

export function getLatestGatewayTransaction(gatewayPayment: GatewayPayment) {
  const transactions = [...(gatewayPayment.transactions || [])].sort((a, b) =>
    String(a.transactionDateTime || '').localeCompare(String(b.transactionDateTime || ''))
  );
  return transactions[transactions.length - 1];
}

export async function postConfirmedPayment(
  db: AppDocumentStore.DocumentStore,
  paymentDoc: AppDocumentStore.DocumentSnapshot,
  confirmation: PaymentConfirmation,
  context: StudentIdentityMutationContext
): Promise<PaymentPostingResult> {
  const result = await runStudentIdentityMutationTransaction(db, context, async (tx) => {
    const freshPaymentSnap = await tx.get(paymentDoc.ref);
    if (!freshPaymentSnap.exists) throw new Error('Payment request not found');
    const freshPayment = freshPaymentSnap.data()!;
    const freshStatus = String(freshPayment.status || 'pending') as PaymentStatus;
    if (freshStatus === 'paid') {
      return {
        alreadyPaid: true,
        receiptId: String(freshPayment.receiptId || ''),
        needsReview: false,
        reviewReason: '',
        zaloPayload: null,
      };
    }
    const reviewMetadata =
      confirmation.source === 'webhook'
        ? { rawWebhook: confirmation.rawPayload }
        : { gatewaySnapshot: confirmation.gatewaySnapshot };
    const conflictMetadata = {
      ...(freshPayment.manualReceiptId
        ? { manualReceiptId: String(freshPayment.manualReceiptId) }
        : {}),
      ...(freshPayment.manualReceiptNo
        ? { manualReceiptNo: String(freshPayment.manualReceiptNo) }
        : {}),
      ...(freshPayment.manualReceiptAmount !== undefined
        ? { manualReceiptAmount: finiteMoney(freshPayment.manualReceiptAmount) }
        : {}),
      ...(freshPayment.manualReceiptPostedBy
        ? { manualReceiptPostedBy: String(freshPayment.manualReceiptPostedBy) }
        : {}),
      ...(freshPayment.manualReceiptPostedAt
        ? { manualReceiptPostedAt: String(freshPayment.manualReceiptPostedAt) }
        : {}),
      ...(freshPayment.accountingResolution
        ? { accountingResolution: String(freshPayment.accountingResolution) }
        : {}),
    };
    if (REVIEW_ON_GATEWAY_PAID_STATUSES.has(freshStatus)) {
      const reviewReason = `Gateway confirmed paid for local ${freshStatus} payment`;
      tx.update(paymentDoc.ref, {
        status: 'needs_review' satisfies PaymentStatus,
        previousStatus: freshStatus,
        reviewReason,
        reviewResolution: 'manual_handling_required',
        gatewayAmount: confirmation.amount,
        gatewayReference: confirmation.reference,
        gatewayPaidAt: confirmation.transactionDateTime,
        ...conflictMetadata,
        ...reviewMetadata,
        updatedAt: new Date().toISOString(),
      });
      return {
        alreadyPaid: false,
        receiptId: '',
        needsReview: true,
        reviewReason,
        zaloPayload: null,
      };
    }
    if (TERMINAL_PAYMENT_STATUSES.has(freshStatus) && freshStatus !== 'needs_review') {
      return {
        alreadyPaid: false,
        receiptId: '',
        needsReview: false,
        reviewReason: `Payment already terminal: ${freshStatus}`,
        zaloPayload: null,
      };
    }
    const expectedPaymentAmount = finiteMoney(freshPayment.amount);
    if (expectedPaymentAmount !== confirmation.amount) {
      const mismatchRatio =
        expectedPaymentAmount > 0
          ? Math.abs(confirmation.amount - expectedPaymentAmount) / expectedPaymentAmount
          : 1;
      const reviewReason =
        confirmation.source === 'webhook' ? 'Webhook amount mismatch' : 'Gateway amount mismatch';
      tx.update(paymentDoc.ref, {
        status: 'needs_review' satisfies PaymentStatus,
        reviewReason,
        reviewResolution: 'manual_handling_required',
        mismatchRatio,
        gatewayAmount: confirmation.amount,
        gatewayReference: confirmation.reference,
        ...reviewMetadata,
        updatedAt: new Date().toISOString(),
      });
      return {
        alreadyPaid: false,
        receiptId: '',
        needsReview: true,
        reviewReason,
        zaloPayload: null,
      };
    }
    if (String(freshPayment.paymentLinkId || '') !== confirmation.paymentLinkId) {
      const reviewReason =
        confirmation.source === 'webhook'
          ? 'Webhook paymentLinkId mismatch'
          : 'Gateway paymentLinkId mismatch';
      tx.update(paymentDoc.ref, {
        status: 'needs_review' satisfies PaymentStatus,
        reviewReason,
        gatewayAmount: confirmation.amount,
        gatewayReference: confirmation.reference,
        ...reviewMetadata,
        updatedAt: new Date().toISOString(),
      });
      return {
        alreadyPaid: false,
        receiptId: '',
        needsReview: true,
        reviewReason,
        zaloPayload: null,
      };
    }

    const ledgerRef = db.collection('course_fee_ledgers').doc(String(freshPayment.ledgerId || ''));
    const studentRef = db.collection('students').doc(String(freshPayment.studentId || ''));
    const classRef = db.collection('classes').doc(String(freshPayment.classId || ''));
    const invoiceId = String(freshPayment.invoiceId || '');
    const invoiceRef = invoiceId ? db.collection('invoices').doc(invoiceId) : null;

    const ledgerSnap = await tx.get(ledgerRef);
    const studentSnap = await tx.get(studentRef);
    const classSnap = await tx.get(classRef);
    const invoiceSnap = invoiceRef ? await tx.get(invoiceRef) : null;

    if (!ledgerSnap.exists) throw new Error('Ledger not found');

    const ledger = ledgerSnap.data()!;
    const student = studentSnap.data() || {};
    const cls = classSnap.data() || {};
    const amount = confirmation.amount;
    const currentRemaining = getRemainingTuition(ledger);
    if (amount > currentRemaining) {
      const reviewReason = `${confirmation.source === 'webhook' ? 'Webhook' : 'Gateway'} amount exceeds current remaining balance (${amount} > ${currentRemaining})`;
      tx.update(paymentDoc.ref, {
        status: 'needs_review' satisfies PaymentStatus,
        reviewReason,
        reviewResolution: 'manual_handling_required',
        gatewayAmount: amount,
        gatewayReference: confirmation.reference,
        ...reviewMetadata,
        updatedAt: new Date().toISOString(),
      });
      return {
        alreadyPaid: false,
        receiptId: '',
        needsReview: true,
        reviewReason,
        zaloPayload: null,
      };
    }

    const newPaidTotal = finiteMoney(ledger.paidTotal) + amount;
    const effectiveAmount = finiteMoney(ledger.amount) - finiteMoney(ledger.discountTotal);
    const newLedgerStatus = newPaidTotal >= effectiveAmount ? 'paid' : 'partial';
    const now = new Date();
    const { dateStr, prefix } = getReceiptNumberPrefix(now);
    const receiptSeq = await reserveNextCounterSequence(tx, db, {
      counterId: `receipts_${dateStr}`,
      collectionName: 'receipts',
      numberField: 'receiptNo',
      prefix,
    });
    const receiptNo = `${prefix}${String(receiptSeq).padStart(3, '0')}`;
    const receivedDate = now.toISOString().slice(0, 10);
    const receiptRef = db.collection('receipts').doc();
    const invoiceNo = String(freshPayment.invoiceNo || '');
    const invoiceAmount = Number(
      freshPayment.invoiceAmountSnapshot || freshPayment.amount || amount
    );
    const note = `payOS orderCode=${confirmation.orderCode}; reference=${confirmation.reference}`;
    const currentInvoicePaid = Number(invoiceSnap?.data()?.amountPaid || 0);
    const nextInvoicePaid = currentInvoicePaid + amount;
    const invoicePaid = nextInvoicePaid >= invoiceAmount;

    tx.create(receiptRef, {
      receiptNo,
      type: 'tuition',
      studentId: freshPayment.studentId,
      classId: freshPayment.classId,
      ledgerId: freshPayment.ledgerId,
      ...(invoiceId ? { invoiceId } : {}),
      ...(invoiceNo ? { invoiceNo } : {}),
      amountReceived: amount,
      paymentMethod: 'transfer',
      receivedDate,
      createdBy: 'payos',
      createdByRole: 'system',
      createdByName: 'payOS',
      status: 'posted',
      note,
      payosOrderCode: confirmation.orderCode,
      payosPaymentLinkId: confirmation.paymentLinkId,
      payosReference: confirmation.reference,
      paymentRequestId: paymentDoc.id,
      source: 'payos',
      paymentConfirmationSource: confirmation.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: now.toISOString(),
    });

    tx.update(ledgerRef, {
      paidTotal: newPaidTotal,
      status: newLedgerStatus,
      updatedAt: now.toISOString(),
    });

    tx.update(paymentDoc.ref, {
      status: 'paid',
      paidAt: now.toISOString(),
      receiptId: receiptRef.id,
      payosReference: confirmation.reference,
      transactionDateTime: confirmation.transactionDateTime,
      confirmationSource: confirmation.source,
      ...(confirmation.source === 'webhook'
        ? { rawWebhook: confirmation.rawPayload }
        : { gatewaySnapshot: confirmation.gatewaySnapshot }),
      updatedAt: now.toISOString(),
    });

    if (invoiceRef) {
      tx.update(invoiceRef, {
        amountPaid: nextInvoicePaid,
        status: invoicePaid ? 'paid' : 'partially_paid',
        receiptId: receiptRef.id,
        ...(invoicePaid ? { paidAt: now.toISOString() } : {}),
        updatedAt: now.toISOString(),
      });
    }

    const coursePeriod = formatCoursePeriodForZalo(cls, { fallbackToName: true });

    return {
      alreadyPaid: false,
      receiptId: receiptRef.id,
      needsReview: false,
      reviewReason: '',
      zaloPayload: {
        phone: String(student.contact || ''),
        studentName: String(student.name || ''),
        studentCode: String(student.code || student.studentId || ''),
        coursePeriod,
        amount,
        receiptNo,
        paymentDate: formatDateForZalo(receivedDate),
        studentId: String(freshPayment.studentId || ''),
        classId: String(freshPayment.classId || ''),
        className: String(cls.name || ''),
        receivedDate,
      } satisfies ServerPaymentConfirmPayload,
    };
  });

  if (!result.alreadyPaid && result.receiptId) {
    const pd = paymentDoc.data() || {};
    const studentId = String(pd.studentId || '');
    await refreshAccountingStudentSummariesAfterCommit(
      db,
      studentId ? [studentId] : [],
      'payos-payment-settled',
      context
    );

    // Invalidate finance cache keys (await to ensure events are delivered in serverless)
    const eventPromises = [
      touchRealtimeEvent('finance-receipt'),
      touchRealtimeEvent('finance-ledger'),
      touchRealtimeEvent('accounting-student-finance'),
    ];
    if (studentId) {
      eventPromises.push(touchRealtimeEvent('parent-tuition', { targetId: studentId }));
    }
    await Promise.all(eventPromises);
  }

  return result;
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getReceiptNumberPrefix(now: Date): { dateStr: string; prefix: string } {
  const dateStr = compactDateKey(now);
  return { dateStr, prefix: `PT-${dateStr}-` };
}

function normalizeDateLike(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : '';
  if (typeof value !== 'object') return '';

  const dateLike = value as {
    toDate?: () => Date;
    toMillis?: () => number;
    seconds?: number;
    nanoseconds?: number;
    _seconds?: number;
    _nanoseconds?: number;
  };

  if (typeof dateLike.toDate === 'function') {
    const date = dateLike.toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  if (typeof dateLike.toMillis === 'function') {
    const millis = dateLike.toMillis();
    return Number.isFinite(millis) ? new Date(millis).toISOString() : '';
  }

  const seconds = dateLike.seconds ?? dateLike._seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    const nanos = dateLike.nanoseconds ?? dateLike._nanoseconds ?? 0;
    return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
  }

  return '';
}

export function normalizePaymentForApi(id: string, data: AppDocumentStore.DocumentData) {
  return {
    id,
    orderCode: Number(data.orderCode || 0),
    ledgerId: String(data.ledgerId || ''),
    studentId: String(data.studentId || ''),
    classId: String(data.classId || ''),
    parentUid: String(data.parentUid || ''),
    studentName: String(data.studentName || ''),
    className: String(data.className || ''),
    invoiceId: String(data.invoiceId || ''),
    invoiceNo: String(data.invoiceNo || ''),
    invoiceAmountSnapshot: Number(data.invoiceAmountSnapshot || 0),
    invoiceSnapshotVersion: Number(data.invoiceSnapshotVersion || 0),
    amount: Number(data.amount || 0),
    currency: String(data.currency || 'VND'),
    provider: String(data.provider || 'payos'),
    status: String(data.status || 'pending'),
    gatewayStatus: String(data.gatewayStatus || ''),
    paymentLinkId: String(data.paymentLinkId || ''),
    checkoutUrl: String(data.checkoutUrl || ''),
    receiptId: String(data.receiptId || ''),
    reviewReason: String(
      data.reviewReason ||
        (data.status === 'create_failed' ? PAYMENT_CREATE_FAILED_REASON : data.failureReason || '')
    ),
    reviewResolution: String(data.reviewResolution || ''),
    accountingResolution: String(data.accountingResolution || ''),
    gatewayAmount: Number(data.gatewayAmount || 0),
    gatewayReference: String(data.gatewayReference || ''),
    createdAt: normalizeDateLike(data.createdAt),
    updatedAt: normalizeDateLike(data.updatedAt),
    expiresAt: normalizeDateLike(data.expiresAt),
    paidAt: normalizeDateLike(data.paidAt),
    reconciliationCheckedAt: normalizeDateLike(data.reconciliationCheckedAt),
    voidedAt: normalizeDateLike(data.voidedAt),
    voidedBy: String(data.voidedBy || ''),
    voidedByName: String(data.voidedByName || ''),
    voidReason: String(data.voidReason || ''),
  };
}
