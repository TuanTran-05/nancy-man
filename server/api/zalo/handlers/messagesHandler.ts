import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldPath, type DocumentStore } from '@/server/db/documentStore.js';
import { normalizeBody, getString, getOptionalString, withStatus } from '../../lib/http/helpers.js';
import {
  assertZaloStudentAccess,
  getNotificationWithReadAccess,
  canReadNotification,
} from '../helpers/zaloSecurityAndAccess.js';
import { maskName, maskPhone } from '../helpers/zaloBaseHelpers.js';
import {
  enrichZaloHistoryData,
  loadZaloHistoryReferences,
} from '../helpers/zaloHistoryReferences.js';
import { commitWriteOperationsInChunks } from '../../lib/documentStore/batchWrites.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';

export async function handleZaloSendCount(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: any
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!['admin', 'teacher', 'accounting', 'office'].includes(userInfo.role)) {
    throw withStatus('Not authorized for Zalo send counts', 403);
  }

  const input = req.method === 'GET' ? req.query : normalizeBody(req.body);
  const studentId = getString(input, 'studentId');
  const classId = getString(input, 'classId');
  const type = getString(input, 'type');
  const context = getString(input, 'context') || getString(input, 'date');
  const max = Math.min(Math.max(Number(input.max || 2), 1), 10);
  if (!studentId || !type || !['absence', 'evaluation'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid Zalo count payload' });
  }

  const access = await assertZaloStudentAccess(db, studentId, classId, userInfo);
  const logTypes = type === 'evaluation' ? ['evaluation', 'evaluation_notice'] : [type];
  let countQuery = db
    .collection('zalo_notifications')
    .where('studentId', '==', studentId)
    .where('type', logTypes.length > 1 ? 'in' : '==', logTypes.length > 1 ? logTypes : type)
    .where('status', '==', 'sent');
  if (type === 'absence') {
    if (!context) return res.status(400).json({ success: false, error: 'Missing date' });
    countQuery = countQuery.where('date', '==', context);
  } else {
    countQuery = countQuery.where('classId', '==', access.classId);
  }
  const snap = await countQuery.limit(max).get();
  return res.status(200).json({
    success: true,
    allowed: snap.size < max,
    currentCount: snap.size,
    max,
  });
}

export async function handleZaloLogSummary(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: any
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'admin' && userInfo.role !== 'accounting') {
    throw withStatus('Not authorized for Zalo logs', 403);
  }
  const [snap, references] = await Promise.all([
    db.collection('zalo_notifications').orderBy('createdAt', 'desc').limit(2000).get(),
    loadZaloHistoryReferences(db),
  ]);
  const logs = snap.docs.map((docSnap) => {
    const data = enrichZaloHistoryData(
      (docSnap.data() || {}) as Record<string, unknown>,
      references
    );
    const canViewFullRecipient = userInfo.role === 'admin';
    return {
      id: docSnap.id,
      type: String(data.type || ''),
      status: String(data.status || ''),
      createdAt: String(data.createdAt || ''),
      date: String(data.date || ''),
      classId: String(data.classId || ''),
      studentId: String(data.studentId || ''),
      studentName: canViewFullRecipient
        ? String(data.studentName || '')
        : maskName(data.studentName),
      ...(canViewFullRecipient
        ? { phone: String(data.phone || '') }
        : { phoneMasked: maskPhone(data.phone) }),
      errorMessage: String(data.errorMessage || ''),
    };
  });
  return res.status(200).json({ success: true, logs });
}

export async function handleSendNotification(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: any
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = normalizeBody(req.body);
  const studentId = getString(body, 'studentId');
  const title = getString(body, 'title');
  const message = getString(body, 'message');
  const type = getString(body, 'type');
  const classId = getString(body, 'classId');
  if (
    !studentId ||
    !title ||
    !message ||
    !['absence', 'missing_assignment', 'general'].includes(type)
  ) {
    return res.status(400).json({ success: false, error: 'Invalid notification payload' });
  }

  const access = await assertZaloStudentAccess(db, studentId, classId, userInfo);
  const notificationData: Record<string, unknown> = {
    studentId,
    title,
    message,
    type,
    isRead: false,
    createdAt: new Date().toISOString(),
    teacherId: String(access.classData.teacherId || userInfo.uid),
    classId: access.classId,
  };

  const templateKey = getOptionalString(body, 'templateKey');
  const contextDate = getOptionalString(body, 'contextDate');
  if (templateKey) notificationData.templateKey = templateKey;
  if (contextDate) notificationData.contextDate = contextDate;

  const ref = await db.collection('notifications').add(notificationData);

  void writeAuditLog(db, {
    userId: userInfo.uid,
    userRole: userInfo.role,
    action: 'create',
    collection: 'notifications',
    documentId: ref.id,
    metadata: { studentId, type, classId },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  return res.status(201).json({ success: true, id: ref.id });
}

export async function handleMarkNotificationRead(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: any
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = normalizeBody(req.body);
  const notificationId = getString(body, 'notificationId');
  if (!notificationId) {
    return res.status(400).json({ success: false, error: 'Missing notificationId' });
  }

  const { ref } = await getNotificationWithReadAccess(db, notificationId, userInfo);
  await ref.update({ isRead: true });
  return res.status(200).json({ success: true });
}

export async function handleMarkAllNotificationsRead(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: any
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = normalizeBody(req.body);
  const notificationIds = Array.isArray(body.notificationIds)
    ? body.notificationIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  if (notificationIds.length === 0) return res.status(200).json({ success: true, updated: 0 });
  if (notificationIds.length > 100) {
    return res.status(400).json({ success: false, error: 'Too many notification IDs (max 100)' });
  }

  const refs = [];
  const chunkSize = 30;
  for (let i = 0; i < notificationIds.length; i += chunkSize) {
    const chunkIds = notificationIds.slice(i, i + chunkSize);
    const chunkSnap = await db
      .collection('notifications')
      .where(FieldPath.documentId(), 'in', chunkIds)
      .get();
    const foundIds = new Set(chunkSnap.docs.map((doc) => doc.id));
    for (const id of chunkIds) {
      if (!foundIds.has(id)) {
        return res.status(404).json({ success: false, error: `Notification ${id} not found` });
      }
    }
    for (const doc of chunkSnap.docs) {
      const data = doc.data() || {};
      if (!canReadNotification(data, userInfo)) {
        return res
          .status(403)
          .json({ success: false, error: 'Not authorized for this notification' });
      }
      refs.push(doc.ref);
    }
  }

  await commitWriteOperationsInChunks(
    db,
    refs.map((ref) => ({ type: 'update', ref, data: { isRead: true } }))
  );
  return res.status(200).json({ success: true, updated: refs.length });
}
