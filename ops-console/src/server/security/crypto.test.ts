import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from './crypto.js';

describe('security crypto', () => {
  it('uses a versioned scrypt hash and verifies without plaintext storage', () => {
    const encoded = hashPassword('correct horse battery staple');
    expect(encoded).toMatch(/^scrypt\$v=1\$/);
    expect(encoded).not.toContain('correct horse');
    expect(verifyPassword('correct horse battery staple', encoded)).toBe(true);
    expect(verifyPassword('wrong password', encoded)).toBe(false);
  });

  it('encrypts and authenticates a TOTP secret', () => {
    const key = Buffer.alloc(32, 7);
    const encoded = encryptSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', key);
    expect(encoded).toMatch(/^v1\./);
    expect(decryptSecret(encoded, key)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(() => decryptSecret(encoded, Buffer.alloc(32, 8))).toThrow();
  });
});
