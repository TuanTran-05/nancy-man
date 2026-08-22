import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  needsPasswordRehash,
  passwordFingerprint,
  validatePasswordPolicy,
  verifyPassword
} from './passwords.js';

const testParameters = { memoryCost: 8_192, timeCost: 1, parallelism: 1 };

describe('Ops passwords', () => {
  it('encodes and verifies passwords using Argon2id', async () => {
    const encoded = await hashPassword('a-long-unique-passphrase', { parameters: testParameters });

    expect(encoded).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(encoded, 'wrong')).resolves.toBe(false);
    await expect(verifyPassword(encoded, 'a-long-unique-passphrase')).resolves.toBe(true);
  });

  it('rejects short, known-demo, identifier-derived, and reused passwords', () => {
    expect(() =>
      validatePasswordPolicy({
        password: 'short',
        username: 'ops.owner',
        email: 'owner@example.test'
      })
    ).toThrow(/14 characters/i);
    expect(() =>
      validatePasswordPolicy({
        password: 'correct horse battery staple',
        username: 'ops.owner',
        email: 'owner@example.test'
      })
    ).toThrow(/not allowed/i);
    expect(() =>
      validatePasswordPolicy({
        password: 'ops.owner-long-passphrase',
        username: 'ops.owner',
        email: 'owner@example.test'
      })
    ).toThrow(/identifier/i);
    expect(() =>
      validatePasswordPolicy({
        password: 'a-long-unique-passphrase',
        username: 'ops.owner',
        email: 'owner@example.test',
        recentFingerprints: [passwordFingerprint('a-long-unique-passphrase', 'fingerprint-pepper')],
        fingerprintPepper: 'fingerprint-pepper'
      })
    ).toThrow(/reuse/i);
  });

  it('recognizes a hash that must be upgraded to the production parameters', async () => {
    const encoded = await hashPassword('a-long-unique-passphrase', { parameters: testParameters });

    expect(needsPasswordRehash(encoded)).toBe(true);
  });
});
