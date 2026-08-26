import { describe, expect, it } from 'vitest';

import { decryptEnvelope, encryptEnvelope } from './envelope.js';

const key = Buffer.alloc(32, 11);
const associatedData = 'ops-sql-execution:SQL-20260822-000123';

describe('AES-GCM envelope encryption', () => {
  it('encrypts SQL plaintext with associated data and decrypts it only with the same context', () => {
    const envelope = encryptEnvelope({
      plaintext: 'SELECT * FROM students WHERE id = $1',
      key,
      associatedData,
      randomBytes: (size) => Buffer.alloc(size, 7)
    });

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain('SELECT');
    expect(decryptEnvelope({ envelope, key, associatedData })).toBe(
      'SELECT * FROM students WHERE id = $1'
    );
  });

  it('rejects tampering, an invalid key, and a mismatched execution context', () => {
    const envelope = encryptEnvelope({
      plaintext: 'SELECT 1',
      key,
      associatedData,
      randomBytes: (size) => Buffer.alloc(size, 7)
    });

    expect(() =>
      decryptEnvelope({ envelope, key, associatedData: 'ops-sql-execution:other' })
    ).toThrow();
    expect(() => decryptEnvelope({ envelope: `${envelope}x`, key, associatedData })).toThrow();
    expect(() =>
      encryptEnvelope({ plaintext: 'SELECT 1', key: Buffer.alloc(31), associatedData })
    ).toThrow(/32 bytes/i);
  });
});
