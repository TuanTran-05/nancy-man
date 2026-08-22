import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { type DocumentStore } from '@/server/db/documentStore.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { normalizeBody, getString, sendApiError, withStatus } from '../../lib/http/helpers.js';
import { writeClassAudit } from '../helpers/classHelpers.js';

export async function handleCreateSubstituteRequest(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (userInfo.role !== 'teacher') {
    return res
      .status(403)
      .json({ success: false, error: 'Only teachers can create substitute requests' });
  }

  try {
    const body = normalizeBody(req.body);
    const classId = getString(body, 'classId');
    const date = getString(body, 'date');
    const reason = getString(body, 'reason');
    if (!classId || !date)
      return res.status(400).json({ success: false, error: 'Missing classId or date' });

    const classSnap = await db.collection('classes').doc(classId).get();
    if (!classSnap.exists)
      return res.status(404).json({ success: false, error: 'Class not found' });
    if (String(classSnap.data()?.teacherId || '') !== user.uid) {
      return res.status(403).json({ success: false, error: 'Not authorized for this class' });
    }

    const ref = await db.collection('substitute_requests').add({
      requestingTeacherId: user.uid,
      requestingTeacherName: userInfo.name,
      classId,
      className: classSnap.data()?.name || '',
      date,
      reason: reason || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    await writeClassAudit(req, db, user, userInfo, 'create', ref.id, undefined, {
      action: 'create-substitute-request',
      classId,
      className: classSnap.data()?.name || '',
      date,
    });
    await touchRealtimeEvent('office-schedule-changed');

    return res.status(201).json({ success: true, id: ref.id });
  } catch (err) {
    console.error('[Classes/create-substitute-request] Error:', err);
    return sendApiError(res, err, 'Failed to create request');
  }
}

export async function handleAcceptSubstituteRequest(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  if (userInfo.role !== 'teacher' && userInfo.role !== 'admin') {
    return res
      .status(403)
      .json({ success: false, error: 'Only teachers or admins can accept substitute requests' });
  }

  try {
    const body = normalizeBody(req.body);
    const requestId = getString(body, 'requestId');
    if (!requestId) return res.status(400).json({ success: false, error: 'Missing requestId' });

    const requestRef = db.collection('substitute_requests').doc(requestId);
    await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) throw withStatus('Request not found', 404);

      const requestData = requestSnap.data()!;
      if (requestData.status !== 'pending') throw withStatus('Request is not pending', 409);
      if (requestData.requestingTeacherId === user.uid) {
        throw withStatus('Cannot accept your own request', 403);
      }

      tx.update(requestRef, {
        substituteTeacherId: user.uid,
        substituteTeacherName: userInfo.name,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    await writeClassAudit(req, db, user, userInfo, 'update', requestId, undefined, {
      action: 'accept-substitute-request',
    });
    await touchRealtimeEvent('office-schedule-changed');

    return res.status(200).json({ success: true, id: requestId });
  } catch (err) {
    console.error('[Classes/accept-substitute-request] Error:', err);
    return sendApiError(res, err, 'Failed to accept request');
  }
}

export async function handleCancelSubstituteRequest(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const body = normalizeBody(req.body);
    const requestId = getString(body, 'requestId');
    if (!requestId) return res.status(400).json({ success: false, error: 'Missing requestId' });

    const requestRef = db.collection('substitute_requests').doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists)
      return res.status(404).json({ success: false, error: 'Request not found' });

    const requestData = requestSnap.data()!;
    if (userInfo.role !== 'admin' && requestData.requestingTeacherId !== user.uid) {
      return res
        .status(403)
        .json({ success: false, error: 'Not authorized to cancel this request' });
    }

    // Revert class_sessions if the request was accepted
    if (requestData.status === 'accepted' && requestData.substituteTeacherId) {
      const sessionsSnap = await db
        .collection('class_sessions')
        .where('classId', '==', requestData.classId)
        .where('date', '==', requestData.date)
        .get();
      const batch = db.batch();
      for (const sessionDoc of sessionsSnap.docs) {
        if (sessionDoc.data().teacherId === requestData.substituteTeacherId) {
          batch.update(sessionDoc.ref, {
            teacherId: requestData.requestingTeacherId,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      if (!sessionsSnap.empty) await batch.commit();
    }

    await requestRef.update({ status: 'cancelled', updatedAt: new Date().toISOString() });

    await writeClassAudit(req, db, user, userInfo, 'update', requestId, undefined, {
      action: 'cancel-substitute-request',
      previousStatus: requestData.status,
    });
    await touchRealtimeEvent('office-schedule-changed');

    return res.status(200).json({ success: true, id: requestId });
  } catch (err) {
    console.error('[Classes/cancel-substitute-request] Error:', err);
    return sendApiError(res, err, 'Failed to cancel request');
  }
}
