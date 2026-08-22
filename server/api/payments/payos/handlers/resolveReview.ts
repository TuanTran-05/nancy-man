import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { writeCriticalAuditLog, getClientIp } from '../../../lib/logging/auditLog.js';
import { normalizeBody } from '../../../lib/http/helpers.js';
import { getPayOSClient } from '../../../lib/payments/payosClient.js';
import { getDb, verifyAuthContext } from '../../../lib/auth/verifyAuth.js';
import { authUserFromContext, mutationUserInfoFromContext } from '../../../lib/auth/contextUser.js';
import {
  getLatestGatewayTransaction,
  refreshPaymentFromGateway,
  sendPaymentConfirmationIfNeeded,
  type GatewayPayment,
} from './shared.js';

export async function handleResolveReview(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const verified = await verifyAuthContext(req, res, ['admin', 'accounting']);
  if (!verified) return;

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const userInfo = mutationUserInfoFromContext(verified.context);
  const body = normalizeBody(req.body);
  const paymentRequestId = String(body.paymentRequestId || '').trim();
  const decision = String(body.decision || '').trim();
  const reason = String(body.reason || '').trim();

  if (!paymentRequestId || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'Invalid parameters' });
  }

  const paymentRef = db.collection('payment_requests').doc(paymentRequestId);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Payment not found' });
  }
  if (paymentSnap.data()!.status !== 'needs_review') {
    return res.status(400).json({ success: false, error: 'Payment is not in needs_review status' });
  }

  const payment = paymentSnap.data()!;

  if (decision === 'approve') {
    const orderCode = Number(payment.orderCode || 0);
    if (!orderCode) {
      await paymentRef.update({
        status: 'needs_review',
        reviewResolution: 'manual_handling_required',
        reviewReason: reason || 'Cannot verify payment because payOS orderCode is missing',
        resolvedBy: user.uid,
        resolvedByName: userInfo.name,
        updatedAt: new Date().toISOString(),
      });
      return res.json({
        success: true,
        action: 'manual_handling_required',
        needsReview: true,
        reviewReason: 'Missing payOS orderCode requires manual accounting handling',
      });
    }

    let gatewayPayment: GatewayPayment;
    try {
      gatewayPayment = await getPayOSClient().paymentRequests.get(orderCode);
    } catch (err) {
      console.error('[ResolveReview] Failed to verify payment with payOS:', err);
      await paymentRef.update({
        status: 'needs_review',
        reviewResolution: 'gateway_verification_failed',
        reviewReason: reason || 'Failed to verify payment with payOS',
        resolvedBy: user.uid,
        resolvedByName: userInfo.name,
        updatedAt: new Date().toISOString(),
      });
      return res.status(502).json({
        success: false,
        error: 'Failed to verify payment with payOS',
      });
    }

    if (gatewayPayment.status !== 'PAID') {
      await paymentRef.update({
        status: 'needs_review',
        gatewayStatus: gatewayPayment.status,
        gatewaySnapshot: gatewayPayment,
        reviewResolution: 'manual_handling_required',
        reviewReason:
          reason ||
          `payOS status is ${gatewayPayment.status || 'unknown'}, so this payment cannot be posted automatically`,
        resolvedBy: user.uid,
        resolvedByName: userInfo.name,
        updatedAt: new Date().toISOString(),
      });
      return res.json({
        success: true,
        action: 'manual_handling_required',
        needsReview: true,
        reviewReason: 'payOS payment is not PAID',
      });
    }

    const result = await refreshPaymentFromGateway(
      db,
      paymentSnap,
      gatewayPayment,
      'gateway_reconcile',
      { actorId: user.uid, operation: 'payments:resolve-review' }
    );
    if (!result) {
      return res.status(400).json({ success: false, error: 'Payment was not posted' });
    }
    const latestTransaction = getLatestGatewayTransaction(gatewayPayment);
    await paymentRef.set(
      {
        reviewResolution: result.needsReview
          ? 'manual_handling_required'
          : 'approved_by_gateway_verification',
        resolvedBy: user.uid,
        resolvedByName: userInfo.name,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    await writeCriticalAuditLog(db, {
      userId: user.uid,
      userRole: userInfo.role,
      userName: userInfo.name,
      action: 'update',
      collection: 'payment_requests',
      documentId: paymentRequestId,
      metadata: {
        action: 'resolve_review',
        decision: 'approve',
        verification: 'payos_gateway_status',
        reason,
        gatewayAmount: Number(gatewayPayment.amount || 0),
        gatewayReference: String(latestTransaction?.reference || ''),
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    await sendPaymentConfirmationIfNeeded(db, result);

    return res.json({
      success: true,
      action: result.needsReview ? 'manual_handling_required' : 'approved',
      receiptId: result.receiptId,
      needsReview: result.needsReview,
      reviewReason: result.reviewReason,
    });
  } else {
    await paymentRef.update({
      status: 'failed',
      failureReason: reason ? `Manual rejection: ${reason}` : 'Manual rejection',
      reviewResolution: 'rejected',
      resolvedBy: user.uid,
      resolvedByName: userInfo.name,
      updatedAt: new Date().toISOString(),
    });

    await writeCriticalAuditLog(db, {
      userId: user.uid,
      userRole: userInfo.role,
      userName: userInfo.name,
      action: 'update',
      collection: 'payment_requests',
      documentId: paymentRequestId,
      metadata: { action: 'resolve_review', decision: 'reject', reason },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    return res.json({ success: true, action: 'rejected' });
  }
}
