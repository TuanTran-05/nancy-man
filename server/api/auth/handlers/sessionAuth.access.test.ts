import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { query: vi.fn() },
  createSession: vi.fn(),
  findAllowedGoogleUser: vi.fn(),
  resolveGoogleUserAccess: vi.fn(),
  verifyStaffPassword: vi.fn(),
  verifyStaffPasswordAccess: vi.fn(),
  verifyTurnstileToken: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getPostgresPool: () => mocks.database,
}));

vi.mock('../../lib/auth/turnstile.js', () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
  isTurnstileFailure: (result: { success: boolean }) => !result.success,
}));

vi.mock('../../lib/auth/sessionStore.js', () => ({
  constantTimeTextEqual: () => true,
  createSession: mocks.createSession,
  destroySession: vi.fn(),
  findAllowedGoogleUser: mocks.findAllowedGoogleUser,
  resolveGoogleUserAccess: mocks.resolveGoogleUserAccess,
  linkGoogleProvider: vi.fn(),
  loadSession: vi.fn(),
  publicSessionUser: vi.fn((principal) => principal),
  setStaffForcePasswordChange: vi.fn(),
  setStaffPassword: vi.fn(),
  verifyStaffPassword: mocks.verifyStaffPassword,
  verifyStaffPasswordAccess: mocks.verifyStaffPasswordAccess,
}));

import { handleGoogleCallback, handleSessionLogin } from './sessionAuth.js';

function response() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    redirect: vi.fn(),
    appendHeader: vi.fn(),
    setHeader: vi.fn(),
  } as any;
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.redirect.mockReturnValue(res);
  return res;
}

function googleState() {
  return `${Buffer.from(
    JSON.stringify({
      nonce: 'nonce',
      returnTo: '/',
      expiresAt: Date.now() + 60_000,
      mode: 'login',
    })
  ).toString('base64url')}.signature`;
}

describe('native staff denial responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-enough-entropy');
    vi.stubEnv('PUBLIC_BASE_URL', 'https://example.com');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'google-client');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'google-secret');
    mocks.database.query.mockResolvedValue({ rows: [{ blocked: false }] });
    mocks.verifyTurnstileToken.mockResolvedValue({ success: true, action: 'login' });
    mocks.verifyStaffPassword.mockResolvedValue(null);
    mocks.findAllowedGoogleUser.mockResolvedValue(null);
    mocks.createSession.mockResolvedValue({ uid: 'teacher-1' });
  });

  it('redirects a blocked Google account with the revoked reason', async () => {
    mocks.resolveGoogleUserAccess.mockResolvedValue({ allowed: false, reason: 'revoked' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ access_token: 'token' }) })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            sub: 'google-teacher',
            email: 'teacher@example.com',
            email_verified: true,
          }),
        })
    );
    const state = googleState();
    const req = {
      method: 'GET',
      query: { code: 'oauth-code', state },
      headers: { cookie: 'edutrack_google_state=cookie-value' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = response();

    await handleGoogleCallback(req, res);

    expect(res.redirect).toHaveBeenCalledWith(303, '/login?authError=revoked');
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('returns the revoked reason for a blocked account with a valid password', async () => {
    mocks.verifyStaffPasswordAccess.mockResolvedValue({
      authenticated: false,
      reason: 'revoked',
    });
    const req = {
      method: 'POST',
      body: {
        email: 'teacher@example.com',
        password: 'correct-password',
        turnstileToken: 'turnstile-token',
      },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = response();

    await handleSessionLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      reason: 'revoked',
      error: 'Account access revoked',
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
