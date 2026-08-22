import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  canTransitionPrintRequestStatus,
  type PrintRequestStatus,
} from '../../../../shared/printRequests.js';
import { getString, normalizeBody, sendApiError, withStatus } from '../../lib/http/helpers.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { writeClassAudit } from '../helpers/classHelpers.js';

type AuthUser = { uid: string; email?: string };
type UserInfo = { role: string; name: string };

function nowIso() {
  return new Date().toISOString();
}

function assertOffice(userInfo: UserInfo) {
  if (userInfo.role !== 'office')
    throw withStatus('Only office can update print request status', 403);
}

export async function handleCancelPrintRequest(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: AuthUser,
  userInfo: UserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'teacher') {
    return res
      .status(403)
      .json({ success: false, error: 'Only teachers can cancel print requests' });
  }

  try {
    const body = normalizeBody(req.body);
    const requestId = getString(body, 'requestId');
    if (!requestId) return res.status(400).json({ success: false, error: 'Missing requestId' });

    const now = nowIso();
    let previousStatus = '';
    const ref = db.collection('print_requests').doc(requestId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw withStatus('Print request not found', 404);
      const data = snap.data() || {};
      previousStatus = String(data.status || '');
      if (String(data.teacherId || '') !== user.uid) {
        throw withStatus('Permission denied', 403);
      }
      if (data.status !== 'pending') {
        throw withStatus('Only pending print requests can be cancelled', 409);
      }
      tx.update(ref, { status: 'cancelled', cancelledAt: now, updatedAt: now });
    });
    await writeClassAudit(req, db, user, userInfo, 'update', requestId, undefined, {
      action: 'cancel-print-request',
      previousStatus,
    });
    await touchRealtimeEvent('print-requests');
    return res.status(200).json({ success: true, id: requestId, status: 'cancelled' });
  } catch (err) {
    console.error('[Classes/cancel-print-request] Error:', err);
    return sendApiError(res, err, 'Failed to cancel print request');
  }
}

export async function handleUpdatePrintRequestStatus(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: AuthUser,
  userInfo: UserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    assertOffice(userInfo);
    const body = normalizeBody(req.body);
    const requestId = getString(body, 'requestId');
    const status = getString(body, 'status') as PrintRequestStatus;
    const rejectionReason = getString(body, 'rejectionReason').trim();
    if (!requestId) return res.status(400).json({ success: false, error: 'Missing requestId' });
    if (status !== 'printed' && status !== 'completed' && status !== 'rejected') {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({ success: false, error: 'Rejection reason is required' });
    }

    const now = nowIso();
    let currentStatus = '' as PrintRequestStatus;
    const ref = db.collection('print_requests').doc(requestId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw withStatus('Print request not found', 404);
      const data = snap.data() || {};
      currentStatus = String(data.status || '') as PrintRequestStatus;
      if (!canTransitionPrintRequestStatus(currentStatus, status)) {
        throw withStatus('Invalid print request status transition', 409);
      }

      const patch: Record<string, unknown> = {
        status,
        updatedAt: now,
        handledBy: user.uid,
        handledByName: userInfo.name,
      };
      if (status === 'printed') patch.printedAt = now;
      if (status === 'completed') patch.completedAt = now;
      if (status === 'rejected') {
        patch.rejectedAt = now;
        patch.rejectionReason = rejectionReason;
      }
      tx.update(ref, patch);
    });
    await writeClassAudit(req, db, user, userInfo, 'update', requestId, undefined, {
      action: 'update-print-request-status',
      previousStatus: currentStatus,
      status,
    });
    await touchRealtimeEvent('print-requests');
    return res.status(200).json({ success: true, id: requestId, status });
  } catch (err) {
    console.error('[Classes/update-print-request-status] Error:', err);
    return sendApiError(res, err, 'Failed to update print request');
  }
}
