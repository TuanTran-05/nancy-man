import type { ApiRequest } from '@/server/api/lib/http/types.js';
import type { ApiResponse } from '@/server/api/lib/http/types.js';
import { randomUUID, timingSafeEqual } from 'crypto';
import { Timestamp } from '@/server/db/documentStore.js';
import { getPayOSClient } from '../../../lib/payments/payosClient.js';
import { getDb, verifyAuthToken } from '../../../lib/auth/verifyAuth.js';
import { FieldValue } from '../../../lib/payments/tuitionPayments.js';
import {
  PAYMENT_SESSION_TTL_MS,
  refreshPaymentFromGateway,
  sendPaymentConfirmationIfNeeded,
  type PaymentStatus,
} from './shared.js';
import {
  runStudentIdentityMutationTransaction,
  type StudentIdentityMutationContext,
} from '../../../lib/maintenance/studentIdentityMutationTransaction.js';

const RECONCILE_BATCH_SIZE = 25;
const RECONCILE_DEADLINE_MS = 8_000;
const LEGACY_RECONCILE_SCAN_LIMIT = 100;
const RECONCILE_LEASE_MS = 2 * 60_000;
const ACTIVE_RECONCILE_STATUSES: PaymentStatus[] = ['creating_gateway_session', 'pending'];

