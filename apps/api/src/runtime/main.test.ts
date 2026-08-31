import { describe, expect, it } from 'vitest';

import { resolveRuntimeCredentials } from './main.js';

const config = {
  apiHost: '127.0.0.1' as const,
  apiPort: 3100,
  publicUrl: 'https://man.thienuy.edu.vn' as const,
  secretDirectory: '/run/credentials/edutrack-ops-api.service',
  databaseUrlReference: 'ops-database-url',
  sessionPepperReference: 'ops-session-pepper',
  rateLimitPepperReference: 'ops-rate-limit-pepper',
  authSessionPepperReference: 'ops-auth-session-pepper',
  mfaEncryptionKeyReference: 'ops-mfa-encryption-key',
  passwordFingerprintPepperReference: 'ops-password-fingerprint-pepper',
  browserContextKey: {
    id: 'edutrack-browser-v1',
    secretReference: 'browser-context-edutrack-v1'
  },
  objectStoreDirectory: '/var/lib/edutrack-ops/object-store',
  browserCorsOrigins: ['https://thienuy.edu.vn'],
  sqlWorker: { enabled: false as const }
};

describe('resolveRuntimeCredentials', () => {
  it('loads all required credentials before starting the Ops API', async () => {
    const requested: string[] = [];

    await expect(
      resolveRuntimeCredentials({
        config,
        resolveSecret: async (reference) => {
          requested.push(reference);
          if (reference === 'ops-mfa-encryption-key')
            return Buffer.alloc(32, 7).toString('base64url');
          return `value-for-${reference}`;
        }
      })
    ).resolves.toEqual({
      databaseUrl: 'value-for-ops-database-url',
      sessionPepper: 'value-for-ops-session-pepper',
      rateLimitPepper: 'value-for-ops-rate-limit-pepper',
      browserContextKey: 'value-for-browser-context-edutrack-v1',
      authSessionPepper: 'value-for-ops-auth-session-pepper',
      passwordFingerprintPepper: 'value-for-ops-password-fingerprint-pepper',
      mfaEncryptionKey: expect.any(Buffer)
    });
    expect(requested.sort()).toEqual([
      'browser-context-edutrack-v1',
      'ops-auth-session-pepper',
      'ops-database-url',
      'ops-mfa-encryption-key',
      'ops-password-fingerprint-pepper',
      'ops-rate-limit-pepper',
      'ops-session-pepper'
    ]);
  });

  it('fails closed without putting a missing credential reference in the startup error', async () => {
    await expect(
      resolveRuntimeCredentials({
        config,
        resolveSecret: async (reference) =>
          reference === 'ops-database-url' ? 'postgres://ops:password@localhost/ops' : null
      })
    ).rejects.toThrow('Ops API runtime credentials are unavailable');
  });

  it('resolves the SQL worker HMAC only when the private worker client is enabled', async () => {
    await expect(
      resolveRuntimeCredentials({
        config: {
          ...config,
          sqlWorker: {
            enabled: true,
            socketPath: '/run/edutrack-ops/sql-worker.sock',
            hmacSecretReference: 'ops-sql-worker-hmac',
            auditEncryptionKeyReference: 'ops-sql-audit-encryption-key'
          }
        },
        resolveSecret: async (reference) => {
          if (
            reference === 'ops-mfa-encryption-key' ||
            reference === 'ops-sql-audit-encryption-key'
          )
            return Buffer.alloc(32, 7).toString('base64url');
          return `value-for-${reference}`;
        }
      })
    ).resolves.toMatchObject({
      sqlWorker: {
        socketPath: '/run/edutrack-ops/sql-worker.sock',
        hmacSecret: 'value-for-ops-sql-worker-hmac',
        auditEncryptionKey: expect.any(Buffer)
      }
    });
  });
});
