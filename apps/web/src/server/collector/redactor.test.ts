import { describe, expect, it } from 'vitest';
import { redactLogLine } from './redactor.js';

describe('log redactor', () => {
  it('removes credentials, email, phone, UUID and JSON payload before fingerprinting', () => {
    const result = redactLogLine(
      'Bearer abc.def password=x user=a@b.vn phone=0912345678 id=123e4567-e89b-12d3-a456-426614174000 {"token":"x"}'
    );
    expect(result.safeText).not.toMatch(/abc|a@b|0912345678|123e4567|\{"token"/);
    expect(result.safeText.length).toBeLessThanOrEqual(500);
  });

  it('fingerprints the redacted normalized text and marks fatal lines', () => {
    expect(redactLogLine('FATAL password=hidden').isFatal).toBe(true);
    expect(redactLogLine('error=one').fingerprint).toBe(redactLogLine('error=one').fingerprint);
    expect(redactLogLine('error=one').fingerprint).not.toBe(redactLogLine('error=two').fingerprint);
  });
});