export async function handleReconcile(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const cronAuthorized = isCronAuthorized(req);
  let mutationActorId = 'job:payos-reconcile';
  if (!cronAuthorized) {
    const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
    if (!user) return;
    mutationActorId = user.uid;
  }
  const mutationContext: StudentIdentityMutationContext = {
    actorId: mutationActorId,
    operation: 'payments:reconcile',
  };

  const db = getDb();
  const now = Date.now();
  const dueAt = Timestamp.now();
  const leaseOwner = randomUUID();
  const results: Array<{ id: string; action: string; orderCode?: number; status?: string }> = [];
  let totalChecked = 0;
  const deadlineMs = Date.now() + RECONCILE_DEADLINE_MS;

  // This reconciler intentionally handles only active PayOS sessions. Review and exception
  // statuses are resolved through the explicit review/admin flows, not the active-session queue.
  const query = db
    .collection('payment_requests')
    .where('status', 'in', ACTIVE_RECONCILE_STATUSES)
    .where('nextReconcileAt', '<=', dueAt)
    .orderBy('nextReconcileAt', 'asc')
    .limit(RECONCILE_BATCH_SIZE + 1);

  const snap = await query.get();
  const fetchedDocs = snap.docs;
  let partial = fetchedDocs.length > RECONCILE_BATCH_SIZE;
  await processCandidateDocs(fetchedDocs.slice(0, RECONCILE_BATCH_SIZE), 'due');

  if (!partial && totalChecked < RECONCILE_BATCH_SIZE && Date.now() < deadlineMs) {
    const remaining = RECONCILE_BATCH_SIZE - totalChecked;
    const legacySnap = await db
      .collection('payment_requests')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'asc')
      .limit(LEGACY_RECONCILE_SCAN_LIMIT)
      .get();
    const legacyDocs = legacySnap.docs.filter((doc) => !doc.data().nextReconcileAt);
    partial = legacyDocs.length > remaining || legacySnap.size >= LEGACY_RECONCILE_SCAN_LIMIT;
    await processCandidateDocs(legacyDocs.slice(0, remaining), 'legacy_missing_schedule');
  }

  if (totalChecked < RECONCILE_BATCH_SIZE && Date.now() < deadlineMs) {
    await processStaleWebhookEvents(RECONCILE_BATCH_SIZE - totalChecked);
  }

  async function processCandidateDocs(
    docs: AppDocumentStore.QueryDocumentSnapshot[],
    source: 'due' | 'legacy_missing_schedule'
  ) {
    for (const doc of docs) {
      if (Date.now() > deadlineMs) {
        break;
      }
      const claimed = await claimPaymentForReconcile(
        db,
        doc.ref,
        {
          dueAt,
          leaseOwner,
          source,
        },
        mutationContext
      );
      if (!claimed) continue;
      const payment = claimed.payment;
      const orderCode = Number(payment.orderCode || 0);
      const paymentLinkId = String(payment.paymentLinkId || '');
      const expiresAtMs = Date.parse(String(payment.expiresAt || ''));
      const createdAtMs = Date.parse(String(payment.createdAt || ''));
      totalChecked++;

      if (
        payment.status === 'creating_gateway_session' &&
        Number.isFinite(createdAtMs) &&
        createdAtMs + PAYMENT_SESSION_TTL_MS < now
      ) {
        await doc.ref.update({
          status: 'create_failed' satisfies PaymentStatus,
          failureReason: 'PayOS gateway session was not created before reconciliation TTL',
          lastReconciledAt: FieldValue.serverTimestamp(),
          reconcileLeaseUntil: null,
          reconcileLeaseOwner: '',
          updatedAt: new Date().toISOString(),
        });
        results.push({ id: doc.id, action: 'create_failed', orderCode });
        continue;
      }

      if (!orderCode && !paymentLinkId) {
        if (payment.status === 'creating_gateway_session') {
          await doc.ref.update({
            ...buildPendingReconcileSchedule(payment),
            reconcileLeaseUntil: null,
            reconcileLeaseOwner: '',
            updatedAt: new Date().toISOString(),
          });
          results.push({ id: doc.id, action: 'initializing_gateway_session' });
          continue;
        }
        await doc.ref.update({
          status: 'needs_review' satisfies PaymentStatus,
          reviewReason: 'Missing payOS payment identifier during reconciliation',
          lastReconciledAt: FieldValue.serverTimestamp(),
          reconcileLeaseUntil: null,
          reconcileLeaseOwner: '',
          updatedAt: new Date().toISOString(),
        });
        results.push({ id: doc.id, action: 'needs_review' });
        continue;
      }

      try {
        const gatewayPayment = orderCode
          ? await getPayOSClient().paymentRequests.get(orderCode)
          : await getPayOSClient().paymentRequests.get(paymentLinkId);
        const gatewayStatus = gatewayPayment.status;
        if (gatewayStatus === 'PAID') {
          const refreshResult = await refreshPaymentFromGateway(
            db,
            doc,
            gatewayPayment,
            'gateway_reconcile',
            mutationContext
          );
          await doc.ref.update({
            lastReconciledAt: FieldValue.serverTimestamp(),
            reconcileLeaseUntil: null,
            reconcileLeaseOwner: '',
          });
          await sendPaymentConfirmationIfNeeded(db, refreshResult);
          results.push({
            id: doc.id,
            action: refreshResult?.needsReview
              ? 'needs_review'
              : refreshResult?.alreadyPaid
                ? 'already_paid'
                : 'posted',
            orderCode,
            status: gatewayStatus,
          });
        } else if (
          gatewayStatus === 'CANCELLED' ||
          gatewayStatus === 'EXPIRED' ||
          (Number.isFinite(expiresAtMs) && expiresAtMs < now && gatewayStatus === 'PENDING')
        ) {
          await doc.ref.update({
            status: gatewayStatus === 'CANCELLED' ? 'cancelled' : 'expired',
            gatewayStatus,
            reconciliationCheckedAt: new Date().toISOString(),
            lastReconciledAt: FieldValue.serverTimestamp(),
            reconcileLeaseUntil: null,
            reconcileLeaseOwner: '',
            gatewaySnapshot: gatewayPayment,
            updatedAt: new Date().toISOString(),
          });
          results.push({
            id: doc.id,
            action: gatewayStatus === 'CANCELLED' ? 'gateway_cancelled' : 'gateway_expired',
            orderCode,
            status: gatewayStatus,
          });
        } else {
          await doc.ref.update({
            gatewayStatus,
            reconciliationCheckedAt: new Date().toISOString(),
            ...buildPendingReconcileSchedule(payment),
            reconcileLeaseUntil: null,
            reconcileLeaseOwner: '',
            gatewaySnapshot: gatewayPayment,
            updatedAt: new Date().toISOString(),
          });
          results.push({
            id: doc.id,
            action: 'gateway_unpaid',
            orderCode,
            status: gatewayStatus,
          });
        }
      } catch (err) {
        console.error(`[Reconcile] Failed to query payOS for order ${orderCode}:`, err);
        await doc.ref.update({
          reconciliationCheckedAt: new Date().toISOString(),
          reconciliationError: 'Failed to query payOS',
          ...buildPendingReconcileSchedule(payment),
          reconcileLeaseUntil: null,
          reconcileLeaseOwner: '',
          updatedAt: new Date().toISOString(),
        });
        results.push({ id: doc.id, action: 'lookup_failed', orderCode });
      }
    }
  }

  async function processStaleWebhookEvents(limit: number) {
    const webhookEvents = db.collection(
      'webhook_events'
    ) as AppDocumentStore.CollectionReference & {
      where?: AppDocumentStore.CollectionReference['where'];
    };
    if (typeof webhookEvents.where !== 'function') return;

    const snap = await webhookEvents
      .where('processingStatus', '==', 'processing')
      .where('leaseUntil', '<=', dueAt)
      .limit(limit + 1)
      .get();
    const staleWebhookDocs = snap.docs || [];
    if (staleWebhookDocs.length > limit) partial = true;

    for (const webhookDoc of staleWebhookDocs.slice(0, limit)) {
      if (Date.now() > deadlineMs) break;
      totalChecked++;
      const event = webhookDoc.data() || {};
      const orderCode = Number(event.orderCode || 0);
      const paymentLinkId = String(event.paymentLinkId || '');
      if (!orderCode && !paymentLinkId) {
        await webhookDoc.ref.update({
          processingStatus: 'failed',
          failedAt: FieldValue.serverTimestamp(),
          failureReason: 'Stale webhook event is missing PayOS identifiers',
          retryable: false,
          updatedAt: new Date().toISOString(),
        });
        results.push({ id: webhookDoc.id, action: 'stale_webhook_missing_identifier' });
        continue;
      }

      try {
        const paymentSnap = orderCode
          ? await db
              .collection('payment_requests')
              .where('orderCode', '==', orderCode)
              .limit(1)
              .get()
          : await db
              .collection('payment_requests')
              .where('paymentLinkId', '==', paymentLinkId)
              .limit(1)
              .get();

        if (paymentSnap.empty) {
          await webhookDoc.ref.update({
            processingStatus: 'orphan',
            processedAt: new Date().toISOString(),
            error: 'Payment request not found during webhook reconciliation',
            retryable: false,
            updatedAt: new Date().toISOString(),
          });
          results.push({ id: webhookDoc.id, action: 'stale_webhook_orphan', orderCode });
          continue;
        }

        const paymentDoc = paymentSnap.docs[0];
        const gatewayPayment = orderCode
          ? await getPayOSClient().paymentRequests.get(orderCode)
          : await getPayOSClient().paymentRequests.get(paymentLinkId);
        const refreshResult = await refreshPaymentFromGateway(
          db,
          paymentDoc,
          gatewayPayment,
          'gateway_reconcile',
          mutationContext
        );
        if (refreshResult) {
          await sendPaymentConfirmationIfNeeded(db, refreshResult);
        }
        const action = refreshResult?.needsReview
          ? 'stale_webhook_needs_review'
          : refreshResult?.alreadyPaid
            ? 'stale_webhook_already_paid'
            : gatewayPayment.status === 'PAID'
              ? 'stale_webhook_posted'
              : 'stale_webhook_gateway_unpaid';
        await webhookDoc.ref.update({
          paymentRequestId: paymentDoc.id,
          processingStatus: refreshResult?.needsReview
            ? 'needs_review'
            : refreshResult?.alreadyPaid
              ? 'already_paid'
              : gatewayPayment.status === 'PAID'
                ? 'posted'
                : 'ignored',
          processedAt: new Date().toISOString(),
          receiptId: refreshResult?.receiptId || '',
          gatewayStatus: gatewayPayment.status,
          retryable: false,
          updatedAt: new Date().toISOString(),
        });
        results.push({ id: webhookDoc.id, action, orderCode, status: gatewayPayment.status });
      } catch (err) {
        console.error(`[Reconcile] Failed to process stale webhook ${webhookDoc.id}:`, err);
        await webhookDoc.ref.update({
          processingStatus: 'failed',
          failedAt: FieldValue.serverTimestamp(),
          failureReason: 'Failed to reconcile stale webhook event',
          retryable: true,
          updatedAt: new Date().toISOString(),
        });
        results.push({ id: webhookDoc.id, action: 'stale_webhook_lookup_failed', orderCode });
      }
    }
  }

  return res.status(200).json({
    success: true,
    checked: totalChecked,
    results,
    partial: partial || Date.now() >= deadlineMs,
  });
}

