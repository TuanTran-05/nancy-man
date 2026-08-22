import { describe, expect, it } from 'vitest';
import { issueEnrollmentToken } from './enrollmentToken.js';
describe('MFA enrollment tokens', () => {
  it('returns an opaque token and a fixed hash without retaining plaintext', () => {
    const token = issueEnrollmentToken(() => Buffer.alloc(32, 7));
    expect(token.plainToken).toHaveLength(43);
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.tokenHash).not.toContain(token.plainToken);
  });
});
