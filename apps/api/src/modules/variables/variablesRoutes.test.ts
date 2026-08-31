import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createVariablesRouter } from './variablesRoutes.js';

const principal = {
  sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  role: 'ops_owner' as const
};
const inventory = {
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  generatedAt: '2026-08-31T13:12:00.000Z',
  items: []
};
const catalog = { catalogVersion: '2026-08-31', entries: [], validators: [], consumers: [], precedences: [] };

function appFor(overrides: Record<string, unknown> = {}) {
  const client = { readInventory: vi.fn(async () => inventory) };
  const service = {
    getCatalog: vi.fn(async () => catalog),
    read: vi.fn(async () => inventory),
    ...(overrides.service as Record<string, unknown> | undefined)
  };
  const stepUp = {
    grant: vi.fn(async () => ({ id: 'grant-id', expiresAt: '2026-08-31T13:20:00.000Z' })),
    authorize: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
    ...(overrides.stepUp as Record<string, unknown> | undefined)
  };
  const session = {
    authorize: vi.fn(async ({ mutation }: { mutation: boolean }) =>
      mutation === true || mutation === false ? principal : null
    ),
    ...(overrides.session as Record<string, unknown> | undefined)
  };
  const app = express();
  app.use('/api/v1', createVariablesRouter({
    service: service as never,
    session: session as never,
    stepUp: stepUp as never,
    client: client as never,
    hashClientIp: () => 'a'.repeat(64),
    rateLimiter: { allow: vi.fn(async () => true) },
    ...(overrides as never)
  }));
  return { app, client, service, stepUp, session };
}

describe('variables routes', () => {
  it('lets every active Ops role unlock through canonical origin, CSRF, and reusable step-up without a browser credential', async () => {
    for (const role of ['ops_viewer', 'ops_maintainer', 'ops_owner'] as const) {
      const value = appFor({
        session: { authorize: vi.fn(async () => ({ ...principal, role })) }
      });
      const response = await request(value.app)
        .post('/api/v1/auth/variables/unlock')
        .set('Origin', 'https://man.thienuy.edu.vn')
        .set('X-Ops-CSRF', 'csrf-token')
        .set('User-Agent', 'test-agent')
        .send({ password: 'current-password', totpCode: '123456' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ unlockedUntil: '2026-08-31T13:20:00.000Z' });
      expect(response.headers['cache-control']).toBe('no-store, private');
      expect(response.headers.pragma).toBe('no-cache');
      expect(response.headers.vary).toBe('Cookie');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(value.stepUp.grant).toHaveBeenCalledWith(expect.objectContaining({
        capability: 'variables_secret',
        userId: principal.userId,
        sessionId: principal.sessionId,
        password: 'current-password',
        totpCode: '123456'
      }));
    }
  });

  it('rejects missing origin/CSRF, rate limits, and invalid step-up before any inventory access', async () => {
    const rateLimiter = { allow: vi.fn(async () => false) };
    const value = appFor({ rateLimiter });
    await request(value.app)
      .post('/api/v1/auth/variables/unlock')
      .set('X-Ops-CSRF', 'csrf-token')
      .send({ password: 'current-password', totpCode: '123456' })
      .expect(403);
    await request(value.app)
      .post('/api/v1/auth/variables/unlock')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .send({ password: 'current-password', totpCode: '123456' })
      .expect(403);
    const limited = await request(value.app)
      .post('/api/v1/auth/variables/unlock')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf-token')
      .send({ password: 'current-password', totpCode: '123456' });
    expect(limited.status).toBe(429);
    expect(value.stepUp.grant).not.toHaveBeenCalled();
    expect(value.client.readInventory).not.toHaveBeenCalled();
  });

  it('requires the reusable capability for values, keeps catalog value-free, and revokes idempotently', async () => {
    const value = appFor();
    await request(value.app).get('/api/v1/variables/catalog').expect(200, catalog);
    expect(value.client.readInventory).not.toHaveBeenCalled();

    await request(value.app).get('/api/v1/variables').expect(401, { code: 'STEP_UP_REQUIRED' });
    await request(value.app)
      .post('/api/v1/auth/variables/unlock')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf-token')
      .send({ password: 'current-password', totpCode: '123456' })
      .expect(200);
    const response = await request(value.app).get('/api/v1/variables');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers.vary).toBe('Cookie');
    expect(response.body).toEqual(inventory);
    expect(value.service.read).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ userId: principal.userId, sessionId: principal.sessionId })
    }));

    await request(value.app)
      .delete('/api/v1/auth/variables/unlock')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf-token')
      .expect(204);
    await request(value.app)
      .delete('/api/v1/auth/variables/unlock')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf-token')
      .expect(204);
    expect(value.stepUp.revoke).toHaveBeenCalledTimes(1);
    await request(value.app).get('/api/v1/variables').expect(401);
  });

  it('maps agent failures to stable value-free errors', async () => {
    const value = appFor({
      service: { read: vi.fn(async () => { throw new Error('AGENT_RESPONSE_SECRET_VALUE'); }) }
    });
    await request(value.app)
      .post('/api/v1/auth/variables/unlock')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf-token')
      .send({ password: 'current-password', totpCode: '123456' })
      .expect(200);
    const response = await request(value.app).get('/api/v1/variables');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'CONFIG_AGENT_UNAVAILABLE' });
    expect(JSON.stringify(response.body)).not.toContain('AGENT_RESPONSE_SECRET_VALUE');
  });
});
