// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStaffDenyReason, useLoginHandlers } from './useLoginHandlers';

const mocks = vi.hoisted(() => ({
  setBlockedInfo: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  currentUser: null as any,
}));

vi.mock('../lib/auth/sessionAuth', () => ({
  auth: {
    get currentUser() {
      return mocks.currentUser;
    },
    refresh: mocks.refresh,
    signOut: mocks.signOut,
  },
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ setBlockedInfo: mocks.setBlockedInfo }),
}));
vi.mock('../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    language: 'en',
    t: {
      auth: { forgotModal: { pendingMessage: 'Pending' } },
      authErrors: {
        turnstileRequired: 'Turnstile required',
        turnstileConfigMissing: 'Turnstile is not configured',
        turnstileFailed: 'Turnstile failed',
        studentLoginFail: 'Invalid student credentials',
        serverError: 'Server error {status}',
        studentNotFound: 'Student not found',
        invalidPhone: 'Invalid phone',
        smsNotEnabled: 'SMS unavailable',
        captchaFailed: 'Captcha failed',
        invalidAppCredential: 'Invalid credential',
        zaloOtpSent: 'OTP sent to {phone}',
        smsOtpSent: 'SMS sent to {phone}',
        otpIncorrectOrExpired: 'OTP invalid',
        passwordMismatch: 'Password mismatch',
        resetPasswordError: 'Reset error',
        authRequired: 'Auth required',
        passwordChanged: 'Password changed',
        resetPasswordUpdateError: 'Reset update error: ',
        parentPrefix: 'Parent ',
      },
    },
  }),
}));

function response(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as any;
}

describe('useLoginHandlers session flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    mocks.currentUser = null;
    mocks.refresh.mockResolvedValue({ uid: 'session-user' });
    mocks.signOut.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn());
  });

  it.each(['not_allowed', 'revoked'] as const)(
    'restores the denied-account modal from the Google callback reason %s',
    async (reason) => {
      window.history.replaceState(null, '', `/login?authError=${reason}&next=dashboard#section`);

      renderHook(() => useLoginHandlers());

      await waitFor(() =>
        expect(mocks.setBlockedInfo).toHaveBeenCalledWith({ email: '', reason })
      );
      expect(window.location.pathname).toBe('/login');
      expect(window.location.search).toBe('?next=dashboard');
      expect(window.location.hash).toBe('#section');
    }
  );

  it('recognizes denied staff reasons from API errors', () => {
    expect(getStaffDenyReason({ status: 403, data: { reason: 'revoked' } })).toBe('revoked');
    expect(getStaffDenyReason({ status: 403, data: { error: 'Account is not allowed' } })).toBe(
      'not_allowed'
    );
  });

  it('logs staff in through same-origin session endpoints', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, { success: true }))
      .mockResolvedValueOnce(response(200, { success: true, user: { uid: 'staff-1' } }));
    const { result } = renderHook(() => useLoginHandlers());
    act(() => {
      result.current.setStaffEmail('STAFF@EXAMPLE.COM');
      result.current.setStaffPassword('secret');
      result.current.setTurnstileToken('turnstile-token');
    });
    await act(async () => {
      await result.current.handleStaffLogin({ preventDefault: vi.fn() } as any);
    });

    const loginCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => url === '/api/v1/auth/session-login');
    expect(loginCall).toEqual([
      '/api/v1/auth/session-login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          loginType: 'staff',
          email: 'staff@example.com',
          password: 'secret',
          turnstileToken: 'turnstile-token',
        }),
      }),
    ]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('restores the cookie session after student verification', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      response(200, { success: true, user: { uid: 'student:student-1' } })
    );
    const { result } = renderHook(() => useLoginHandlers());
    act(() => {
      result.current.setLoginType('student');
      result.current.setStudentCode('hs001');
      result.current.setStudentPassword('secret');
      result.current.setTurnstileToken('turnstile-token');
    });
    await act(async () => {
      await result.current.handleCodeLogin({ preventDefault: vi.fn() } as any);
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/verify-student-login',
      expect.objectContaining({
        credentials: 'same-origin',
        body: JSON.stringify({
          studentCode: 'HS001',
          password: 'secret',
          loginType: 'student',
          turnstileToken: 'turnstile-token',
        }),
      })
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not call the backend without a Turnstile token', async () => {
    const { result } = renderHook(() => useLoginHandlers());
    act(() => {
      result.current.setStaffEmail('staff@example.com');
      result.current.setStaffPassword('secret');
    });
    await act(async () => {
      await result.current.handleStaffLogin({ preventDefault: vi.fn() } as any);
    });
    await waitFor(() => expect(result.current.error).toBe('Turnstile required'));
    expect(fetch).not.toHaveBeenCalled();
  });
});
