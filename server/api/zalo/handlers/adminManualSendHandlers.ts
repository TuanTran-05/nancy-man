import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { normalizeBody, getString, withStatus } from '../../lib/http/helpers.js';
import { sanitizeLogValue } from '../../lib/logging/logSanitizer.js';
import { getClientIp, writeAuditLog } from '../../lib/logging/auditLog.js';
import { getZaloConfig, sendZaloZNSMessage } from '../../lib/zalo/zaloHelper.js';
import { isValidVNPhone, normalizePhoneVN } from '../../../../shared/phone.js';
import type { ZaloManualSendRequest } from '../../../../shared/zaloAdmin.js';
import { getAdminResendLogMetadata } from '../helpers/adminResendContext.js';
import {
  enforceZaloSendGuard,
  markZaloSendRecord,
  rateLimitKeyPart,
} from '../helpers/zaloBaseHelpers.js';
import type { ZaloActorInfo } from '../helpers/zaloSecurityAndAccess.js';
import {
  getAdminZaloTemplateDetail,
  isConfiguredAdminManualTemplate,
  listAdminZaloTemplates,
} from '../helpers/zaloTemplateCatalog.js';
import {
  createZaloPayloadSnapshot,
  isSensitiveZaloTemplate,
  normalizeAndValidateTemplateData,
} from '../helpers/zaloTemplatePolicy.js';

function assertAdmin(actor: ZaloActorInfo) {
  if (actor.role !== 'admin') throw withStatus('Admin access is required', 403);
}

export async function handleAdminZaloTemplates(
  req: ApiRequest,
  res: ApiResponse,
  actor: ZaloActorInfo
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  assertAdmin(actor);
  const result = await listAdminZaloTemplates();
  return res.status(200).json({ success: true, ...result });
}

export async function handleAdminZaloTemplateDetail(
  req: ApiRequest,
  res: ApiResponse,
  actor: ZaloActorInfo
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  assertAdmin(actor);
  const templateId = getString(req.query as Record<string, unknown>, 'templateId');
  if (!templateId) return res.status(400).json({ success: false, error: 'Missing templateId' });
  if (!isConfiguredAdminManualTemplate(templateId)) {
    return res.status(403).json({
      success: false,
      error: 'Template không nằm trong danh sách gửi thủ công đã cấu hình.',
    });
  }
  const template = await getAdminZaloTemplateDetail(templateId);
  return res.status(200).json({ success: true, template });
}

export async function handleAdminZaloManualSend(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  actor: ZaloActorInfo
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  assertAdmin(actor);
  const body = normalizeBody(req.body) as Partial<ZaloManualSendRequest>;
  const templateId = String(body.templateId || '').trim();
  const rawPhone = String(body.phone || '').trim();
  const clientRequestId = String(body.clientRequestId || '').trim();
  const inputData =
    body.templateData && typeof body.templateData === 'object' ? body.templateData : {};
  if (!templateId || !rawPhone || !clientRequestId) {
    return res
      .status(400)
      .json({ success: false, error: 'Thiếu template, số điện thoại hoặc mã yêu cầu.' });
  }
  if (!isValidVNPhone(rawPhone)) {
    return res.status(400).json({ success: false, error: 'Số điện thoại Việt Nam không hợp lệ.' });
  }

  if (!isConfiguredAdminManualTemplate(templateId)) {
    return res.status(403).json({
      success: false,
      error: 'Template không nằm trong danh sách gửi thủ công đã cấu hình.',
    });
  }

  const template = await getAdminZaloTemplateDetail(templateId);
  if (template.status !== 'ENABLE') {
    return res.status(409).json({ success: false, error: 'Template chưa ở trạng thái ENABLE.' });
  }
  const cfg = getZaloConfig();
  if (
    isSensitiveZaloTemplate(template, {
      otpTemplateId: cfg.znsOtpTemplateId,
      staffTemplateId: cfg.znsStaffTemplateId,
    })
  ) {
    return res.status(403).json({
      success: false,
      error: 'Template chứa mã hoặc mật khẩu và không được gửi thủ công.',
    });
  }
  const validated = normalizeAndValidateTemplateData(template.listParams, inputData);
  if (validated.ok === false) {
    return res.status(400).json({ success: false, error: validated.errors.join('\n') });
  }

  const phone = normalizePhoneVN(rawPhone);
  const guard = await enforceZaloSendGuard(
    db,
    req,
    res,
    actor.uid,
    'admin-manual-send',
    clientRequestId,
    30 * 60 * 1000
  );
  if (guard !== 'send') return;

  const trackingId = `manual_${Date.now()}_${rateLimitKeyPart(clientRequestId)}`.slice(0, 48);
  const payloadSnapshot = createZaloPayloadSnapshot({
    templateId,
    templateName: template.templateName,
    previewUrl: template.previewUrl,
    phone,
    templateData: validated.data,
  });
  const logRef = db.collection('zalo_notifications').doc();
  await logRef.set(
    sanitizeLogValue({
      type: 'manual',
      source: 'admin_manual',
      status: 'sending',
      phone,
      templateId,
      templateName: template.templateName,
      templateTag: template.templateTag || '',
      templatePreviewUrl: template.previewUrl || '',
      trackingId,
      payloadCaptured: true,
      payloadSnapshot,
      sentBy: actor.uid,
      sentByName: actor.name,
      createdAt: new Date().toISOString(),
      ...getAdminResendLogMetadata(req),
    })
  );

  const result = await sendZaloZNSMessage(templateId, validated.data, phone, trackingId);
  await logRef.update({
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    completedAt: new Date().toISOString(),
  });
  if (result.success) await markZaloSendRecord(db, 'admin-manual-send', clientRequestId);

  await writeAuditLog(db, {
    userId: actor.uid,
    userRole: actor.role,
    userName: actor.name,
    action: 'create',
    collection: 'zalo_notifications',
    documentId: logRef.id,
    metadata: {
      action: 'admin_manual_send',
      templateId,
      templateName: template.templateName,
      phone,
      variableNames: Object.keys(validated.data),
      trackingId,
      outcome: result.success ? 'sent' : 'failed',
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  if (!result.success) {
    return res.status(502).json({
      success: false,
      errorCode: result.errorCode ?? 'gateway_error',
      error: result.error || 'Failed to send Zalo notification',
      logId: logRef.id,
      trackingId,
    });
  }
  return res.status(200).json({
    success: true,
    messageId: result.messageId,
    logId: logRef.id,
    trackingId,
  });
}
