import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { OpsRole } from '../../../../../packages/security/src/sessions.js';
import type { LegacyMonitoringClient } from './legacyMonitoringClient.js';

type Principal = {
  sessionId: string;
  userId: string;
  role: OpsRole;
  username?: string;
  displayName?: string;
};
type MonitoringClient = Pick<
  LegacyMonitoringClient,
  | 'getOverview'
  | 'getInfrastructureHistory'
  | 'acknowledgeIncident'
  | 'getZaloLink'
  | 'createZaloLinkCode'
  | 'disableZaloLink'
>;

const noteSchema = z.object({ note: z.string().min(1).max(500) }).strict();
const rangeSchema = z.enum(['1h', '24h', '7d', '30d']);

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message === 'LEGACY_MONITORING_UNAVAILABLE'
    ? 'MONITORING_UNAVAILABLE'
    : 'MONITORING_REQUEST_FAILED';
}

function adapterPrincipal(value: Principal): { userId: string; role: OpsRole } {
  return { userId: value.userId, role: value.role };
}

export function createMonitoringRouter(input: {
  client: MonitoringClient;
  session: {
    authorize: (input: {
      cookieHeader?: string;
      csrfToken?: string;
      mutation: boolean;
    }) => Promise<Principal | null>;
  };
  allowedOrigin?: string;
}): Router {
  const router = express.Router();
  router.use(express.json({ limit: '16kb', strict: true }));
  const allowedOrigin = input.allowedOrigin ?? 'https://man.thienuy.edu.vn';

  async function principal(
    request: Request,
    response: Response,
    mutation: boolean
  ): Promise<Principal | null> {
    noStore(response);
    if (mutation && request.get('origin') !== allowedOrigin) {
      response.status(403).json({ code: 'ORIGIN_DENIED' });
      return null;
    }
    if (mutation && !request.get('X-Ops-CSRF')) {
      response.status(403).json({ code: 'CSRF_REQUIRED' });
      return null;
    }
    const authorizeInput: { mutation: boolean; cookieHeader?: string; csrfToken?: string } = {
      mutation
    };
    const cookieHeader = request.get('cookie');
    const csrfToken = request.get('X-Ops-CSRF');
    if (cookieHeader) authorizeInput.cookieHeader = cookieHeader;
    if (csrfToken) authorizeInput.csrfToken = csrfToken;
    const value = await input.session.authorize(authorizeInput);
    if (!value) {
      response.status(401).json({ code: 'AUTH_DENIED' });
      return null;
    }
    return value;
  }

  async function proxy(response: Response, operation: () => Promise<unknown>): Promise<void> {
    try {
      response.status(200).json(await operation());
    } catch (error) {
      response.status(503).json({ code: errorCode(error) });
    }
  }

  router.get('/monitoring/overview', async (request, response) => {
    const value = await principal(request, response, false);
    if (value) await proxy(response, () => input.client.getOverview(adapterPrincipal(value)));
  });
  router.get('/monitoring/infrastructure/history', async (request, response) => {
    const value = await principal(request, response, false);
    if (!value) return;
    const parsed = rangeSchema.safeParse(request.query.range);
    if (!parsed.success) {
      response.status(400).json({ code: 'INVALID_RANGE' });
      return;
    }
    await proxy(response, () =>
      input.client.getInfrastructureHistory({ ...adapterPrincipal(value), range: parsed.data })
    );
  });
  router.post('/monitoring/incidents/:id/ack', async (request, response) => {
    const value = await principal(request, response, true);
    if (!value) return;
    const parsed = noteSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'INVALID_ACK_REQUEST' });
      return;
    }
    await proxy(response, () =>
      input.client.acknowledgeIncident({
        ...adapterPrincipal(value),
        incidentId: request.params.id ?? '',
        note: parsed.data.note
      })
    );
  });
  router.get('/zalo/link', async (request, response) => {
    const value = await principal(request, response, false);
    if (value) await proxy(response, () => input.client.getZaloLink(adapterPrincipal(value)));
  });
  router.post('/zalo/link-code', async (request, response) => {
    const value = await principal(request, response, true);
    if (!value) return;
    try {
      response.status(201).json(await input.client.createZaloLinkCode(adapterPrincipal(value)));
    } catch (error) {
      response.status(503).json({ code: errorCode(error) });
    }
  });
  router.delete('/zalo/link', async (request, response) => {
    const value = await principal(request, response, true);
    if (!value) return;
    try {
      await input.client.disableZaloLink(adapterPrincipal(value));
      response.status(204).end();
    } catch (error) {
      response.status(503).json({ code: errorCode(error) });
    }
  });
  return router;
}
