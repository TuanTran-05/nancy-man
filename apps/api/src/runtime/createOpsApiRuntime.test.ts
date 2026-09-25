import { describe, expect, it } from 'vitest';

import { signServerIngestRequest } from '../modules/ingest/hmac.js';
import {
  createCsrfToken,
  deriveCsrfSecret,
  hashCsrfSecret
} from '../../../../packages/security/src/sessions.js';

import { createOpsApiRuntime } from './createOpsApiRuntime.js';

function createDatabase(options: { activeSession?: unknown } = {}) {
  const queries: string[] = [];
  let nonceConsumed = false;

  async function query<T>(sql: string) {
    queries.push(sql);
    if (sql.includes('FROM ops_sessions AS session') && options.activeSession) {
      return { rows: [options.activeSession] as T[] };
    }
    if (sql.includes("client_kind IN ('server', 'worker', 'synthetic')")) {
      return {
        rows: [
          {
            id: '8d771951-51be-451a-9c34-c77e32a7303d',
            clientKind: 'server',
            status: 'active',
            secretReference: 'ingest-edutrack-api'
          }
        ] as T[]
      };
    }
    if (sql.includes('INSERT INTO ingest_nonces')) {
      if (nonceConsumed) return { rows: [] as T[] };
      nonceConsumed = true;
      return { rows: [{ nonceHash: 'a'.repeat(64) }] as T[] };
    }
    if (sql.includes('INSERT INTO ingest_idempotency')) {
      return {
        rows: [
          {
            eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
            payloadHash: 'a'.repeat(64)
          }
        ] as T[]
      };
    }
    return { rows: [] as T[] };
  }

  return {
    queries,
    query,
    transaction: async <T>(operation: (database: { query: typeof query }) => Promise<T>) =>
      operation({ query })
  };
}

async function withServer(
  app: ReturnType<typeof createOpsApiRuntime>['app'],
  action: (origin: string) => Promise<void>
) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
  try {
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

describe('createOpsApiRuntime', () => {
  it('starts without running migrations and wires server ingestion to persistent replay protection', async () => {
    const database = createDatabase();
    const runtime = createOpsApiRuntime({
      config: {
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
        sqlWorker: { enabled: false },
        configAgent: { enabled: false }
      },
      database,
      sessionPepper: 'session-pepper',
      rateLimitPepper: 'rate-limit-pepper',
      browserContextKey: 'browser-context-key',
      authSessionPepper: 'auth-session-pepper',
      mfaEncryptionKey: Buffer.alloc(32, 7),
      passwordFingerprintPepper: 'password-fingerprint-pepper',
      legacyMonitoringHmacSecret: 'legacy-monitoring-hmac-secret',
      resolveSecret: async (reference) =>
        reference === 'ingest-edutrack-api' ? 'server-ingest-key' : null
    });
    expect(runtime.app.get('trust proxy')).toBe('loopback');

    await withServer(runtime.app, async (origin) => {
      const health = await fetch(`${origin}/healthz`);
      expect(health.status).toBe(200);
      expect(database.queries.join('\n')).not.toContain('ops_schema_migrations');

      const body = JSON.stringify({
        schemaVersion: 1,
        eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
        idempotencyKey: 'idem-0123456789abcdef',
        capturedAt: '2026-08-22T10:00:00.000Z',
        source: 'api',
        level: 'error',
        error: { name: 'Error', code: 'API_FAILURE', safeMessage: 'A request failed' },
        context: {
          service: 'edutrack-api',
          environment: 'production',
          release: '0123456789abcdef0123456789abcdef01234567'
        }
      });
      const signed = {
        secret: 'server-ingest-key',
        method: 'POST',
        path: '/api/v1/ingest/server',
        timestamp: new Date().toISOString(),
        nonce: 'nonce-0123456789abcdef',
        rawBody: body
      };
      const headers = {
        'Content-Type': 'application/json',
        'X-Ops-Key-Id': 'edutrack-api',
        'X-Ops-Timestamp': signed.timestamp,
        'X-Ops-Nonce': signed.nonce,
        'X-Ops-Signature': signServerIngestRequest(signed)
      };

      const accepted = await fetch(`${origin}/api/v1/ingest/server`, {
        method: 'POST',
        headers,
        body
      });
      expect(accepted.status).toBe(202);
      await expect(accepted.json()).resolves.toMatchObject({ accepted: true });

      const replay = await fetch(`${origin}/api/v1/ingest/server`, {
        method: 'POST',
        headers,
        body
      });
      expect(replay.status).toBe(401);
      await expect(replay.json()).resolves.toEqual({ accepted: false, code: 'REPLAYED_NONCE' });
    });
  });

  it('revokes database PII grants as part of authenticated logout teardown', async () => {
    const sessionToken = 'test-session-token-01234567890123456789';
    const sessionId = '3a86a2e4-4f07-4ce5-a5fc-0cc0e03ea526';
    const authSessionPepper = 'auth-session-pepper';
    const csrfSecret = deriveCsrfSecret({ sessionToken, csrfPepper: authSessionPepper });
    const database = createDatabase({
      activeSession: {
        id: sessionId,
        userId: '07de3aa9-572c-4c24-b761-4bb2727777e8',
        sessionHash: 'a'.repeat(64),
        csrfSecretHash: hashCsrfSecret(csrfSecret),
        role: 'ops_maintainer',
        lastActivityAt: new Date().toISOString(),
        idleExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString()
      }
    });
    const runtime = createOpsApiRuntime({
      config: {
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
        sqlWorker: { enabled: false },
        configAgent: { enabled: false }
      },
      database,
      sessionPepper: 'session-pepper',
      rateLimitPepper: 'rate-limit-pepper',
      browserContextKey: 'browser-context-key',
      authSessionPepper,
      mfaEncryptionKey: Buffer.alloc(32, 7),
      passwordFingerprintPepper: 'password-fingerprint-pepper',
      legacyMonitoringHmacSecret: 'legacy-monitoring-hmac-secret',
      resolveSecret: async () => null
    });

    await withServer(runtime.app, async (origin) => {
      const response = await fetch(`${origin}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: `__Host-ops-session=${sessionToken}`,
          'X-Ops-CSRF': createCsrfToken({ sessionId, csrfSecret })
        }
      });
      expect(response.status).toBe(204);
    });

    const piiRevokeIndex = database.queries.findIndex(
      (sql) =>
        sql.includes('UPDATE ops_secret_elevations') && sql.includes("capability = 'database_pii'")
    );
    const sessionRevokeIndex = database.queries.findIndex(
      (sql) => sql.includes('UPDATE ops_sessions') && sql.includes('revoked_reason')
    );
    expect(piiRevokeIndex).toBeGreaterThanOrEqual(0);
    expect(sessionRevokeIndex).toBeGreaterThan(piiRevokeIndex);
  });
});
