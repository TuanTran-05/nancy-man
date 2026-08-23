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

const makeZaloFixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'ops-zalo-http-'));
  const now = new Date(59_000);
  const store = createOpsStore(join(directory, 'ops.sqlite'), () => now);
  const key = Buffer.alloc(32, 7);
  provisionAccount(store, { username: 'ops-a', password: 'correct horse battery staple', totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }, key, now);
  const auth = createAuthService({ store, dataKey: key, now: () => now });
  const sent: Array<{ recipientId: string; text: string }> = [];
  const app = createOpsApp({
    store,
    auth,
    zalo: {
      store,
      auth,
      config: {
        botToken: 'bot-secret',
        webhookSecret: 'w'.repeat(32),
        linkCodePepper: 'p'.repeat(32),
        chatHashSecret: 'h'.repeat(32),
        recipientKey: Buffer.alloc(32, 8),
        timeoutMs: 5000,
        linkTtlSeconds: 600,
      },
      now: () => now,
      confirmationSender: async (config, text) => { sent.push({ recipientId: config.recipientId, text }); return { messageId: 'reply-1' }; },
    },
  });
  return { directory, store, app, sent, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
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

  it('links only through the separate Ops bot webhook and keeps replay idempotent', async () => {
    const fixture = makeZaloFixture();
    try {
      const login = await request(fixture.app).post('/api/session').send({ username: 'ops-a', password: 'correct horse battery staple', totp: '287082' }).expect(201);
      const cookie = login.headers['set-cookie'][0].split(';')[0];
      await request(fixture.app).get('/api/zalo/link').set('Cookie', cookie).expect(200).expect(({ body }) => expect(body).toEqual({ linked: false }));
      await request(fixture.app).post('/api/zalo/link-code').set('Cookie', cookie).send({}).expect(403);
      const codeResponse = await request(fixture.app).post('/api/zalo/link-code').set('Cookie', cookie).set('X-CSRF-Token', login.body.csrfToken).send({}).expect(201);
      await request(fixture.app).post('/api/zalo-bot/webhook').set('X-Bot-Api-Secret-Token', 'wrong').send({}).expect(403);
      const payload = { event_name: 'message.text.received', message: { from: { id: 'chat-123' }, chat: { id: 'chat-123', chat_type: 'PRIVATE' }, text: codeResponse.body.command, message_id: 'message-1' } };
      await request(fixture.app).post('/api/zalo-bot/webhook').set('X-Bot-Api-Secret-Token', 'w'.repeat(32)).send(payload).expect(200).expect(({ body }) => expect(body).toEqual({ success: true }));
      await request(fixture.app).post('/api/zalo-bot/webhook').set('X-Bot-Api-Secret-Token', 'w'.repeat(32)).send(payload).expect(200).expect(({ body }) => expect(body).toEqual({ success: true }));
      await request(fixture.app).get('/api/zalo/link').set('Cookie', cookie).expect(200).expect(({ body }) => expect(body.linked).toBe(true));
      expect(fixture.sent).toEqual([{ recipientId: 'chat-123', text: expect.stringContaining('Đã liên kết') }]);
    } finally { fixture.cleanup(); }
  });
});
