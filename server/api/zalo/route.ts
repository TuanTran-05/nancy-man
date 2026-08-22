import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { getDb, verifyAuthContext } from '../lib/auth/verifyAuth.js';
import type { AuthRole } from '../lib/auth/roles.js';
import { sendApiError } from '../lib/http/helpers.js';
import { staffActorFromContext } from '../lib/auth/contextUser.js';
import { handleBulkNotificationJob } from './handlers/bulkNotificationJobs.js';
import { requireNotificationSenderRole } from './helpers/zaloSecurityAndAccess.js';
import {
  handleStatus,
  handleNotifyAbsence,
  handleNotifyEvaluation,
  handleNotifyStaffCredentials,
  handleNotifyPaymentConfirm,
  handleTest,
  handleNotifyRankAchievement,
} from './handlers/zaloOaHandlers.js';
import {
  handleNotifyTuitionReminder,
  handleNotifyTuitionNotice,
} from './handlers/tuitionHandler.js';
import {
  handleZaloSendCount,
  handleZaloLogSummary,
  handleSendNotification,
  handleMarkNotificationRead,
  handleMarkAllNotificationsRead,
} from './handlers/messagesHandler.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';
import {
  handleAdminZaloResend,
  handleZaloHistory,
} from './handlers/adminHistoryHandlers.js';
import {
  handleAdminZaloManualSend,
  handleAdminZaloTemplateDetail,
  handleAdminZaloTemplates,
} from './handlers/adminManualSendHandlers.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = String(req.query.action || '');

    if (action.startsWith('bot-')) {
      const { dispatchZaloBotRoute } = await import('../zalo-bot/routeHandler.js');
      return await dispatchZaloBotRoute(action.slice('bot-'.length), req, res);
    }

    if (action === 'bulk-notification-job') {
      const verified = await verifyAuthContext(req, res, ['admin', 'office', 'accounting']);
      if (!verified) return;
      if (
        await guardStudentIdentityRouteMutation(getDb, res, {
          surface: 'messaging',
          action,
          req,
        })
      )
        return;
      return await handleBulkNotificationJob(
        req,
        res,
        getDb(),
        staffActorFromContext(verified.context)
      );
    }

    if (
      action === 'zalo-history' ||
      action === 'admin-resend' ||
      action === 'admin-templates' ||
      action === 'admin-template-detail' ||
      action === 'admin-manual-send'
    ) {
      const verified = await verifyAuthContext(req, res, ['admin']);
      if (!verified) return;
      if (
        (action === 'admin-resend' || action === 'admin-manual-send') &&
        (await guardStudentIdentityRouteMutation(getDb, res, {
          surface: 'messaging',
          action,
          req,
        }))
      )
        return;
      const db = getDb();
      const actor = staffActorFromContext(verified.context);
      if (action === 'zalo-history') return await handleZaloHistory(req, res, db, actor);
      if (action === 'admin-resend') return await handleAdminZaloResend(req, res, db, actor);
      if (action === 'admin-templates') return await handleAdminZaloTemplates(req, res, actor);
      if (action === 'admin-template-detail') {
        return await handleAdminZaloTemplateDetail(req, res, actor);
      }
      return await handleAdminZaloManualSend(req, res, db, actor);
    }

    if (action === 'notify-tuition-reminder' || action === 'notify-tuition-notice') {
      const roles: AuthRole[] =
        action === 'notify-tuition-reminder'
          ? ['admin', 'accounting']
          : ['admin', 'accounting', 'office'];
      const verified = await verifyAuthContext(req, res, roles);
      if (!verified) return;
      if (
        await guardStudentIdentityRouteMutation(getDb, res, {
          surface: 'messaging',
          action,
          req,
        })
      )
        return;
    }

    // Zalo OA actions are dispatched before the shared messages auth gate because
    // each OA handler performs its own action-specific verifyAuthToken role check.
    switch (action) {
      case 'status':
        return await handleStatus(req, res);
      case 'notify-absence':
        return await handleNotifyAbsence(req, res);
      case 'notify-evaluation':
        return await handleNotifyEvaluation(req, res);
      case 'notify-rank-achievement':
        return await handleNotifyRankAchievement(req, res);
      case 'notify-tuition-reminder':
        return await handleNotifyTuitionReminder(req, res);
      case 'notify-tuition-notice':
        return await handleNotifyTuitionNotice(req, res);
      case 'notify-staff-credentials':
        return await handleNotifyStaffCredentials(req, res);
      case 'test':
        return await handleTest(req, res);
      case 'notify-payment-confirm':
        return await handleNotifyPaymentConfirm(req, res);
    }

    // Notification actions retain the legacy /api/v1/messages namespace for compatibility.
    const verified = await verifyAuthContext(req, res, [
      'admin',
      'teacher',
      'parent',
      'accounting',
      'office',
    ]);
    if (!verified) return;

    // After authentication, not before: an unauthorized caller must not cause a
    // DocumentStore read. The OA handlers below authenticate themselves and carry
    // their own guard call for the same reason.
    if (await guardStudentIdentityRouteMutation(getDb, res, { surface: 'messaging', action, req }))
      return;

    const db = getDb();
    const userInfo = staffActorFromContext(verified.context);

    switch (action) {
      case 'zalo-send-count':
        return await handleZaloSendCount(req, res, db, userInfo);
      case 'zalo-log-summary':
        return await handleZaloLogSummary(req, res, db, userInfo);
      case 'send-message':
      case 'mark-read':
      case 'create-conversation':
      case 'repair-conversation':
        return res.status(410).json({ success: false, error: 'Messaging has been removed' });
      case 'send-notification':
        requireNotificationSenderRole(userInfo);
        return await handleSendNotification(req, res, db, userInfo);
      case 'mark-notification-read':
        return await handleMarkNotificationRead(req, res, db, userInfo);
      case 'mark-all-notifications-read':
        return await handleMarkAllNotificationsRead(req, res, db, userInfo);
      default:
        return res.status(404).json({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error(`[zalo/${req.query.action}] Unhandled error:`, err);
    return sendApiError(res, err, 'Zalo request failed');
  }
}
