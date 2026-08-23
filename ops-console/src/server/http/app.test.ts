import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createOpsStore } from '../storage/store.js';
import { createAuthService, provisionAccount } from '../security/auth.js';
import { createOpsApp } from './app.js';

const makeFixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'ops-http-'));
  const now = new Date(59_000);
  const store = createOpsStore(join(directory, 'ops.sqlite'), () => now);
  const key = Buffer.alloc(32, 7);
  provisionAccount(store, { username: 'ops-a', password: 'correct horse battery staple', totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }, key, now);
  const auth = createAuthService({ store, dataKey: key, now: () => now });
  return { directory, store, app: createOpsApp({ store, auth }), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
};

describe('protected Ops HTTP API', () => {
  it('denies monitoring API without an Ops session', async () => {
    const fixture = makeFixture();
    try { await request(fixture.app).get('/api/overview').expect(401); } finally { fixture.cleanup(); }
  });

  it('logs in with password plus TOTP and sets a secure host-only cookie', async () => {
    const fixture = makeFixture();
    try {
      const response = await request(fixture.app).post('/api/session').send({ username: 'ops-a', password: 'correct horse battery staple', totp: '287082' }).expect(201);
      expect(response.headers['set-cookie'][0]).toMatch(/__Host-ops_session=.*Secure.*HttpOnly.*SameSite=Strict/);
      expect(response.body).toMatchObject({ username: 'ops-a', csrfToken: expect.any(String) });
    } finally { fixture.cleanup(); }
  });

  it('rejects an acknowledge request without the session CSRF token', async () => {
    const fixture = makeFixture();
    try {
      const incident = fixture.store.upsertIncident({ dedupeKey: 'postgres:database_unreachable', monitor: 'postgres', level: 'critical', state: 'open', recoveredAt: null, acknowledgedAt: null, acknowledgedBy: null, note: null, safeSummary: 'Database unavailable', now: '2026-08-23T00:00:00Z' });
      const login = await request(fixture.app).post('/api/session').send({ username: 'ops-a', password: 'correct horse battery staple', totp: '287082' }).expect(201);
      const cookie = login.headers['set-cookie'][0].split(';')[0];
      await request(fixture.app).post(`/api/incidents/${incident.id}/ack`).set('Cookie', cookie).send({ note: 'Đã xem' }).expect(403);
      await request(fixture.app).post(`/api/incidents/${incident.id}/ack`).set('Cookie', cookie).set('X-CSRF-Token', login.body.csrfToken).send({ note: 'Đã xem' }).expect(200);
    } finally { fixture.cleanup(); }
  });
});
