import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { timingSafeEqual } from 'node:crypto';
import { handleCorsPreflight } from '../../lib/http/cors.js';
import { handleApiError } from '../../lib/http/apiResponse.js';
import { handleCreate } from './handlers/create.js';
import { handleList } from './handlers/list.js';
import { handleReconcile } from './handlers/reconcile.js';
import { handleResolveReview } from './handlers/resolveReview.js';
import { handleStatus } from './handlers/status.js';
import { handleWebhook } from './handlers/webhook.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import { guardStudentIdentityRouteMutation } from '../../lib/maintenance/studentIdentityRouteGuard.js';
import { isPayOSEnabled } from '../../lib/payments/payosAvailability.js';

const PAYOS_PROVIDER_ACTIONS = new Set(['create', 'webhook', 'status', 'reconcile']);

function isCronAuthorized(req: ApiRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  const rawAuthorization = req.headers.authorization;
  const authorization = Array.isArray(rawAuthorization) ? rawAuthorization[0] : rawAuthorization;
  if (!authorization?.startsWith('Bearer ')) return false;
  const token = authorization.slice('Bearer '.length);
  if (token.length !== cronSecret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(cronSecret, 'utf8'));
  } catch {
    return false;
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = req.query.action as string;

    if (!isPayOSEnabled() && PAYOS_PROVIDER_ACTIONS.has(action)) {
      return res.status(503).json({
        success: false,
        code: 'PAYOS_DISABLED',
        error: 'PayOS is temporarily unavailable',
      });
    }

    // Reconciliation is cron/staff authorized inside its handler. Repeat that
    // boundary here so an unauthorized caller cannot trigger the maintenance
    // control read that must precede an authorized write dispatch.
    if (action === 'reconcile' && !isCronAuthorized(req)) {
      const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
      if (!user) return;
    }

    // The webhook is guarded too: the provider retries until accepted, so a
    // payment posted mid-window would attach money to a profile the merge has
    // already fingerprinted.
    if (
      await guardStudentIdentityRouteMutation(getDb, res, {
        surface: 'payments',
        action,
        req,
      })
    )
      return;

    if (action === 'create') return await handleCreate(req, res);
    if (action === 'webhook') return await handleWebhook(req, res);
    if (action === 'status') return await handleStatus(req, res);
    if (action === 'list') return await handleList(req, res);
    if (action === 'reconcile') return await handleReconcile(req, res);
    if (action === 'resolve-review') return await handleResolveReview(req, res);

    return res.status(404).json({ success: false, error: 'Unknown payOS action' });
  } catch (err) {
    return handleApiError(req, res, err, {
      module: 'payOS',
      route: `/api/v1/payments/payos/${String(req.query.action || 'unknown')}`,
      defaultMessage: 'Payment request failed',
    });
  }
}
