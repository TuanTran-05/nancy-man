import { describe, expect, it } from 'vitest';
import { totpCode, verifyTotp } from './totp.js';

describe('RFC 6238 TOTP', () => {
  it('accepts RFC 6238 SHA-1 TOTP in the adjacent 30-second window', () => {
    expect(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', new Date(59_000))).toBe(true);
  });

  it('rejects malformed and distant codes', () => {
    expect(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'abc123', new Date(59_000))).toBe(false);
    expect(
      verifyTotp(
        'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 0),
        new Date(120_000)
      )
    ).toBe(false);
  });
});
