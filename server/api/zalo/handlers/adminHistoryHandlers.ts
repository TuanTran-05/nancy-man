import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore, QueryDocumentSnapshot } from '@/server/db/documentStore.js';
import { normalizeBody, getString, withStatus } from '../../lib/http/helpers.js';
import { getClientIp, writeAuditLog } from '../../lib/logging/auditLog.js';
import type { ZaloActorInfo } from '../helpers/zaloSecurityAndAccess.js';
import { markAdminResendRequest } from '../helpers/adminResendContext.js';
import {
  enrichZaloHistoryData,
  loadZaloHistoryReferences,
  type ZaloHistoryReferences,
} from '../helpers/zaloHistoryReferences.js';
import {
  handleNotifyAbsence,
  handleNotifyEvaluation,
  handleNotifyPaymentConfirm,
  handleNotifyRankAchievement,
  handleTest,
} from './zaloOaHandlers.js';
import { handleNotifyTuitionNotice, handleNotifyTuitionReminder } from './tuitionHandler.js';
import { handleAdminZaloManualSend } from './adminManualSendHandlers.js';

const RESENDABLE_TYPES = new Set([
  'absence',
  'evaluation',
  'evaluation_notice',
  'rank_achievement',
  'tuition_reminder',
  'tuition_notice',
  'next_course_tuition',
  'payment',
  'test',
]);

const SENSITIVE_TYPES = new Set([
  'staff-credentials',
  'otp',
  'otp_password_reset',
  'otp_profile_phone',
]);

const HISTORY_BATCH_SIZE = 200;
const HISTORY_MAX_SCAN = 2000;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

export function getZaloResendCapability(data: Record<string, unknown>): {
  canResend: boolean;
  reason?: string;
} {
  const type = asString(data.type);
  if (SENSITIVE_TYPES.has(type)) {
    return {
      canResend: false,
      reason: 'Thông báo chứa mã hoặc mật khẩu một lần. Hãy tạo mã mới từ đúng quy trình.',
    };
  }
  if (type === 'manual') {
    const snapshot = data.payloadSnapshot;
    const validSnapshot =
      data.payloadCaptured === true &&
      snapshot &&
      typeof snapshot === 'object' &&
      !Array.isArray(snapshot) &&
      (snapshot as Record<string, unknown>).templateData &&
      typeof (snapshot as Record<string, unknown>).templateData === 'object';
    if (!asString(data.phone) || !asString(data.templateId) || !validSnapshot) {
      return {
        canResend: false,
        reason: 'Bản ghi gửi thủ công không có snapshot đầy đủ để gửi lại an toàn.',
      };
    }
    return { canResend: true };
  }
  if (!RESENDABLE_TYPES.has(type)) {
    return { canResend: false, reason: 'Loại thông báo này chưa hỗ trợ gửi lại.' };
  }
  if (type === 'payment' && !asString(data.receiptNo)) {
    return { canResend: false, reason: 'Bản ghi cũ không có mã biên nhận để dựng lại nội dung.' };
  }
  if (type !== 'test' && !asString(data.studentId)) {
    return { canResend: false, reason: 'Bản ghi cũ không có mã học sinh để dựng lại nội dung.' };
  }
  if (
    [
      'absence',
      'evaluation',
      'evaluation_notice',
      'rank_achievement',
      'tuition_notice',
      'next_course_tuition',
    ].includes(type) &&
    !asString(data.classId)
  ) {
    return { canResend: false, reason: 'Bản ghi cũ không có mã lớp để dựng lại nội dung.' };
  }
  if (type === 'absence' && !asString(data.date)) {
    return { canResend: false, reason: 'Bản ghi cũ không có ngày vắng.' };
  }
  if (type === 'test' && !asString(data.phone)) {
    return { canResend: false, reason: 'Bản ghi cũ không có số điện thoại.' };
  }
  return { canResend: true };
}

