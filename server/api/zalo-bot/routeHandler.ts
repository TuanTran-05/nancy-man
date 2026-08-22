import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { verifyAuthContext } from '../lib/auth/verifyAuth.js';
import { handleZaloBotWebhook } from './webhookHandler.js';
import { dispatchZaloBotAdminAction, dispatchZaloBotSelfAction } from './linkHandlers.js';

export async function dispatchZaloBotRoute(
  action: string,
  req: ApiRequest,
  res: ApiResponse
) {
  if (action === 'webhook') {
    return handleZaloBotWebhook(req, res);
  }

  if (action.startsWith('admin-')) {
    const verified = await verifyAuthContext(req, res, ['admin']);
    if (!verified) return;
    return dispatchZaloBotAdminAction(action, req, res, verified.context);
  }

  const verified = await verifyAuthContext(req, res, ['teacher', 'office', 'admin']);
  if (!verified) return;
  return dispatchZaloBotSelfAction(action, req, res, verified.context);
}
