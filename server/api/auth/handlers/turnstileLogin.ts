import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { normalizeBody } from '../../lib/http/helpers.js';
import {
  verifyTurnstileToken,
  type TurnstileVerificationResult,
  isTurnstileFailure,
} from '../../lib/auth/turnstile.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import { getClientIp } from '../../lib/logging/auditLog.js';

const TURNSTILE_LOGIN_RATE_LIMIT_MAX = 20;
const TURNSTILE_LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

export function turnstileFailureBody(
  result: Extract<TurnstileVerificationResult, { success: false }>
) {
  return {
    success: false,
    errorCode: 'turnstile_failed',
    turnstileErrorCode: result.errorCode,
    error: 'Bot verification failed. Please try again.',
  };
}

export async function handleVerifyTurnstileLogin(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimit(
    getDb(),
    `turnstile_login:${ip}`,
    TURNSTILE_LOGIN_RATE_LIMIT_MAX,
    TURNSTILE_LOGIN_RATE_LIMIT_WINDOW_MS,
    { failClosed: true }
  );
  if (!rl.allowed) {
    return res.status(429).json({
      success: false,
      errorCode: 'rate_limited',
      error: 'Too many bot verification attempts. Please try again later.',
    });
  }

  const body = normalizeBody(req.body);
  const validation = await verifyTurnstileToken(body.turnstileToken, {
    remoteIp: ip,
    expectedAction: 'login',
  });

  if (isTurnstileFailure(validation)) {
    return res.status(400).json(turnstileFailureBody(validation));
  }

  return res.status(200).json({ success: true });
}