export function buildAdminResendBody(data: Record<string, unknown>): Record<string, unknown> {
  const type = asString(data.type);
  if (type === 'manual') {
    const snapshot = data.payloadSnapshot as Record<string, unknown>;
    return {
      templateId: asString(data.templateId),
      phone: asString(data.phone),
      templateData: snapshot.templateData as Record<string, string | number>,
    };
  }
  const studentId = asString(data.studentId);
  const classId = asString(data.classId);
  switch (type) {
    case 'absence':
      return { studentId, classId, date: asString(data.date) };
    case 'evaluation':
    case 'evaluation_notice':
    case 'rank_achievement':
      return { studentId, classId };
    case 'tuition_reminder':
      return { studentId, paymentDueDate: asString(data.date) };
    case 'tuition_notice':
    case 'next_course_tuition':
      return {
        studentId,
        classId,
        ...(asString(data.ledgerId) ? { ledgerId: asString(data.ledgerId) } : {}),
      };
    case 'payment':
      return { receiptNo: asString(data.receiptNo) };
    case 'test':
      return { phone: asString(data.phone) };
    default:
      throw withStatus('This Zalo notification cannot be resent', 409);
  }
}

function matchesHistoryFilters(
  data: Record<string, unknown>,
  filters: { type: string; status: string; search: string; startDate: string; endDate: string }
) {
  const createdAt = asString(data.createdAt);
  if (filters.type && asString(data.type) !== filters.type) return false;
  if (filters.status && asString(data.status) !== filters.status) return false;
  if (filters.startDate && createdAt < `${filters.startDate}T00:00:00`) return false;
  if (filters.endDate && createdAt > `${filters.endDate}T23:59:59.999`) return false;
  if (!filters.search) return true;
  const haystack = [
    data.studentName,
    data.studentId,
    data.studentCode,
    data.className,
    data.classId,
    data.phone,
    data.email,
    data.receiptNo,
    data.zaloMessageId,
    data.errorMessage,
  ]
    .map(asString)
    .join(' ')
    .toLocaleLowerCase('vi');
  return haystack.includes(filters.search.toLocaleLowerCase('vi'));
}

function projectHistoryDoc(doc: QueryDocumentSnapshot, references: ZaloHistoryReferences) {
  const data = enrichZaloHistoryData(
    (doc.data() || {}) as Record<string, unknown>,
    references
  );
  const capability = getZaloResendCapability(data);
  return {
    id: doc.id,
    type: asString(data.type),
    status: asString(data.status),
    createdAt: asString(data.createdAt),
    date: asString(data.date),
    studentId: asString(data.studentId),
    studentCode: asString(data.studentCode),
    studentName: asString(data.studentName),
    classId: asString(data.classId),
    className: asString(data.className),
    phone: asString(data.phone),
    email: asString(data.email),
    templateId: asString(data.templateId),
    templateName: asString(data.templateName),
    templateTag: asString(data.templateTag),
    templatePreviewUrl: asString(data.templatePreviewUrl),
    trackingId: asString(data.trackingId),
    providerErrorCode:
      typeof data.providerErrorCode === 'number'
        ? data.providerErrorCode
        : asString(data.providerErrorCode),
    payloadCaptured: data.payloadCaptured === true,
    payloadSnapshot:
      data.payloadSnapshot && typeof data.payloadSnapshot === 'object'
        ? data.payloadSnapshot
        : undefined,
    sentBy: asString(data.sentBy),
    sentByName: asString(data.sentByName),
    zaloMessageId: asString(data.zaloMessageId),
    errorMessage: asString(data.errorMessage),
    courseId: asString(data.courseId),
    evaluationId: asString(data.evaluationId),
    receiptNo: asString(data.receiptNo),
    ledgerId: asString(data.ledgerId),
    ledgerIds: asStringArray(data.ledgerIds),
    amount: typeof data.amount === 'number' ? data.amount : undefined,
    semester: asString(data.semester),
    source: asString(data.source),
    isResend: data.isResend === true,
    resendOf: asString(data.resendOf),
    resendReason: asString(data.resendReason),
    resentBy: asString(data.resentBy),
    resentByName: asString(data.resentByName),
    ...capability,
  };
}

