import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import {
  createFingerprintKey,
  fingerprintSource,
  fingerprintValue,
  hmacFingerprint
} from './fingerprint.js';

describe('agent fingerprints', () => {
  test('uses versioned HMACs with source and catalog domains', () => {
    const key = createFingerprintKey('agent-only-secret', 'v7');
    const sourceBytes = Buffer.from('PORT=3100\n', 'utf8');
    const valueBytes = Buffer.from('3100', 'utf8');

    const source = fingerprintSource(key, 'source.pm2', sourceBytes);
    const valueA = fingerprintValue(key, 'edutrack.pm2_port', valueBytes);
    const valueB = fingerprintValue(key, 'other.pm2_port', valueBytes);

    expect(source).toMatch(/^hmac-sha256:v7:[a-f0-9]{64}$/u);
    expect(valueA).toMatch(/^hmac-sha256:v7:[a-f0-9]{64}$/u);
    expect(valueA).not.toBe(valueB);
    expect(valueA).not.toBe(`sha256:${createHash('sha256').update(valueBytes).digest('hex')}`);
    expect(hmacFingerprint(key, 'edutrack.pm2_port', valueBytes)).toBe(valueA);
  });

  test('changes output when the versioned fingerprint key rotates', () => {
    const bytes = Buffer.from('false', 'utf8');
    expect(fingerprintValue(createFingerprintKey('old-key', 'v1'), 'ops.flag', bytes)).not.toBe(
      fingerprintValue(createFingerprintKey('new-key', 'v2'), 'ops.flag', bytes)
    );
  });
});
