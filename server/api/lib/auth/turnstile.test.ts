import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstileToken } from './turnstile.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('verifyTurnstileToken', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      TURNSTILE_SECRET_KEY: 'test-secret',
    };
    delete process.env.TURNSTILE_EXPECTED_HOSTNAME;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('rejects a missing token without calling Siteverify', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyTurnstileToken('', { expectedAction: 'login' });

    expect(result).toEqual({
      success: false,
      errorCode: 'missing-token',
      error: 'Turnstile token is required',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token longer than Cloudflare allows without calling Siteverify', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyTurnstileToken('x'.repeat(2049), { expectedAction: 'login' });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'invalid-token',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a successful login Siteverify response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        action: 'login',
        hostname: 'vps.thienuy.edu.vn',
        challenge_ts: '2026-06-04T00:00:00.000Z',
        'error-codes': [],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyTurnstileToken('valid-token', {
      remoteIp: '203.0.113.10',
      expectedAction: 'login',
      expectedHostname: 'vps.thienuy.edu.vn',
      idempotencyKey: 'fixed-idempotency-key',
    });

    expect(result).toEqual({
      success: true,
      action: 'login',
      hostname: 'vps.thienuy.edu.vn',
      challengeTs: '2026-06-04T00:00:00.000Z',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: 'test-secret',
          response: 'valid-token',
          remoteip: '203.0.113.10',
          idempotency_key: 'fixed-idempotency-key',
        }),
      })
    );
  });

  it('rejects a successful Siteverify response with the wrong action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          action: 'signup',
          hostname: 'vps.thienuy.edu.vn',
          'error-codes': [],
        })
      )
    );

    const result = await verifyTurnstileToken('valid-token', { expectedAction: 'login' });

    expect(result).toEqual({
      success: false,
      errorCode: 'action-mismatch',
      error: 'Turnstile action mismatch',
    });
  });

  it('rejects a successful Siteverify response with the wrong hostname', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          action: 'login',
          hostname: 'evil.example.com',
          'error-codes': [],
        })
      )
    );

    const result = await verifyTurnstileToken('valid-token', {
      expectedAction: 'login',
      expectedHostname: 'vps.thienuy.edu.vn',
    });

    expect(result).toEqual({
      success: false,
      errorCode: 'hostname-mismatch',
      error: 'Turnstile hostname mismatch',
    });
  });

  it('rejects a successful Siteverify response with a missing action when login action is required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          hostname: 'vps.thienuy.edu.vn',
          'error-codes': [],
        })
      )
    );

    const result = await verifyTurnstileToken('valid-token', { expectedAction: 'login' });

    expect(result).toEqual({
      success: false,
      errorCode: 'action-mismatch',
      error: 'Turnstile action mismatch',
    });
  });

  it('rejects a successful Siteverify response with an empty action when login action is required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          action: '',
          hostname: 'vps.thienuy.edu.vn',
          'error-codes': [],
        })
      )
    );

    const result = await verifyTurnstileToken('valid-token', { expectedAction: 'login' });

    expect(result).toEqual({
      success: false,
      errorCode: 'action-mismatch',
      error: 'Turnstile action mismatch',
    });
  });
});
