import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { type DocumentStore } from '@/server/db/documentStore.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { getString, normalizeBody, sendApiError, withStatus } from '../../lib/http/helpers.js';
import {
  getFixedAvailabilitySlot,
  getAvailabilityDayKeysForPairs,
  isAvailabilityDayKey,
  isAvailabilityPairKey,
  normalizeAvailabilitySelections,
  validateAvailabilitySlotInput,
  type AvailabilityPairKey,
  type AvailabilitySelection,
} from '../../../../shared/teacherAvailability.js';
import { writeClassAudit } from '../helpers/classHelpers.js';

type AuthUser = { uid: string; email?: string };
type UserInfo = { role: string; name: string };

function isReviewer(role: string) {
  return role === 'admin' || role === 'office';
}

function parseSelections(value: unknown): AvailabilitySelection[] {
  if (!Array.isArray(value)) throw withStatus('Missing selections', 400);
  return value.map((entry) => {
    const dayKey = String((entry as any)?.dayKey || '');
    if (dayKey) {
      if (!isAvailabilityDayKey(dayKey)) throw withStatus('Invalid availability day', 400);
      return { dayKey, slotId: String((entry as any)?.slotId || '').trim() };
    }

    const pairKey = String((entry as any)?.pairKey || '');
    if (!isAvailabilityPairKey(pairKey)) throw withStatus('Invalid availability pair', 400);
    return { pairKey, slotId: String((entry as any)?.slotId || '').trim() };
  });
}

function validateSelectionsAgainstFixedSlots(selections: AvailabilitySelection[]) {
  for (const selection of selections) {
    const slot = getFixedAvailabilitySlot(selection.slotId);
    if (!slot) throw withStatus('Availability slot not found', 404);
    const allowedDayKeys = getAvailabilityDayKeysForPairs(slot.allowedPairs);
    if (!selection.dayKey || !allowedDayKeys.includes(selection.dayKey)) {
      throw withStatus('Availability slot is not allowed for this day', 400);
    }
  }
}

export async function handleSaveAvailability(
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
    return res.status(403).json({ success: false, error: 'Only teachers can save availability' });
  }

  try {
    const body = normalizeBody(req.body);
    const parsed = normalizeAvailabilitySelections(parseSelections((body as any).selections));
    validateSelectionsAgainstFixedSlots(parsed.selections);

    const now = new Date().toISOString();
    const profileRef = db.collection('teacher_availability_profiles').doc(user.uid);
    const profileSnap = await profileRef.get();

    if (!profileSnap.exists) {
      await profileRef.set({
        teacherId: user.uid,
        teacherName: userInfo.name,
        selections: parsed.selections,
        selectionKeys: parsed.selectionKeys,
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: user.uid,
        updatedBy: user.uid,
      });
      await writeClassAudit(req, db, user, userInfo, 'create', user.uid, undefined, {
        action: 'save-teacher-availability',
      });
      await touchRealtimeEvent('teacher-availability');
      return res.status(200).json({ success: true, mode: 'profile' });
    }

    const reason = getString(body, 'reason').trim();
    if (!reason)
      return res.status(400).json({ success: false, error: 'Change reason is required' });

    const pendingSnap = await db
      .collection('teacher_availability_change_requests')
      .where('teacherId', '==', user.uid)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      return res.status(409).json({ success: false, error: 'A pending request already exists' });
    }

    const requestRef = await db.collection('teacher_availability_change_requests').add({
      teacherId: user.uid,
      teacherName: userInfo.name,
      currentSelections: profileSnap.data()?.selections || [],
      requestedSelections: parsed.selections,
      requestedSelectionKeys: parsed.selectionKeys,
      reason,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    await writeClassAudit(req, db, user, userInfo, 'create', requestRef.id, undefined, {
      action: 'request-teacher-availability-change',
    });
    await touchRealtimeEvent('teacher-availability');
    return res.status(201).json({ success: true, mode: 'request', id: requestRef.id });
  } catch (err) {
    console.error('[Classes/save-availability] Error:', err);
    return sendApiError(res, err, 'Failed to save availability');
  }
}

