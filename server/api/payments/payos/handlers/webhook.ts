import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { Timestamp } from '@/server/db/documentStore.js';
import { writeRequiredAuditLog, getClientIp } from '../../../lib/logging/auditLog.js';
import { normalizeBody } from '../../../lib/http/helpers.js';
import { sanitizeError } from '../../../lib/logging/logSanitizer.js';
import { getPayOSClient } from '../../../lib/payments/payosClient.js';
import { checkRateLimit } from '../../../lib/auth/rateLimit.js';
import { FieldValue, sendNeedsReviewNotification } from '../../../lib/payments/tuitionPayments.js';
import { openPaymentReviewCase } from '../../../lib/payments/paymentReviewQueue.js';
import { getDb } from '../../../lib/auth/verifyAuth.js';
import {
  hashText,
  INVALID_WEBHOOK_LIMIT,
  INVALID_WEBHOOK_WINDOW_MS,
  log,
  payloadByteLength,
  postConfirmedPayment,
  sendPaymentConfirmationIfNeeded,
  TERMINAL_WEBHOOK_STATUSES,
  WEBHOOK_MAX_PAYLOAD_BYTES,
  type WebhookEventClaim,
} from './shared.js';

const WEBHOOK_PROCESSING_LEASE_MS = 2 * 60 * 1000;
const WEBHOOK_MAX_ATTEMPTS = 8;

export async function handleWebhook(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const db = getDb();

  // Rate limit webhook requests per IP
  const webhookRateLimit = await checkRateLimit(
    db,
    `payos:webhook:ip:${hashText(getClientIp(req))}`,
    100,
    60_000,
    { failClosed: true }
  );
  if (!webhookRateLimit.allowed) {
    return res.status(429).json({ success: false, error: 'Too many webhook requests' });
  }
  if (payloadByteLength(req.body) > WEBHOOK_MAX_PAYLOAD_BYTES) {
    const limit = await checkRateLimit(
      db,
      `payos:webhook:oversize:${hashText(getClientIp(req))}`,
      INVALID_WEBHOOK_LIMIT,
      INVALID_WEBHOOK_WINDOW_MS,
      { failClosed: true }
    );
    if (!limit.allowed) {
      return res.status(429).json({ success: false, error: 'Too many invalid webhook payloads' });
    }
    return res.status(413).json({ success: false, error: 'Webhook payload too large' });
  }
  const rawWebhook = normalizeBody(req.body);
  let webhookData: Awaited<ReturnType<ReturnType<typeof getPayOSClient>['webhooks']['verify']>>;
  try {
    webhookData = await getPayOSClient().webhooks.verify(req.body as any);
  } catch (err) {
    log.warn('Invalid webhook signature', {
      error: err instanceof Error ? err.message : String(err),
    });
    const limit = await checkRateLimit(
      db,
      `payos:webhook:invalid:${hashText(getClientIp(req))}`,
      INVALID_WEBHOOK_LIMIT,
      INVALID_WEBHOOK_WINDOW_MS,
      { failClosed: true }
    );
    if (!limit.allowed) {
      return res.status(429).json({ success: false, error: 'Too many invalid webhook payloads' });
    }
    await claimWebhookEvent(db, rawWebhook, false, undefined, 'Invalid webhook signature');
    return res.status(400).json({ success: false, error: 'Invalid webhook signature' });
  }

  const webhookEventClaim = await claimWebhookEvent(db, rawWebhook, true, webhookData);
  if (!webhookEventClaim.claimed) {
    if (webhookEventClaim.duplicateReason === 'active_lease') {
      return res.status(202).json({
        success: true,
        duplicate: true,
        skipped: false,
        inProgress: true,
        processingStatus: webhookEventClaim.existingStatus || 'processing',
      });
    }
    return res.status(200).json({
      success: true,
      duplicate: true,
      skipped: true,
      inProgress: false,
      processingStatus: webhookEventClaim.existingStatus || 'existing',
      needsReview: webhookEventClaim.duplicateReason === 'max_attempts',
    });
  }

  try {
    if (
      rawWebhook.success !== true ||
      rawWebhook.code !== '00' ||
      webhookData.code !== '00' ||
      Number(webhookData.amount || 0) <= 0
    ) {
      await updateWebhookEvent(webhookEventClaim.ref, {
        processingStatus: 'ignored',
        processedAt: new Date().toISOString(),
        processingMessage: 'Non-success webhook payload',
      });
      return res.status(200).json({ success: true, ignored: true });
    }

    const paymentSnap = await db
      .collection('payment_requests')
      .where('orderCode', '==', webhookData.orderCode)
      .limit(1)
      .get();

    if (paymentSnap.empty) {
      await openPaymentReviewCase(db, {
        dedupeKey: `payos_orphan_${webhookData.orderCode || webhookEventClaim.eventHash}`,
        category: 'orphan_payment',
        severity: 'critical',
        source: 'payos_webhook',
        orderCode: Number(webhookData.orderCode || 0),
        amount: Number(webhookData.amount || 0),
        gatewayReference: String(webhookData.reference || ''),
        rawEventId: webhookEventClaim.eventHash,
        reason: 'Valid PayOS webhook did not match any payment request',
      });
      await updateWebhookEvent(webhookEventClaim.ref, {
        processingStatus: 'orphan',
        processedAt: new Date().toISOString(),
        error: 'Payment request not found',
      });
      return res.status(200).json({ success: true, needsReview: true });
    }

    const paymentDoc = paymentSnap.docs[0];
    const result = await postConfirmedPayment(
      db,
      paymentDoc,
      {
        source: 'webhook',
        orderCode: Number(webhookData.orderCode || 0),
        amount: Number(webhookData.amount || 0),
        paymentLinkId: String(webhookData.paymentLinkId || ''),
        reference: String(webhookData.reference || ''),
        transactionDateTime: String(webhookData.transactionDateTime || ''),
        rawPayload: rawWebhook,
      },
      { actorId: 'payos:webhook', operation: 'payments:webhook' }
    );

    if (result.needsReview) {
      await updateWebhookEvent(webhookEventClaim.ref, {
        paymentRequestId: paymentDoc.id,
        processingStatus: 'needs_review',
        processedAt: new Date().toISOString(),
        error: result.reviewReason,
      });
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
            orderCode: webhookData.orderCode,
            reason: result.reviewReason,
          },
          ip: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || ''),
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
          console.error('[PayOSWebhook] Failed to send needs-review notification:', err);
        });
      }
      return res.status(200).json({
        success: true,
        processed: true,
        needsReview: result.needsReview,
        reason: result.reviewReason,
        processingStatus: 'needs_review',
      });
    }

    await sendPaymentConfirmationIfNeeded(db, result);

    const processingStatus = result.alreadyPaid ? 'already_paid' : 'posted';

    await updateWebhookEvent(webhookEventClaim.ref, {
      paymentRequestId: paymentDoc.id,
      processingStatus,
      processedAt: new Date().toISOString(),
      receiptId: result.receiptId,
    });

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
          orderCode: webhookData.orderCode,
          receiptId: result.receiptId,
          alreadyPaid: result.alreadyPaid,
        },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      },
      'payment'
    );

    return res.status(200).json({
      success: true,
      processed: true,
      receiptId: result.receiptId,
      alreadyPaid: result.alreadyPaid,
      processingStatus,
    });
  } catch (err) {
    await markWebhookEventFailed(webhookEventClaim.ref, err);
    throw err;
  }
}

