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

describe('POST /api/v1/auth/verify-student-login Turnstile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue({} as any);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9 });
    vi.mocked(verifyTurnstileToken).mockResolvedValue({ success: true, action: 'login' });
  });

  it('rate limits before verifying student Turnstile', async () => {
    vi.mocked(verifyTurnstileToken).mockResolvedValueOnce({
      success: false,
      errorCode: 'siteverify-failed',
      error: 'Turnstile verification failed',
    });
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': ['198.51.100.8, 10.0.0.1'] },
        query: { action: 'verify-student-login' },
        body: {
          studentCode: 'hs260001',
          password: 'StudentPass1',
          loginType: 'student',
          turnstileToken: 'bad-token',
        },
      } as any,
      res
    );

    expect(checkRateLimit).toHaveBeenCalledWith({}, '198.51.100.8:HS260001', 10, 5 * 60 * 1000, {
      failClosed: true,
    });
    expect(verifyTurnstileToken).toHaveBeenCalledWith(
      'bad-token',
      expect.objectContaining({
        remoteIp: '198.51.100.8',
        expectedAction: 'login',
      })
    );
    expect(vi.mocked(checkRateLimit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(verifyTurnstileToken).mock.invocationCallOrder[0]
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'turnstile_failed',
      turnstileErrorCode: 'siteverify-failed',
      error: 'Bot verification failed. Please try again.',
    });
  });

  it('does not call Cloudflare when student login is rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0 });
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.20' },
        query: { action: 'verify-student-login' },
        body: {
          studentCode: 'HS260001',
          password: 'StudentPass1',
          loginType: 'student',
          turnstileToken: 'turnstile-token',
        },
      } as any,
      res
    );

    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: 'Too many attempts. Please try again later.',
    });
  });
});