export async function handleReviewAvailabilityChange(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: AuthUser,
  userInfo: UserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!isReviewer(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Only admin or office can review' });
  }

  try {
    const body = normalizeBody(req.body);
    const requestId = getString(body, 'requestId');
    const decision = getString(body, 'decision');
    const reviewNote = getString(body, 'reviewNote');
    if (!requestId) return res.status(400).json({ success: false, error: 'Missing requestId' });
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ success: false, error: 'Invalid decision' });
    }

    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const requestRef = db.collection('teacher_availability_change_requests').doc(requestId);
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) throw withStatus('Request not found', 404);
      const request = requestSnap.data() || {};
      if (request.status !== 'pending') throw withStatus('Request is not pending', 409);

      if (decision === 'approved') {
        const parsed = normalizeAvailabilitySelections(request.requestedSelections || []);
        const profileRef = db
          .collection('teacher_availability_profiles')
          .doc(String(request.teacherId));
        const profileSnap = await tx.get(profileRef);
        const currentVersion = Number(profileSnap.data()?.version || 0);
        tx.set(
          profileRef,
          {
            teacherId: request.teacherId,
            teacherName: request.teacherName,
            selections: parsed.selections,
            selectionKeys: parsed.selectionKeys,
            version: currentVersion + 1,
            updatedAt: now,
            updatedBy: user.uid,
          },
          { merge: true }
        );
      }

      tx.update(requestRef, {
        status: decision,
        reviewedBy: user.uid,
        reviewedByName: userInfo.name,
        reviewedAt: now,
        reviewNote,
        updatedAt: now,
      });
    });

    await writeClassAudit(req, db, user, userInfo, 'update', requestId, undefined, {
      action: 'review-teacher-availability-change',
      decision,
    });
    await touchRealtimeEvent('teacher-availability');
    return res.status(200).json({ success: true, id: requestId, status: decision });
  } catch (err) {
    console.error('[Classes/review-availability-change] Error:', err);
    return sendApiError(res, err, 'Failed to review availability change');
  }
}

export async function handleSaveAvailabilitySlot(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: AuthUser,
  userInfo: UserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!isReviewer(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Only admin or office can manage slots' });
  }

  try {
    const body = normalizeBody(req.body);
    const slotId = getString(body, 'slotId');
    const allowedPairs = Array.isArray((body as any).allowedPairs)
      ? ((body as any).allowedPairs as AvailabilityPairKey[])
      : [];
    const slotInput = {
      label: getString(body, 'label'),
      startTime: getString(body, 'startTime'),
      endTime: getString(body, 'endTime'),
      allowedPairs,
    };
    const validationError = validateAvailabilitySlotInput(slotInput);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const now = new Date().toISOString();
    const ref = slotId
      ? db.collection('teacher_availability_slots').doc(slotId)
      : db.collection('teacher_availability_slots').doc();
    await ref.set(
      {
        ...slotInput,
        active: typeof (body as any).active === 'boolean' ? (body as any).active : true,
        sortOrder: Number((body as any).sortOrder || 0),
        updatedAt: now,
        updatedBy: user.uid,
        ...(slotId ? {} : { createdAt: now, createdBy: user.uid }),
      },
      { merge: true }
    );
    await writeClassAudit(
      req,
      db,
      user,
      userInfo,
      slotId ? 'update' : 'create',
      ref.id,
      undefined,
      {
        action: 'save-teacher-availability-slot',
      }
    );
    await touchRealtimeEvent('teacher-availability');
    return res.status(200).json({ success: true, id: ref.id });
  } catch (err) {
    console.error('[Classes/save-availability-slot] Error:', err);
    return sendApiError(res, err, 'Failed to save availability slot');
  }
}
