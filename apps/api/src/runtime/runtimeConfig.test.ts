import { describe, expect, it } from 'vitest';

import { readOpsRuntimeConfig } from './runtimeConfig.js';

const validEnvironment = {
  OPS_API_HOST: '127.0.0.1',
  OPS_API_PORT: '3100',
  OPS_PUBLIC_URL: 'https://man.thienuy.edu.vn',
  OPS_SECRET_DIRECTORY: '/run/credentials/edutrack-ops-api.service',
  OPS_DATABASE_URL_REFERENCE: 'ops-database-url',
  OPS_SESSION_PEPPER_REFERENCE: 'ops-session-pepper',
  OPS_RATE_LIMIT_PEPPER_REFERENCE: 'ops-rate-limit-pepper',
  OPS_AUTH_SESSION_PEPPER_REFERENCE: 'ops-auth-session-pepper',
  OPS_MFA_ENCRYPTION_KEY_REFERENCE: 'ops-mfa-encryption-key',
  OPS_PASSWORD_FINGERPRINT_PEPPER_REFERENCE: 'ops-password-fingerprint-pepper',
  OPS_LEGACY_MONITORING_HMAC_REFERENCE: 'ops-legacy-monitoring-hmac',
  OPS_BROWSER_CONTEXT_KEY_ID: 'edutrack-browser-v1',
  OPS_BROWSER_CONTEXT_KEY_REFERENCE: 'browser-context-edutrack-v1',
  OPS_OBJECT_STORE_DIRECTORY: '/var/lib/edutrack-ops/object-store',
  OPS_BROWSER_CORS_ORIGINS: 'https://thienuy.edu.vn',
  OPS_SQL_WORKER_ENABLED: 'false'
};

describe('readOpsRuntimeConfig', () => {
  it('accepts a loopback-only collector configuration with credential references', () => {
    expect(readOpsRuntimeConfig(validEnvironment)).toEqual({
      apiHost: '127.0.0.1',
      apiPort: 3100,
      publicUrl: 'https://man.thienuy.edu.vn',
      secretDirectory: '/run/credentials/edutrack-ops-api.service',
      databaseUrlReference: 'ops-database-url',
      sessionPepperReference: 'ops-session-pepper',
      rateLimitPepperReference: 'ops-rate-limit-pepper',
      authSessionPepperReference: 'ops-auth-session-pepper',
      mfaEncryptionKeyReference: 'ops-mfa-encryption-key',
      passwordFingerprintPepperReference: 'ops-password-fingerprint-pepper',
      legacyMonitoringHmacReference: 'ops-legacy-monitoring-hmac',
      browserContextKey: {
        id: 'edutrack-browser-v1',
        secretReference: 'browser-context-edutrack-v1'
      },
      objectStoreDirectory: '/var/lib/edutrack-ops/object-store',
      browserCorsOrigins: ['https://thienuy.edu.vn'],
      sqlWorker: { enabled: false }
    });
  });

  it('refuses a non-loopback listener that would expose the Node API directly', () => {
    expect(() => readOpsRuntimeConfig({ ...validEnvironment, OPS_API_HOST: '0.0.0.0' })).toThrow(
      /loopback/i
    );
  });

  it('refuses a raw database URL in the environment instead of a secure credential reference', () => {
    expect(() =>
      readOpsRuntimeConfig({
        ...validEnvironment,
        OPS_DATABASE_URL: 'postgres://ops:secret@127.0.0.1/edutrack_ops'
      })
    ).toThrow(/credential reference/i);
  });

  it('refuses wildcard, non-HTTPS, and path-based browser origins', () => {
    for (const origin of ['*', 'http://thienuy.edu.vn', 'https://thienuy.edu.vn/telemetry']) {
      expect(() =>
        readOpsRuntimeConfig({ ...validEnvironment, OPS_BROWSER_CORS_ORIGINS: origin })
      ).toThrow(/origin/i);
    }
  });

  it('refuses automatic migrations at API startup', () => {
    expect(() => readOpsRuntimeConfig({ ...validEnvironment, OPS_AUTO_MIGRATE: 'true' })).toThrow(
      /migration/i
    );
  });

  it('requires a private socket and credential reference before enabling the SQL worker client', () => {
    expect(
      readOpsRuntimeConfig({
        ...validEnvironment,
        OPS_SQL_WORKER_ENABLED: 'true',
        OPS_SQL_SOCKET_PATH: '/run/edutrack-ops/sql-worker.sock',
        OPS_SQL_WORKER_HMAC_REFERENCE: 'ops-sql-worker-hmac',
        OPS_SQL_AUDIT_ENCRYPTION_KEY_REFERENCE: 'ops-sql-audit-encryption-key'
      })
    ).toMatchObject({
      sqlWorker: {
        enabled: true,
        socketPath: '/run/edutrack-ops/sql-worker.sock',
        hmacSecretReference: 'ops-sql-worker-hmac',
        auditEncryptionKeyReference: 'ops-sql-audit-encryption-key'
      }
    });
  });

  it('requires a dedicated password fingerprint pepper reference', () => {
    const environment = { ...validEnvironment };
    delete (environment as Record<string, string | undefined>)[
      'OPS_PASSWORD_FINGERPRINT_PEPPER_REFERENCE'
    ];
    expect(() => readOpsRuntimeConfig(environment)).toThrow(/PASSWORD_FINGERPRINT/);
  });
});
