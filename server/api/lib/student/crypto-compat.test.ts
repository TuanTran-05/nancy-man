import { describe, it, expect } from 'vitest';
import { createHash, pbkdf2Sync } from 'crypto';

/**
 * Cross-compatibility tests: verify that passwords hashed with Web Crypto API
 * (client-side) can be verified with Node.js crypto (server-side) and vice versa.
 *
 * This is critical because:
 * - Client uses crypto.subtle (Web Crypto) in studentPasswordCryptoV2.ts
 * - Server uses crypto.pbkdf2Sync (Node) in api/student/reset-password.ts and api/auth/verify-student-login.ts
 */

// Client-side hash function (mirrors studentPasswordCryptoV2.ts)
async function clientHash(password: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.randomUUID();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  return { salt, hash: hashHex };
}

// Server-side verify function (mirrors api/student/reset-password.ts)
function serverVerify(password: string, salt: string, hash: string): boolean {
  const derived = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  return derived.toString('hex') === hash;
}

// Server-side hash function (mirrors api/student/reset-password.ts)
function serverHash(password: string): { salt: string; hash: string } {
  const salt = crypto.randomUUID();
  const derived = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  const hash = derived.toString('hex');
  return { salt, hash };
}

// Client-side verify function (mirrors studentPasswordCryptoV2.ts)
async function clientVerify(password: string, salt: string, hash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex === hash;
}

describe('Crypto cross-compatibility (Web Crypto <-> Node crypto)', () => {
  it('client hash → server verify should succeed', async () => {
    const { salt, hash } = await clientHash('TestPassword1');
    expect(serverVerify('TestPassword1', salt, hash)).toBe(true);
  });

  it('server hash → client verify should succeed', async () => {
    const { salt, hash } = serverHash('TestPassword1');
    expect(await clientVerify('TestPassword1', salt, hash)).toBe(true);
  });

  it('client hash → server verify should fail with wrong password', async () => {
    const { salt, hash } = await clientHash('TestPassword1');
    expect(serverVerify('WrongPassword1', salt, hash)).toBe(false);
  });

  it('server hash → client verify should fail with wrong password', async () => {
    const { salt, hash } = serverHash('TestPassword1');
    expect(await clientVerify('WrongPassword1', salt, hash)).toBe(false);
  });

  it('same salt + password should produce same hash regardless of API', async () => {
    const salt = 'fixed-salt-for-testing';
    const password = 'MySecure1';

    // Client-side hash
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100_000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const clientHashHex = Array.from(new Uint8Array(bits), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');

    // Server-side hash
    const serverHashHex = pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');

    expect(clientHashHex).toBe(serverHashHex);
  });
});

describe('Legacy SHA-256 verification compatibility', () => {
  it('legacy client hash should be verifiable by server', async () => {
    // Legacy client hash (SHA-256)
    const salt = crypto.randomUUID();
    const encoder = new TextEncoder();
    const data = encoder.encode('TestPassword1' + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const clientHashHex = Array.from(new Uint8Array(hashBuffer), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');

    // Server-side legacy verify
    const serverHashHex = createHash('sha256')
      .update('TestPassword1' + salt)
      .digest('hex');

    expect(clientHashHex).toBe(serverHashHex);
  });
});
