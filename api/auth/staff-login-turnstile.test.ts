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

vi.mock('../../server/api/lib/logging/auditLog.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/api/lib/logging/auditLog.js')>(
    '../../server/api/lib/logging/auditLog.js'
  );
  return {
    ...actual,
    writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  };
});

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

describe('POST /api/v1/auth/staff-login-rate-check Turnstile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue({} as any);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 4 });
    vi.mocked(verifyTurnstileToken).mockResolvedValue({ success: true, action: 'login' });
  });

  it('rate limits before verifying Turnstile and returns success', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        query: { action: 'staff-login-rate-check' },
        body: { email: 'teacher@example.com', turnstileToken: 'turnstile-token' },
      } as any,
      res
    );

    expect(checkRateLimit).toHaveBeenCalledWith(
      {},
      'staff_login:203.0.113.10:teacher@example.com',
      5,
      5 * 60 * 1000,
      { failOpen: true }
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

  it('does not call Cloudflare when the staff precheck is rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0 });
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        query: { action: 'staff-login-rate-check' },
        body: { email: 'teacher@example.com', turnstileToken: 'turnstile-token' },
      } as any,
      res
    );

    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: 'Too many login attempts. Please try again in 5 minutes.',
    });
  });

  it('still rejects invalid Turnstile after the staff rate limiter allows the request', async () => {
    vi.mocked(verifyTurnstileToken).mockResolvedValueOnce({
      success: false,
      errorCode: 'siteverify-failed',
      error: 'Turnstile verification failed',
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-login-rate-check' },
        body: { email: 'teacher@example.com', turnstileToken: 'bad-token' },
      } as any,
      res
    );

    expect(checkRateLimit).toHaveBeenCalled();
    expect(verifyTurnstileToken).toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'turnstile_failed',
      turnstileErrorCode: 'siteverify-failed',
      error: 'Bot verification failed. Please try again.',
    });
  });

  it('uses the first forwarded IP when the header arrives as an array', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': ['198.51.100.23, 10.0.0.1', '203.0.113.5'] },
        query: { action: 'staff-login-rate-check' },
        body: { email: 'teacher@example.com', turnstileToken: 'turnstile-token' },
      } as any,
      res
    );

    expect(verifyTurnstileToken).toHaveBeenCalledWith(
      'turnstile-token',
      expect.objectContaining({ remoteIp: '198.51.100.23' })
    );
    expect(checkRateLimit).toHaveBeenCalledWith(
      {},
      'staff_login:198.51.100.23:teacher@example.com',
      5,
      5 * 60 * 1000,
      { failOpen: true }
    );
  });
});
