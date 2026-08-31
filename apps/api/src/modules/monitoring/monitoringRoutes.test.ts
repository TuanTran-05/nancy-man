import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMonitoringRouter } from './monitoringRoutes.js';

const principal = {
  sessionId: 'session-id',
  userId: 'canonical-owner-id',
  username: 'tuan.dev',
  displayName: 'Tuan Dev',
  role: 'ops_owner' as const
};

function appFor(
  input: { principal?: typeof principal | null; client?: Record<string, unknown> } = {}
) {
  const client = {
    getOverview: vi.fn(async () => ({
      collectedAt: null,
      latestByMonitor: {},
      openIncidents: [],
      recentDeliveries: []
    })),
    getInfrastructureHistory: vi.fn(async () => ({
      range: '24h',
      resolutionSeconds: 300,
      collectedAt: '2026-08-31T12:00:00.000Z',
      points: []
    })),
    acknowledgeIncident: vi.fn(async (value) => ({
      id: value.incidentId,
      acknowledgedBy: value.userId
    })),
    getZaloLink: vi.fn(async () => ({ linked: false })),
    createZaloLinkCode: vi.fn(async () => ({
      code: '123456',
      command: '/link 123456',
      expiresAt: '2026-08-31T12:10:00.000Z'
    })),
    disableZaloLink: vi.fn(async () => undefined),
    ...input.client
  };
  const app = express();
  app.use(
    '/api/v1',
    createMonitoringRouter({
      client: client as never,
      session: {
        authorize: async () => (input.principal === undefined ? principal : input.principal)
      },
      allowedOrigin: 'https://man.thienuy.edu.vn'
    })
  );
  return { app, client };
}

describe('canonical monitoring routes', () => {
  it('requires the canonical session and forwards the authenticated principal to the adapter', async () => {
    const denied = appFor({ principal: null });
    await request(denied.app).get('/api/v1/monitoring/overview').expect(401);
    expect(denied.client.getOverview).not.toHaveBeenCalled();

    const value = appFor();
    await request(value.app).get('/api/v1/monitoring/overview').expect(200);
    await request(value.app).get('/api/v1/monitoring/infrastructure/history?range=24h').expect(200);
    expect(value.client.getOverview).toHaveBeenCalledWith({
      userId: principal.userId,
      role: principal.role
    });
    expect(value.client.getInfrastructureHistory).toHaveBeenCalledWith({
      userId: principal.userId,
      role: principal.role,
      range: '24h'
    });
  });

  it('requires origin and CSRF for mutation and sends no step-up secret or session token upstream', async () => {
    const value = appFor();
    await request(value.app)
      .post('/api/v1/monitoring/incidents/incident-id/ack')
      .set('Origin', 'https://evil.example')
      .set('X-Ops-CSRF', 'csrf')
      .send({ note: 'Đã xem' })
      .expect(403);
    await request(value.app)
      .post('/api/v1/monitoring/incidents/incident-id/ack')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .send({ note: 'Đã xem' })
      .expect(403);
    await request(value.app)
      .post('/api/v1/monitoring/incidents/incident-id/ack')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf')
      .send({ note: 'Đã xem' })
      .expect(200);
    expect(value.client.acknowledgeIncident).toHaveBeenCalledWith({
      userId: principal.userId,
      role: principal.role,
      incidentId: 'incident-id',
      note: 'Đã xem'
    });
  });

  it('serves canonical Zalo link operations through the same principal boundary', async () => {
    const value = appFor();
    await request(value.app).get('/api/v1/zalo/link').expect(200);
    await request(value.app)
      .post('/api/v1/zalo/link-code')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf')
      .send({})
      .expect(201);
    await request(value.app)
      .delete('/api/v1/zalo/link')
      .set('Origin', 'https://man.thienuy.edu.vn')
      .set('X-Ops-CSRF', 'csrf')
      .expect(204);
    expect(value.client.getZaloLink).toHaveBeenCalledWith({
      userId: principal.userId,
      role: principal.role
    });
    expect(value.client.createZaloLinkCode).toHaveBeenCalledWith({
      userId: principal.userId,
      role: principal.role
    });
    expect(value.client.disableZaloLink).toHaveBeenCalledWith({
      userId: principal.userId,
      role: principal.role
    });
  });
});
