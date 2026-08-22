import type { Request, RequestHandler } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isGlobalWriteFreezeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GLOBAL_WRITE_FREEZE === 'true';
}

export interface GlobalWriteFreezeOptions {
  isLegacyMutatingRead?: (req: Request) => boolean;
}

/**
 * Cutover/incident kill switch for every API write surface.
 *
 * It deliberately covers browser requests, webhooks, and cron mutations. A
 * snapshot is not globally frozen if one server-to-server path can still post
 * a receipt, attendance row, payment, or notification after the cutoff.
 */
export function rejectMutationDuringGlobalWriteFreeze(
  options: GlobalWriteFreezeOptions = {}
): RequestHandler {
  return (req, res, next) => {
    const isMutation =
      MUTATING_METHODS.has(req.method.toUpperCase()) ||
      options.isLegacyMutatingRead?.(req) === true;
    if (!isMutation || !isGlobalWriteFreezeEnabled()) {
      return next();
    }

    res.setHeader('Retry-After', '300');
    return res.status(503).json({
      success: false,
      error: 'System maintenance is in progress',
      code: 'GLOBAL_WRITE_FREEZE',
    });
  };
}
