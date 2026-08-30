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

  it('fails closed for nested structured payloads before credential token matching', () => {
    const sentinel = 'TOPSECRET-REVIEW-SENTINEL';
    const result = redactLogLine(`error={"context":{"route":"/login"},"api_key":"${sentinel}"}`);

    expect(result.safeText).toBe('error=[payload redacted]');
    expect(result.safeText).not.toContain(sentinel);
  });

  it('treats quoted brackets as data and redacts an unterminated structure to end of line', () => {
    expect(
      redactLogLine('prefix={"message":"literal } [ value","nested":[1]} suffix').safeText
    ).toBe('prefix=[payload redacted] suffix');
    expect(redactLogLine('prefix={"nested":{"token":"secret"}').safeText).toBe(
      'prefix=[payload redacted]'
    );
  });
});
