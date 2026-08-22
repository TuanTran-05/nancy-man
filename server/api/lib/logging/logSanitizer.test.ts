import { describe, expect, it } from 'vitest';
import { sanitizeError, sanitizeLogValue } from './logSanitizer.js';

describe('log sanitizer', () => {
  it('redacts token-bearing strings and URL fragments', () => {
    const sanitized = sanitizeLogValue({
      auth: 'Bearer eyJhbGciOi.fake.signature',
      url: 'https://example.com/callback?token=abc123&ok=1#access_token=secret',
      nested: {
        message: 'refresh_token=refresh-secret customToken=custom-secret',
      },
    });

    expect(sanitized).toMatchObject({
      auth: 'Bearer [REDACTED]',
      url: 'https://example.com/callback?token=[REDACTED]&ok=1#[REDACTED]',
      nested: {
        message: 'refresh_token=[REDACTED] customToken=[REDACTED]',
      },
    });
  });

  it('redacts token-like object keys recursively', () => {
    const sanitized = sanitizeLogValue({
      accessToken: 'access-secret',
      child: { refresh_token: 'refresh-secret', safe: 'ok' },
      list: [{ resetToken: 'reset-secret' }],
    });

    expect(sanitized).toEqual({
      accessToken: '[REDACTED]',
      child: { refresh_token: '[REDACTED]', safe: 'ok' },
      list: [{ resetToken: '[REDACTED]' }],
    });
  });

  it('redacts error messages and stacks before capture', () => {
    const err = new Error('failed with Bearer abc.def');
    err.stack = 'Error: failed\n    at https://vps.thienuy.edu.vn/#idToken=secret';

    const sanitized = sanitizeError(err);

    expect(sanitized).toBeInstanceOf(Error);
    expect((sanitized as Error).message).toBe('failed with Bearer [REDACTED]');
    expect((sanitized as Error).stack).toContain('#[REDACTED]');
  });
});
