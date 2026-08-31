import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { signLegacyMonitoringRequest } from '../../../../../packages/contracts/src/legacyMonitoringProtocol.js';
import { createOpsStore } from '../storage/store.js';
import { createAuthService } from '../security/auth.js';
import { createOpsApp } from './app.js';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ops-internal-http-'));
  const now = new Date('2026-08-31T12:00:00.000Z');
  const key = Buffer.alloc(32, 7);
  const store = createOpsStore(join(directory, 'ops.sqlite'), () => now);
  const auth = createAuthService({ store, dataKey: key, now: () => now });
  return { directory, store, auth, now };
}

function signedRequest(input: {
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  userId?: string;
  role?: 'ops_owner' | 'ops_maintainer' | 'ops_viewer';
}) {
  const body = input.body ?? '';
  const userId = input.userId ?? 'canonical-owner-id';
  const role = input.role ?? 'ops_owner';
  const timestamp = '2026-08-31T12:00:00.000Z';
  const nonce = `nonce-${Math.random().toString(36).slice(2, 18)}`;
  const signature = signLegacyMonitoringRequest({
    secret: 'adapter-secret',
    method: input.method,
    path: input.path,
    timestamp,
    nonce,
    rawBody: body,
    userId,
    role
  });
  return {
    headers: {
      'X-Ops-Internal-Timestamp': timestamp,
      'X-Ops-Internal-Nonce': nonce,
      'X-Ops-Internal-Signature': signature,
      'X-Ops-Principal-Id': userId,
      'X-Ops-Principal-Role': role,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body
  };
}

describe('internal canonical monitoring adapter', () => {
  it('accepts only a valid signed loopback request and propagates principal to incident audit', async () => {
    const value = fixture();
    const incident = value.store.upsertIncident({
      dedupeKey: 'postgres:down',
      monitor: 'postgres',
      level: 'critical',
      state: 'open',
      recoveredAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      note: null,
      safeSummary: 'Database unavailable',
      now: value.now.toISOString()
    });
    const app = createOpsApp({
      store: value.store,
      auth: value.auth,
      internalMonitoring: { secret: 'adapter-secret', now: () => value.now }
    });
    try {
      await request(app)
        .get('/internal/v1/monitoring/overview')
        .set(signedRequest({ method: 'GET', path: '/internal/v1/monitoring/overview' }).headers)
        .expect(200);
      const body = JSON.stringify({ incidentId: incident.id, note: 'Đã kiểm tra' });
      const signed = signedRequest({
        method: 'POST',
        path: '/internal/v1/monitoring/incidents/ack',
        body,
        userId: 'canonical-owner-id'
      });
      await request(app)
        .post('/internal/v1/monitoring/incidents/ack')
        .set(signed.headers)
        .send(body)
        .expect(200)
        .expect(({ body: result }) => expect(result.acknowledgedBy).toBe('canonical-owner-id'));
      expect(value.store.listAuditEvents()).toContainEqual(
        expect.objectContaining({ actorId: 'canonical-owner-id', action: 'incident_acknowledged' })
      );

      await request(app)
        .get('/internal/v1/monitoring/overview')
        .set('X-Ops-Principal-Id', 'canonical-owner-id')
        .set('X-Ops-Principal-Role', 'ops_owner')
        .expect(401);
    } finally {
      value.store.getDatabaseForBackup().close();
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('does not expose a cookie-only internal request and rejects altered paths', async () => {
    const value = fixture();
    const app = createOpsApp({
      store: value.store,
      auth: value.auth,
      internalMonitoring: { secret: 'adapter-secret', now: () => value.now }
    });
    try {
      await request(app)
        .get('/internal/v1/monitoring/overview')
        .set('Cookie', '__Host-ops_session=legacy-cookie')
        .expect(401);
      const signed = signedRequest({ method: 'GET', path: '/internal/v1/monitoring/overview' });
      await request(app)
        .get('/internal/v1/monitoring/not-allowed')
        .set(signed.headers)
        .expect(404);
    } finally {
      value.store.getDatabaseForBackup().close();
      rmSync(value.directory, { recursive: true, force: true });
    }
  });
});