function buildPendingReconcileSchedule(payment: AppDocumentStore.DocumentData) {
  const attempts = Number(payment.reconcileAttempts || 0) + 1;
  const backoffMinutes = Math.min(60, Math.max(5, attempts * 5));
  return {
    lastReconciledAt: FieldValue.serverTimestamp(),
    nextReconcileAt: Timestamp.fromMillis(Date.now() + backoffMinutes * 60_000),
    reconcileAttempts: FieldValue.increment(1),
  };
}

async function claimPaymentForReconcile(
  db: AppDocumentStore.DocumentStore,
  ref: AppDocumentStore.DocumentReference,
  options: {
    dueAt: Timestamp;
    leaseOwner: string;
    source: 'due' | 'legacy_missing_schedule';
  },
  context: StudentIdentityMutationContext
): Promise<{ payment: AppDocumentStore.DocumentData } | null> {
  const nowMs = Date.now();
  const leaseUntil = Timestamp.fromMillis(nowMs + RECONCILE_LEASE_MS);

  return runStudentIdentityMutationTransaction(db, context, async (tx) => {
    const freshSnap = await tx.get(ref);
    if (!freshSnap.exists) return null;
    const payment = freshSnap.data() || {};
    const status = String(payment.status || '') as PaymentStatus;
    if (!ACTIVE_RECONCILE_STATUSES.includes(status)) return null;

    const activeLeaseUntil = timestampLikeToMillis(payment.reconcileLeaseUntil);
    if (activeLeaseUntil !== null && activeLeaseUntil > nowMs) return null;

    if (options.source === 'legacy_missing_schedule') {
      if (status !== 'pending' || payment.nextReconcileAt) return null;
    } else {
      const nextReconcileAt = timestampLikeToMillis(payment.nextReconcileAt);
      if (nextReconcileAt === null || nextReconcileAt > options.dueAt.toMillis()) return null;
    }

    tx.update(ref, {
      reconcileLeaseUntil: leaseUntil,
      reconcileLeaseOwner: options.leaseOwner,
      updatedAt: new Date().toISOString(),
    });
    return { payment };
  });
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

function isCronAuthorized(req: ApiRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  // VPS cron jobs authenticate with an explicit bearer secret.
  const rawAuthHeader = req.headers.authorization;
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token.length === cronSecret.length) {
      try {
        return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(cronSecret, 'utf8'));
      } catch {
        return false;
      }
    }
  }

  return false;
}
