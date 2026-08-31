import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import {
  BoundedNonceReplayCache,
  verifyLegacyMonitoringRequest,
  type LegacyMonitoringRole
} from '../../../../../packages/contracts/src/legacyMonitoringProtocol.js';
import type { OpsStore } from '../storage/store.js';
import {
  createOpsZaloLinkCode,
  hashZaloLinkCode
} from '../security/zaloLink.js';
import type { OpsZaloRouteDependencies } from './zaloRoutes.js';
import { publicOverview } from './monitorRoutes.js';

type InternalRequest = Request & { rawBody?: string };
type InternalPrincipal = { userId: string; role: LegacyMonitoringRole };

const roleSchema = z.enum(['ops_viewer', 'ops_maintainer', 'ops_owner']);
const ackSchema = z.object({ incidentId: z.string().min(1).max(128), note: z.string().min(1).max(500) }).strict();

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function loopback(request: Request): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requestPath(request: Request): string {
  const queryIndex = request.originalUrl.indexOf('?');
  return queryIndex < 0 ? request.path : `${request.path}${request.originalUrl.slice(queryIndex)}`;
}

function verificationCode(value: string): number {
  if (value === 'BODY_TOO_LARGE') return 413;
  if (value === 'PATH_NOT_ALLOWED') return 404;
  return 401;
}

export function attachInternalCanonicalRoutes(
  router: Router,
  input: {
    store: OpsStore;
    secret: string;
    nonceCapacity?: number;
    now?: () => Date;
    zalo?: OpsZaloRouteDependencies;
  }
): void {
  const nonceStore = new BoundedNonceReplayCache(input.nonceCapacity ?? 4_096);
  const now = input.now ?? (() => new Date());

  async function authenticate(request: InternalRequest, response: Response): Promise<InternalPrincipal | null> {
    noStore(response);
    if (!loopback(request)) {
      response.status(403).json({ code: 'LOOPBACK_REQUIRED' });
      return null;
    }
    const userId = request.get('X-Ops-Principal-Id') ?? '';
    const role = roleSchema.safeParse(request.get('X-Ops-Principal-Role'));
    const timestamp = request.get('X-Ops-Internal-Timestamp') ?? '';
    const nonce = request.get('X-Ops-Internal-Nonce') ?? '';
    const signature = request.get('X-Ops-Internal-Signature') ?? '';
    const rawBody = request.rawBody ?? '';
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(userId) || !role.success) {
      response.status(401).json({ code: 'INVALID_INTERNAL_AUTHENTICATION' });
      return null;
    }
    const result = await verifyLegacyMonitoringRequest({
      secret: input.secret,
      method: request.method,
      path: requestPath(request),
      timestamp,
      nonce,
      signature,
      rawBody,
      userId,
      role: role.data,
      nonceStore,
      now: now()
    });
    if (!result.ok) {
      response.status(verificationCode(result.code)).json({ code: result.code });
      return null;
    }
    return { userId, role: role.data };
  }

  router.get('/internal/v1/monitoring/overview', async (request, response) => {
    const principal = await authenticate(request as InternalRequest, response);
    if (!principal) return;
    response.json(publicOverview(input.store.readDashboardOverview()));
  });

  router.get('/internal/v1/monitoring/infrastructure/history', async (request, response) => {
    const principal = await authenticate(request as InternalRequest, response);
    if (!principal) return;
    const range = z.enum(['1h', '24h', '7d', '30d']).safeParse(request.query.range);
    if (!range.success) {
      response.status(400).json({ code: 'INVALID_RANGE' });
      return;
    }
    const ranges = {
      '1h': { milliseconds: 60 * 60_000, resolutionSeconds: 60 as const },
      '24h': { milliseconds: 24 * 60 * 60_000, resolutionSeconds: 300 as const },
      '7d': { milliseconds: 7 * 24 * 60 * 60_000, resolutionSeconds: 1800 as const },
      '30d': { milliseconds: 30 * 24 * 60 * 60_000, resolutionSeconds: 7200 as const }
    };
    const selected = ranges[range.data];
    const to = now();
    const points = input.store.readInfrastructureHistory({
      from: new Date(to.getTime() - selected.milliseconds).toISOString(),
      to: to.toISOString(),
      resolutionSeconds: selected.resolutionSeconds,
      limit: 720
    });
    response.json({
      range: range.data,
      resolutionSeconds: selected.resolutionSeconds,
      collectedAt: to.toISOString(),
      points
    });
  });

  router.post('/internal/v1/monitoring/incidents/ack', async (request, response) => {
    const principal = await authenticate(request as InternalRequest, response);
    if (!principal) return;
    const parsed = ackSchema.safeParse(request.body);
    if (!parsed.success || /[^\u0000-\u007F]/u.test(parsed.data?.incidentId ?? '')) {
      response.status(400).json({ code: 'INVALID_ACK_REQUEST' });
      return;
    }
    try {
      response.json(
        input.store.acknowledgeIncident(parsed.data.incidentId, {
          accountId: principal.userId,
          note: parsed.data.note,
          now: now().toISOString()
        })
      );
    } catch {
      response.status(404).json({ code: 'INCIDENT_NOT_FOUND' });
    }
  });

  if (!input.zalo) return;
  const zalo = input.zalo;
  router.get('/internal/v1/monitoring/zalo/link', async (request, response) => {
    const principal = await authenticate(request as InternalRequest, response);
    if (!principal) return;
    const status = zalo.store.getZaloLinkStatus(principal.userId);
    response.json(status ? { linked: true, ...status } : { linked: false });
  });
  router.post('/internal/v1/monitoring/zalo/link-code', async (request, response) => {
    const principal = await authenticate(request as InternalRequest, response);
    if (!principal) return;
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + zalo.config.linkTtlSeconds * 1_000);
    const code = createOpsZaloLinkCode();
    zalo.store.createZaloLinkCode({
      codeHash: hashZaloLinkCode(code, zalo.config.linkCodePepper),
      principalId: principal.userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: createdAt.toISOString()
    });
    zalo.store.recordAuditEvent({
      actorId: principal.userId,
      action: 'zalo_link_code_created',
      target: principal.userId,
      details: { expiresAt: expiresAt.toISOString() },
      occurredAt: createdAt.toISOString()
    });
    response.status(201).json({ code, expiresAt: expiresAt.toISOString(), command: `/link ${code}` });
  });
  router.post('/internal/v1/monitoring/zalo/unlink', async (request, response) => {
    const principal = await authenticate(request as InternalRequest, response);
    if (!principal) return;
    const at = now().toISOString();
    zalo.store.disableZaloLink(principal.userId, at);
    zalo.store.recordAuditEvent({
      actorId: principal.userId,
      action: 'zalo_link_disabled',
      target: principal.userId,
      details: {},
      occurredAt: at
    });
    response.status(204).end();
  });
}
