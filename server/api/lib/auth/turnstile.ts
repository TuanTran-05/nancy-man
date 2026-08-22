import crypto from 'crypto';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileFailureCode =
  | 'missing-secret'
  | 'missing-token'
  | 'invalid-token'
  | 'siteverify-failed'
  | 'action-mismatch'
  | 'hostname-mismatch'
  | 'siteverify-timeout'
  | 'siteverify-error';

export type TurnstileVerificationResult =
  | {
      success: true;
      action?: string;
      hostname?: string;
      challengeTs?: string;
    }
  | {
      success: false;
      errorCode: TurnstileFailureCode;
      error: string;
      cloudflareErrors?: string[];
    };

type SiteverifyResponse = {
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
};

type VerifyTurnstileOptions = {
  remoteIp?: string;
  expectedAction?: string;
  expectedHostname?: string;
  timeoutMs?: number;
  idempotencyKey?: string;
};

function failure(
  errorCode: TurnstileFailureCode,
  error: string,
  cloudflareErrors?: string[]
): TurnstileVerificationResult {
  return { success: false, errorCode, error, cloudflareErrors };
}

export async function verifyTurnstileToken(
  token: unknown,
  options: VerifyTurnstileOptions = {}
): Promise<TurnstileVerificationResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return failure('missing-secret', 'Turnstile secret is not configured');

  if (typeof token !== 'string' || !token.trim()) {
    return failure('missing-token', 'Turnstile token is required');
  }

  const responseToken = token.trim();
  if (responseToken.length > MAX_TOKEN_LENGTH) {
    return failure('invalid-token', 'Turnstile token is too long');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const body: Record<string, string> = {
      secret,
      response: responseToken,
    };
    if (options.remoteIp) body.remoteip = options.remoteIp;
    body.idempotency_key = options.idempotencyKey || crypto.randomUUID();

    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const result = (await response.json()) as SiteverifyResponse;
    if (!response.ok || result.success !== true) {
      return failure(
        'siteverify-failed',
        'Turnstile verification failed',
        result['error-codes'] || []
      );
    }

    if (options.expectedAction && result.action !== options.expectedAction) {
      return failure('action-mismatch', 'Turnstile action mismatch');
    }

    const expectedHostname =
      options.expectedHostname || process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim();
    if (expectedHostname && result.hostname !== expectedHostname) {
      return failure('hostname-mismatch', 'Turnstile hostname mismatch');
    }

    return {
      success: true,
      action: result.action,
      hostname: result.hostname,
      challengeTs: result.challenge_ts,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return failure('siteverify-timeout', 'Turnstile verification timed out');
    }
    return failure('siteverify-error', 'Turnstile verification could not be completed');
  } finally {
    clearTimeout(timeout);
  }
}

export function isTurnstileFailure(
  result: TurnstileVerificationResult
): result is Extract<TurnstileVerificationResult, { success: false }> {
  return !result.success;
}
