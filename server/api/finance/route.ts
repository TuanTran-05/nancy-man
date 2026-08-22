import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { handleApiError, sendApiError } from '../lib/http/apiResponse.js';
import { getClientIp } from '../lib/logging/auditLog.js';
import { verifyAuthContext, getDb } from '../lib/auth/verifyAuth.js';
import {
  authUserFromContext,
  mutationUserInfoFromContext,
} from '../lib/auth/contextUser.js';
import { checkRateLimit } from '../lib/auth/rateLimit.js';
import { handleExpenses } from './handlers/expenses.js';
import { handleInvoices } from './handlers/invoices.js';
import { handleReceipts } from './handlers/receipts.js';
import { handleWallet } from './handlers/wallet.js';
import { handleReport } from './handlers/report.js';
import { handleCenterReport } from './handlers/centerReport.js';
import { handleCenterReportDetails } from './handlers/centerReportDetails.js';
import {
  handleClassReconciliationOptions,
  handleClassReconciliation,
  handleClassReconciliationStudent,
} from './handlers/classTuitionReconciliation.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = String(req.query.action || '');
    const resource = String(req.query.resource || '');

    if (
      await guardStudentIdentityRouteMutation(getDb, res, {
        surface: 'finance',
        resource: resource || undefined,
        action,
        req,
      })
    )
      return;

    if (action === 'report') {
      return await handleReport(req, res);
    }

    if (action === 'center-report') {
      return await handleCenterReport(req, res);
    }

    if (action === 'center-report-details') {
      return await handleCenterReportDetails(req, res);
    }

    if (action === 'class-reconciliation-options') {
      return await handleClassReconciliationOptions(req, res);
    }

    if (action === 'class-reconciliation') {
      return await handleClassReconciliation(req, res);
    }

    if (action === 'class-reconciliation-student') {
      return await handleClassReconciliationStudent(req, res);
    }

    const verified = await verifyAuthContext(req, res, ['admin', 'accounting', 'teacher']);
    if (!verified) return;

    const db = getDb();

    const id = req.query.id as string;
    const user = authUserFromContext(verified.context);
    const userInfo = mutationUserInfoFromContext(verified.context);

    if (req.method !== 'GET') {
      const { allowed } = await checkRateLimit(
        db,
        `finance_mutation:${getClientIp(req)}:${user.uid}`,
        60,
        60 * 1000,
        { failClosed: true }
      );
      if (!allowed) return sendApiError(res, 429, 'Too many finance requests');
    }

    if (resource === 'receipts' && action === 'next-number') {
      if (userInfo.role !== 'admin' && userInfo.role !== 'accounting') {
        return res.status(403).json({ success: false, error: 'Not authorized for finance action' });
      }
      return await handleReceipts(req, res, id, action, user.uid, userInfo);
    }
    if (resource === 'expenses' && action === 'next-number') {
      if (userInfo.role !== 'admin' && userInfo.role !== 'accounting') {
        return res.status(403).json({ success: false, error: 'Not authorized for finance action' });
      }
      return await handleExpenses(req, res, id, action, user.uid, userInfo);
    }

    if (action === 'save-tuition-record') {
      return res.status(410).json({
        success: false,
        error:
          'Legacy tuition records are read-only after migration. Use course ledgers and receipts.',
      });
    }
    if (action === 'save-tuition-config') {
      return res.status(410).json({
        success: false,
        error:
          'Legacy tuition configs are read-only after migration. Use course class tuition settings.',
      });
    }
    if (action === 'auto-generate-tuition') {
      return res.status(410).json({
        success: false,
        error: 'Legacy monthly tuition generation is disabled after migration.',
      });
    }

    if (!resource) {
      return res.status(400).json({ success: false, error: 'Missing resource parameter' });
    }
    if (userInfo.role !== 'admin' && userInfo.role !== 'accounting') {
      return res.status(403).json({ success: false, error: 'Not authorized for finance action' });
    }

    if (resource === 'receipts') {
      return await handleReceipts(req, res, id, action, user.uid, userInfo);
    }
    if (resource === 'expenses') {
      return await handleExpenses(req, res, id, action, user.uid, userInfo);
    }
    if (resource === 'invoices') {
      return await handleInvoices(req, res, id, action, user.uid, userInfo);
    }
    if (resource === 'wallet') {
      return await handleWallet(req, res, id, action, user.uid, userInfo);
    }

    return res.status(404).json({ success: false, error: 'Unknown finance resource' });
  } catch (err) {
    return handleApiError(req, res, err, {
      module: 'finance',
      route: `/api/v1/finance/${String(req.query.action || 'unknown')}`,
      defaultMessage: 'Finance request failed',
    });
  }
}
