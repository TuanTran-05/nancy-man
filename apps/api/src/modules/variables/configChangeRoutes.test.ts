import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createConfigChangeRouter } from './configChangeRoutes.js';

const principal = {
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
  role: 'ops_viewer' as const
};
const digest = `hmac-sha256:v1:${'a'.repeat(64)}`;

function appFor() {
  const service = {
    createDraft: vi.fn(async () => ({
      changeId: '11111111-1111-4111-8111-111111111111',
      state: 'DRAFT',
      expiresAt: '2026-09-01T00:00:00.000Z'
    })),
    replaceItems: vi.fn(),
    validate: vi.fn(),
    save: vi.fn(),
    apply: vi.fn(async () => ({
      changeId: '11111111-1111-4111-8111-111111111111',
      runId: 'RUN_1',
      state: 'APPLYING'
    })),
    status: vi.fn(),
    cancel: vi.fn(),
    clearApplyBlock: vi.fn()
  };
  const stepUp = {
    grant: vi.fn(async () => ({ id: 'grant_1', expiresAt: '2026-08-31T13:15:00.000Z' })),
    consume: vi.fn(async () => true)
  };
  const session = { authorize: vi.fn(async () => principal) };
  const app = express();
  app.use(
    '/api/v1',
    createConfigChangeRouter({
      service: service as never,
      session,
      stepUp,
      hashClientIp: () => `sha256:${'b'.repeat(64)}`,
      allowedOrigin: 'https://man.thienuy.edu.vn'
    })
  );
  return { app, service, stepUp, session };
}

describe('config change routes', () => {
  it('streams value-free terminal progress and closes after completion', async () => {
    const value = appFor();
    value.service.status.mockResolvedValue({
      changeId: '11111111-1111-4111-8111-111111111111',
      state: 'COMPLETED',
      sequence: 1,
      events: [
        {
          eventId: 'EVT_done',
          changeId: '11111111-1111-4111-8111-111111111111',
          sequence: 1,
          state: 'COMPLETED',
          reasonCode: 'health_checks_passed',
          occurredAt: '2026-08-31T13:10:05.000Z'
        }
      ]
    });
    const response = await request(value.app)
      .get('/api/v1/config-changes/11111111-1111-4111-8111-111111111111/events')
      .set('Accept', 'text/event-stream');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: change');
    expect(response.text).not.toContain('value');
    expect(value.service.status).toHaveBeenCalledTimes(1);
  });

  it('consumes a digest-bound apply grant exactly once', async () => {
    const value = appFor();
    const auth = await request(value.app)
      .post('/api/v1/auth/variables/apply-authorization')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf')
      .set('User-Agent', 'test-agent')
      .send({ password: 'password', totpCode: '123456', changeDigest: digest });
    expect(auth.status).toBe(200);

    const body = { runId: 'RUN_1', changeDigest: digest, idempotencyKey: 'EVT_1' };
    await request(value.app)
      .post('/api/v1/config-changes/11111111-1111-4111-8111-111111111111/apply')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf')
      .send(body)
      .expect(202);
    await request(value.app)
      .post('/api/v1/config-changes/11111111-1111-4111-8111-111111111111/apply')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf')
      .send(body)
      .expect(401, { code: 'APPLY_AUTHORIZATION_REQUIRED' });
    expect(value.stepUp.consume).toHaveBeenCalledTimes(1);
    expect(value.service.apply).toHaveBeenCalledTimes(1);
  });

  it('rejects mutation requests from a different origin before session dispatch', async () => {
    const value = appFor();
    await request(value.app)
      .post('/api/v1/config-changes')
      .set('Origin', 'https://evil.invalid')
      .send({ appId: 'edutrack', reason: 'test reason' })
      .expect(403, { code: 'ORIGIN_DENIED' });
    expect(value.session.authorize).not.toHaveBeenCalled();
  });

  it('rejects mutation requests without CSRF before session dispatch', async () => {
    const value = appFor();
    await request(value.app)
      .post('/api/v1/config-changes')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .send({ appId: 'edutrack', reason: 'test reason' })
      .expect(403, { code: 'CSRF_REQUIRED' });
    expect(value.session.authorize).not.toHaveBeenCalled();
  });
});
