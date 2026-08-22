import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { getPayOSClient } from '../../../lib/payments/payosClient.js';
import { getDb, verifyAuthContext } from '../../../lib/auth/verifyAuth.js';
import { authUserFromContext } from '../../../lib/auth/contextUser.js';
import { checkRateLimit } from '../../../lib/auth/rateLimit.js';
import {
  ACTIVE_PAYMENT_STATUSES,
  log,
  refreshPaymentFromGateway,
  sendPaymentConfirmationIfNeeded,
  type PaymentStatus,
} from './shared.js';

export async function handleStatus(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const verified = await verifyAuthContext(req, res, ['parent', 'student', 'admin', 'accounting']);
  if (!verified) return;

  const orderCode = Number(req.query.orderCode || 0);
  const paymentRequestId =
    typeof req.query.paymentRequestId === 'string' ? req.query.paymentRequestId.trim() : '';
  if (!paymentRequestId && (!Number.isFinite(orderCode) || orderCode <= 0)) {
    return res.status(400).json({ success: false, error: 'Invalid payment identifier' });
  }

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const linkedStudentId = String(verified.context.studentId || '');
  const role = String(verified.context.role || '');
  const isStaff = role === 'admin' || role === 'accounting' || role === 'office';

  let doc: AppDocumentStore.DocumentSnapshot | null = null;
  if (paymentRequestId) {
    const snap = await db.collection('payment_requests').doc(paymentRequestId).get();
    if (snap.exists) doc = snap;
  } else {
    const snap = await db
      .collection('payment_requests')
      .where('orderCode', '==', orderCode)
      .limit(1)
      .get();
    if (!snap.empty) doc = snap.docs[0];
  }

  if (!doc?.exists) {
    return res.status(404).json({ success: false, error: 'Payment request not found' });
  }

  let data = doc.data();
  if (!isStaff) {
    const ownsLinkedStudent = String(data.studentId || '') === linkedStudentId;
    const isStudentAccount = role === 'student' || user.uid.startsWith('student:');
    const parentCanRead = ownsLinkedStudent && String(data.parentUid || '') === user.uid;
    const studentCanRead = ownsLinkedStudent && isStudentAccount;
    if (!parentCanRead && !studentCanRead) {
      return res.status(403).json({ success: false, error: 'Not authorized for this payment' });
    }
  }

  const rateLimit = await checkRateLimit(db, `payos_status:${user.uid}:${doc.id}`, 20, 60 * 1000, {
    failClosed: true,
  });
  if (!rateLimit.allowed) {
    return res.status(429).json({ success: false, error: 'Too many payment status checks' });
  }

  const refreshableStatuses = new Set<PaymentStatus>([...ACTIVE_PAYMENT_STATUSES, 'needs_review']);
  if (refreshableStatuses.has(String(data.status || 'pending') as PaymentStatus)) {
    try {
      const targetOrderCode = Number(data.orderCode || orderCode || 0);
      if (!Number.isFinite(targetOrderCode) || targetOrderCode <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid payment order code' });
      }
      const gatewayPayment = await getPayOSClient().paymentRequests.get(targetOrderCode);
      const refreshResult = await refreshPaymentFromGateway(
        db,
        doc,
        gatewayPayment,
        'gateway_status',
        { actorId: user.uid, operation: 'payments:status' }
      );
      await sendPaymentConfirmationIfNeeded(db, refreshResult);
      const refreshedDoc = await doc.ref.get();
      if (refreshedDoc.exists) data = refreshedDoc.data() || data;
    } catch (err) {
      log.error('Failed to refresh payment status from gateway', {
        error: err instanceof Error ? err.message : String(err),
        orderCode: Number(data.orderCode || 0),
      });
    }
  }

  return res.status(200).json({
    success: true,
    status: data.status || 'pending',
    amount: Number(data.amount || 0),
    receiptId: data.receiptId || '',
    ledgerId: data.ledgerId || '',
    paymentRequestId: doc.id,
  });
}
