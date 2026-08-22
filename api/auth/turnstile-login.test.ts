import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/auth/route';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { verifyTurnstileToken } from '../../server/api/lib/auth/turnstile.js';
import { getDb } from '../../server/api/lib/auth/verifyAuth.js';

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(),
  isTurnstileFailure: vi.fn((res: any) => !res.success),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  app: {},
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

function mockRes() {
  const res: any = {};
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end = vi.fn();
  return res;
}

describe('POST /api/v1/auth/verify-turnstile-login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue({} as any);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19 });
    vi.mocked(verifyTurnstileToken).mockResolvedValue({ success: true, action: 'login' });
  });

  it('rate limits before verifying a login Turnstile token without native auth', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': ['203.0.113.10, 10.0.0.1'] },
        query: { action: 'verify-turnstile-login' },
        body: { turnstileToken: 'turnstile-token' },
      } as any,
      res
    );

    expect(checkRateLimit).toHaveBeenCalledWith(
      {},
      'turnstile_login:203.0.113.10',
      20,
      5 * 60 * 1000,
      { failClosed: true }
    );
    expect(verifyTurnstileToken).toHaveBeenCalledWith(
      'turnstile-token',
      expect.objectContaining({
        remoteIp: '203.0.113.10',
        expectedAction: 'login',
      })
    );
    expect(vi.mocked(checkRateLimit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(verifyTurnstileToken).mock.invocationCallOrder[0]
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('does not call Cloudflare when the standalone Turnstile endpoint is rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0 });
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        query: { action: 'verify-turnstile-login' },
        body: { turnstileToken: 'turnstile-token' },
      } as any,
      res
    );

    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'rate_limited',
      error: 'Too many bot verification attempts. Please try again later.',
    });
  });

  it('rejects invalid Turnstile verification after the rate limiter allows the request', async () => {
    vi.mocked(verifyTurnstileToken).mockResolvedValueOnce({
      success: false,
      errorCode: 'siteverify-failed',
      error: 'Turnstile verification failed',
      cloudflareErrors: ['timeout-or-duplicate'],
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-turnstile-login' },
        body: { turnstileToken: 'used-token' },
      } as any,
      res
    );

    expect(checkRateLimit).toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'turnstile_failed',
      turnstileErrorCode: 'siteverify-failed',
      error: 'Bot verification failed. Please try again.',
    });
  });
});
