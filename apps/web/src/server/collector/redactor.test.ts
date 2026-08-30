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
    ).toBe('prefix=[payload redacted]');
    expect(redactLogLine('prefix={"nested":{"token":"secret"}').safeText).toBe(
      'prefix=[payload redacted]'
    );
  });

  it.each([
    {
      input:
        'error={\'message\':\'literal }\',"api_key":"TOPSECRET-MALFORMED-SINGLE-QUOTE-917406"}',
      expected: 'error=[payload redacted]'
    },
    {
      input: 'prefix=[\'literal ]\',"secret":"TOPSECRET-MALFORMED-SINGLE-QUOTE-917406"]',
      expected: 'prefix=[payload redacted]'
    },
    {
      input: 'error={message:literal },"api_key":"TOPSECRET-MALFORMED-SINGLE-QUOTE-917406"}',
      expected: 'error=[payload redacted]'
    }
  ])('fails closed through end-of-line for unsupported quote syntax', ({ input, expected }) => {
    const result = redactLogLine(input);

    expect(result.safeText).toBe(expected);
    expect(result.safeText).not.toContain('TOPSECRET-MALFORMED-SINGLE-QUOTE-917406');
  });

  it.each([
    {
      label: 'the exact reviewer quoted-key suffix',
      input: 'error={"message":"ok"} "api_key":"TOPSECRET-POSTPREFIX-640177"',
      expected: 'error=[payload redacted]'
    },
    {
      label: 'a whitespace and unquoted suffix',
      input: 'error={"message":"ok"}    private=TOPSECRET-POSTPREFIX-640177',
      expected: 'error=[payload redacted]'
    },
    {
      label: 'multiple structured values',
      input: 'prefix={"first":true} middle=[{"private":"TOPSECRET-POSTPREFIX-640177"}]',
      expected: 'prefix=[payload redacted]'
    },
    {
      label: 'ordinary prose after a supported payload',
      input: 'warning context={"ok":true} retrying in 5s',
      expected: 'warning context=[payload redacted]'
    }
  ])('redacts all trailing remainder after $label', ({ input, expected }) => {
    const result = redactLogLine(input);

    expect(result.safeText).toBe(expected);
    expect(result.safeText).not.toContain('TOPSECRET-POSTPREFIX-640177');
  });

  it('preserves ordinary non-structured logs and supported scalar redaction', () => {
    expect(redactLogLine('warning retrying in 5s').safeText).toBe('warning retrying in 5s');
    expect(redactLogLine('password=hidden retrying in 5s').safeText).toBe(
      'password=[redacted] retrying in 5s'
    );
  });

  it('fails closed when a valid JSON prefix is followed by malformed JSON continuation', () => {
    const sentinel = 'TOPSECRET-VALID-PREFIX-BYPASS-482901';
    const result = redactLogLine(`error={"message":"literal }"},"private":"${sentinel}"}`);

    expect(result.safeText).toBe('error=[payload redacted]');
    expect(result.safeText).not.toContain(sentinel);
  });
});