export async function handleZaloHistory(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: ZaloActorInfo
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (userInfo.role !== 'admin') throw withStatus('Admin access is required', 403);

  const limit = Math.min(Math.max(Number(req.query.limit || 50), 10), 100);
  const cursor = asString(req.query.cursor);
  const filters = {
    type: asString(req.query.type),
    status: asString(req.query.status),
    search: asString(req.query.search).trim(),
    startDate: asString(req.query.startDate),
    endDate: asString(req.query.endDate),
  };
  const references = await loadZaloHistoryReferences(db);

  const collection = db.collection('zalo_notifications');
  let query = collection.orderBy('createdAt', 'desc');
  if (cursor) {
    const cursorDoc = await collection.doc(cursor).get();
    if (!cursorDoc.exists)
      return res.status(400).json({ success: false, error: 'Invalid history cursor' });
    query = query.startAfter(cursorDoc);
  }

  const matched: QueryDocumentSnapshot[] = [];
  let lastScanned: QueryDocumentSnapshot | undefined;
  let scanned = 0;
  let exhausted = false;

  while (matched.length <= limit && scanned < HISTORY_MAX_SCAN) {
    const snap = await query.limit(Math.min(HISTORY_BATCH_SIZE, HISTORY_MAX_SCAN - scanned)).get();
    if (snap.empty) {
      exhausted = true;
      break;
    }
    for (const doc of snap.docs) {
      scanned += 1;
      lastScanned = doc;
      const data = enrichZaloHistoryData(
        (doc.data() || {}) as Record<string, unknown>,
        references
      );
      if (matchesHistoryFilters(data, filters))
        matched.push(doc);
      if (matched.length > limit || scanned >= HISTORY_MAX_SCAN) break;
    }
    if (matched.length > limit || scanned >= HISTORY_MAX_SCAN) break;
    if (snap.size < HISTORY_BATCH_SIZE) {
      exhausted = true;
      break;
    }
    query = collection.orderBy('createdAt', 'desc').startAfter(lastScanned);
  }

  const hasExtraMatch = matched.length > limit;
  const pageDocs = matched.slice(0, limit);
  const hasMore = hasExtraMatch || !exhausted;
  const nextCursor = hasMore ? pageDocs.at(-1)?.id || lastScanned?.id || null : null;

  return res.status(200).json({
    success: true,
    logs: pageDocs.map((doc) => projectHistoryDoc(doc, references)),
    page: { limit, nextCursor, hasMore, scanned, scanLimitReached: scanned >= HISTORY_MAX_SCAN },
  });
}

export async function handleAdminZaloResend(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: ZaloActorInfo
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (userInfo.role !== 'admin') throw withStatus('Admin access is required', 403);

  const input = normalizeBody(req.body);
  const logId = getString(input, 'logId');
  const reason = getString(input, 'reason').trim();
  if (!logId) return res.status(400).json({ success: false, error: 'Missing logId' });
  if (reason.length < 3) {
    return res.status(400).json({ success: false, error: 'Vui lòng nhập lý do gửi lại.' });
  }

  const sourceSnap = await db.collection('zalo_notifications').doc(logId).get();
  if (!sourceSnap.exists)
    return res.status(404).json({ success: false, error: 'Zalo history entry not found' });
  const source = (sourceSnap.data() || {}) as Record<string, unknown>;
  const capability = getZaloResendCapability(source);
  if (!capability.canResend) {
    return res
      .status(409)
      .json({ success: false, error: capability.reason || 'Cannot resend this entry' });
  }

  markAdminResendRequest(req, {
    sourceLogId: logId,
    reason,
    actorId: userInfo.uid,
    actorName: userInfo.name,
  });
  req.body = buildAdminResendBody(source);
  if (asString(source.type) === 'manual') {
    req.body = {
      ...(req.body as Record<string, unknown>),
      clientRequestId: `resend_${logId}_${Date.now()}`,
    };
  }

  let outcome = 'failed';
  try {
    const type = asString(source.type);
    let result;
    if (type === 'manual') result = await handleAdminZaloManualSend(req, res, db, userInfo);
    else if (type === 'absence') result = await handleNotifyAbsence(req, res);
    else if (type === 'evaluation' || type === 'evaluation_notice')
      result = await handleNotifyEvaluation(req, res);
    else if (type === 'rank_achievement') result = await handleNotifyRankAchievement(req, res);
    else if (type === 'tuition_reminder') result = await handleNotifyTuitionReminder(req, res);
    else if (type === 'tuition_notice' || type === 'next_course_tuition')
      result = await handleNotifyTuitionNotice(req, res);
    else if (type === 'payment') result = await handleNotifyPaymentConfirm(req, res);
    else if (type === 'test') result = await handleTest(req, res);
    else throw withStatus('This Zalo notification cannot be resent', 409);
    outcome = res.statusCode >= 200 && res.statusCode < 300 ? 'sent' : 'failed';
    return result;
  } finally {
    await writeAuditLog(db, {
      userId: userInfo.uid,
      userRole: userInfo.role,
      userName: userInfo.name,
      action: 'create',
      collection: 'zalo_notifications',
      documentId: logId,
      metadata: {
        action: 'admin_resend',
        sourceLogId: logId,
        sourceType: asString(source.type),
        reason,
        outcome,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
  }
}
