import type { ApiRequest } from '@/server/api/lib/http/types.js';

export type AdminResendContext = {
  sourceLogId: string;
  reason: string;
  actorId: string;
  actorName: string;
};

const resendContexts = new WeakMap<object, AdminResendContext>();

export function markAdminResendRequest(req: ApiRequest, context: AdminResendContext) {
  resendContexts.set(req, context);
}

export function getAdminResendContext(req: ApiRequest): AdminResendContext | undefined {
  return resendContexts.get(req);
}

export function getAdminResendLogMetadata(req: ApiRequest): Record<string, unknown> {
  const context = getAdminResendContext(req);
  if (!context) return {};
  return {
    isResend: true,
    resendOf: context.sourceLogId,
    resendReason: context.reason,
    resentBy: context.actorId,
    resentByName: context.actorName,
  };
}