async function claimWebhookEvent(
  db: AppDocumentStore.DocumentStore,
  rawWebhook: Record<string, unknown>,
  signatureValid: boolean,
  webhookData?: {
    orderCode?: number;
    amount?: number;
    paymentLinkId?: string;
    reference?: string;
    transactionDateTime?: string;
    code?: string;
  },
  error?: string
): Promise<WebhookEventClaim> {
  const providerEventKey = buildProviderEventKey(rawWebhook, signatureValid, webhookData);
  const eventHash = hashText(providerEventKey || JSON.stringify(rawWebhook));
  const ref = db.collection('webhook_events').doc(eventHash);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const initialStatus = signatureValid ? 'processing' : 'invalid_signature';
  const eventData = {
    provider: 'payos',
    eventHash,
    providerEventKey,
    signatureValid,
    rawPayload: rawWebhook,
    envelopeCode: typeof rawWebhook.code === 'string' ? rawWebhook.code : '',
    envelopeDesc: typeof rawWebhook.desc === 'string' ? rawWebhook.desc : '',
    envelopeSuccess: rawWebhook.success === true,
    orderCode: webhookData?.orderCode || Number((rawWebhook.data as any)?.orderCode || 0) || null,
    amount: webhookData?.amount || Number((rawWebhook.data as any)?.amount || 0) || null,
    paymentLinkId: webhookData?.paymentLinkId || (rawWebhook.data as any)?.paymentLinkId || '',
    providerReference: webhookData?.reference || (rawWebhook.data as any)?.reference || '',
    transactionDateTime: webhookData?.transactionDateTime || '',
    providerCode: webhookData?.code || (rawWebhook.data as any)?.code || '',
    processingStatus: initialStatus,
    attempts: signatureValid ? 1 : 0,
    processingStartedAt: signatureValid ? Timestamp.fromMillis(nowMs) : null,
    leaseUntil: signatureValid ? Timestamp.fromMillis(nowMs + WEBHOOK_PROCESSING_LEASE_MS) : null,
    error: error || '',
    receivedAt: FieldValue.serverTimestamp(),
    updatedAt: now,
  };

  try {
    await ref.create(eventData);
    return {
      ref,
      eventHash,
      alreadyExists: false,
      existingStatus: initialStatus,
      claimed: signatureValid,
      attempt: signatureValid ? 1 : 0,
    };
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() || {} : {};
    const existingStatus = String(existing.processingStatus || '');
    if (TERMINAL_WEBHOOK_STATUSES.has(existingStatus)) {
      return {
        ref,
        eventHash,
        alreadyExists: true,
        existingStatus,
        claimed: false,
        duplicateReason: 'terminal_duplicate',
        attempt: Number(existing.attempts || 0),
      };
    }

    const attempts = Number(existing.attempts || 0);
    if (attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await ref.set(
        {
          processingStatus: 'failed',
          failedAt: FieldValue.serverTimestamp(),
          retryable: false,
          error: 'Webhook processing attempts exceeded',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      await openPaymentReviewCase(db, {
        dedupeKey: `payos_webhook_max_attempts_${eventHash}`,
        category: 'manual_reconciliation',
        severity: 'critical',
        source: 'payos_webhook',
        orderCode: Number(webhookData?.orderCode || (rawWebhook.data as any)?.orderCode || 0),
        amount: Number(webhookData?.amount || (rawWebhook.data as any)?.amount || 0),
        gatewayReference: String(
          webhookData?.reference || (rawWebhook.data as any)?.reference || ''
        ),
        rawEventId: eventHash,
        reason: 'PayOS webhook processing attempts exceeded',
      });
      return {
        ref,
        eventHash,
        alreadyExists: true,
        existingStatus: 'failed',
        claimed: false,
        duplicateReason: 'max_attempts',
        attempt: attempts,
      };
    }

    const leaseUntilMs = timestampLikeToMillis(existing.leaseUntil);
    if (leaseUntilMs !== null && leaseUntilMs > nowMs) {
      return {
        ref,
        eventHash,
        alreadyExists: true,
        existingStatus: existingStatus || 'processing',
        claimed: false,
        duplicateReason: 'active_lease',
        attempt: attempts,
      };
    }

    await ref.set(
      {
        processingStatus: 'processing',
        processingStartedAt: Timestamp.fromMillis(nowMs),
        leaseUntil: Timestamp.fromMillis(nowMs + WEBHOOK_PROCESSING_LEASE_MS),
        attempts: FieldValue.increment(1),
        retryable: true,
        updatedAt: now,
      },
      { merge: true }
    );
    return {
      ref,
      eventHash,
      alreadyExists: true,
      existingStatus: existingStatus || 'processing',
      claimed: true,
      attempt: attempts + 1,
    };
  }
}

async function markWebhookEventFailed(ref: AppDocumentStore.DocumentReference, err: unknown) {
  const sanitized = sanitizeError(err);
  const failureReason =
    sanitized instanceof Error
      ? sanitized.message
      : String(sanitized || 'Webhook processing failed');
  await updateWebhookEvent(ref, {
    processingStatus: 'failed',
    failedAt: FieldValue.serverTimestamp(),
    failureReason,
    retryable: true,
  });
}

async function updateWebhookEvent(
  ref: AppDocumentStore.DocumentReference,
  data: Record<string, unknown>
) {
  const snap = await ref.get();
  const currentStatus = snap.exists ? String(snap.data()?.processingStatus || '') : '';
  const nextStatus = typeof data.processingStatus === 'string' ? data.processingStatus : '';
  if (
    currentStatus &&
    TERMINAL_WEBHOOK_STATUSES.has(currentStatus) &&
    nextStatus &&
    nextStatus !== currentStatus
  ) {
    return;
  }
  await ref.set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

function buildProviderEventKey(
  rawWebhook: Record<string, unknown>,
  signatureValid: boolean,
  webhookData?: {
    orderCode?: number;
    amount?: number;
    paymentLinkId?: string;
    reference?: string;
    transactionDateTime?: string;
    code?: string;
  }
): string {
  if (!signatureValid || !webhookData?.orderCode) return '';

  const amount = Number(webhookData.amount || 0);
  if (!Number.isFinite(amount)) return '';

  return JSON.stringify({
    provider: 'payos',
    orderCode: Number(webhookData.orderCode),
    amount,
    paymentLinkId: String(webhookData.paymentLinkId || ''),
    reference: String(webhookData.reference || ''),
    transactionDateTime: String(webhookData.transactionDateTime || ''),
    providerCode: String(webhookData.code || (rawWebhook.data as any)?.code || ''),
  });
}

function isAlreadyExistsError(err: unknown): boolean {
  const maybeError = err as { code?: unknown; message?: unknown };
  return (
    maybeError?.code === 6 ||
    maybeError?.code === 'already-exists' ||
    String(maybeError?.message || '').includes('ALREADY_EXISTS') ||
    String(maybeError?.message || '')
      .toLowerCase()
      .includes('already exists')
  );
}

function timestampLikeToMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}
