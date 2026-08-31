import { createHash } from 'node:crypto';

import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';

import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';
import {
  ChangeApplyRequestSchema,
  ChangeCancelRequestSchema,
  ChangeSaveRequestSchema,
  ChangeStatusRequestSchema,
  ChangeValidateRequestSchema,
  ClearApplyBlockRequestSchema
} from '../../../../../packages/config-contracts/src/changeProtocol.js';
import {
  ConfigChangeServiceError,
  type ConfigChangePrincipal,
  type ConfigChangeService
} from './configChangeService.js';
import { serializeConfigChangeSse } from './configChangeEvents.js';

const terminalChangeStates = new Set([
  'COMPLETED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'CANCELLED',
  'EXPIRED',
  'INVALID'
]);

type Principal = { userId: string; sessionId: string; role: OpsRole };
type StepUpGrant = {
  grantId: string;
  capability: 'variables_apply';
  userId: string;
  sessionId: string;
  ipHash: string;
  userAgentHash: string;
  subjectDigest: string;
  expiresAt?: string;
};
type AccountsWriteGrant = Omit<StepUpGrant, 'capability' | 'subjectDigest'> & {
  capability: 'accounts_write';
  subjectDigest?: string;
};

const createBody = z
  .object({
    appId: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
    reason: z.string().trim().min(3).max(2_000),
    supersedesChangeId: z.string().optional()
  })
  .strict();
const proofBody = z
  .object({
    password: z.string().min(1).max(1_024),
    totpCode: z.string().regex(/^\d{6}$/u),
    changeDigest: z.string().regex(/^hmac-sha256:v\d+:[a-f0-9]{64}$/u)
  })
  .strict();

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Vary', 'Cookie');
}

function errorCode(error: unknown): string {
  return error instanceof ConfigChangeServiceError ? error.code : 'CONFIG_CHANGE_AGENT_ERROR';
}

function statusFor(code: string): number {
  if (code === 'CONFIG_CHANGE_NOT_FOUND') return 404;
  if (code === 'CONFIG_SOURCE_CHANGED') return 409;
  if (code === 'CONFIG_CONTROL_DEGRADED') return 503;
  if (code === 'CONFIG_APPLICATION_BLOCKED') return 423;
  if (code === 'CONFIG_CHANGE_INVALID_STATE') return 409;
  return 400;
}

function actor(
  value: Principal,
  request: Request,
  hashClientIp: (ip: string) => string
): ConfigChangePrincipal {
  const ip = request.ip || request.socket.remoteAddress || 'unknown';
  const userAgent = request.get('user-agent') ?? 'unknown';
  return {
    ...value,
    ipHash: `sha256:${hashClientIp(ip).replace(/^sha256:/u, '')}`,
    userAgentHash: `sha256:${createHash('sha256').update(userAgent, 'utf8').digest('hex')}`
  };
}

function sendError(response: Response, error: unknown): void {
  const code = errorCode(error);
  response.status(statusFor(code)).json({ code });
}

export function createConfigChangeRouter(input: {
  service: ConfigChangeService;
  session: {
    authorize: (input: {
      cookieHeader?: string;
      csrfToken?: string;
      mutation: boolean;
    }) => Promise<Principal | null>;
  };
  stepUp?: {
    grant: (input: {
      capability: 'variables_apply';
      userId: string;
      sessionId: string;
      password: string;
      totpCode: string;
      ipHash: string;
      userAgentHash: string;
      subjectDigest: string;
    }) => Promise<{ id: string; expiresAt: string }>;
    consume: (binding: StepUpGrant) => Promise<boolean>;
  };
  accountsWriteStepUp?: {
    resolve: (principal: Principal, request: Request) => AccountsWriteGrant | null;
    consume: (binding: AccountsWriteGrant) => Promise<boolean>;
  };
  hashClientIp: (ip: string) => string;
  allowedOrigin?: string;
}): Router {
  const router = express.Router();
  router.use(express.json({ limit: '128kb', strict: true }));
  const allowedOrigin = input.allowedOrigin ?? 'https://man.thienuy.edu.vn';
  const authorizations = new Map<string, StepUpGrant>();

  function pruneAuthorizations(): void {
    const now = Date.now();
    for (const [key, grant] of authorizations) {
      if (!grant.expiresAt || Date.parse(grant.expiresAt) <= now) authorizations.delete(key);
    }
    while (authorizations.size >= 4_096) {
      const oldest = authorizations.keys().next().value;
      if (!oldest) break;
      authorizations.delete(oldest);
    }
  }

  async function principal(
    request: Request,
    response: Response,
    mutation = true,
    permission: 'variables:write' | 'variables:apply' = 'variables:write'
  ): Promise<{ principal: Principal; actor: ConfigChangePrincipal } | null> {
    noStore(response);
    if (mutation && request.get('origin') !== allowedOrigin) {
      response.status(403).json({ code: 'ORIGIN_DENIED' });
      return null;
    }
    if (mutation && !request.get('X-Ops-CSRF')) {
      response.status(403).json({ code: 'CSRF_REQUIRED' });
      return null;
    }
    const value = await input.session.authorize({
      ...(request.get('cookie') ? { cookieHeader: request.get('cookie')! } : {}),
      ...(request.get('X-Ops-CSRF') ? { csrfToken: request.get('X-Ops-CSRF')! } : {}),
      mutation
    });
    if (!value) {
      response.status(401).json({ code: 'AUTH_DENIED' });
      return null;
    }
    try {
      assertPermission(value.role, permission);
    } catch {
      response.status(403).json({ code: 'PERMISSION_DENIED' });
      return null;
    }
    return { principal: value, actor: actor(value, request, input.hashClientIp) };
  }

  router.post('/auth/variables/apply-authorization', async (request, response, next) => {
    try {
      const current = await principal(request, response, true, 'variables:apply');
      if (!current) return;
      const parsed = proofBody.safeParse(request.body);
      if (!parsed.success || !input.stepUp) {
        response.status(400).json({ code: 'INVALID_APPLY_AUTHORIZATION' });
        return;
      }
      try {
        const grant = await input.stepUp.grant({
          capability: 'variables_apply',
          userId: current.principal.userId,
          sessionId: current.principal.sessionId,
          password: parsed.data.password,
          totpCode: parsed.data.totpCode,
          ipHash: current.actor.ipHash,
          userAgentHash: current.actor.userAgentHash,
          subjectDigest: parsed.data.changeDigest
        });
        pruneAuthorizations();
        authorizations.set(`${current.principal.sessionId}:${parsed.data.changeDigest}`, {
          grantId: grant.id,
          capability: 'variables_apply',
          userId: current.principal.userId,
          sessionId: current.principal.sessionId,
          ipHash: current.actor.ipHash,
          userAgentHash: current.actor.userAgentHash,
          subjectDigest: parsed.data.changeDigest,
          expiresAt: grant.expiresAt
        });
        response.status(200).json({ authorizedUntil: grant.expiresAt });
      } catch {
        response.status(401).json({ code: 'MFA_DENIED' });
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/config-changes', async (request, response) => {
    try {
      const current = await principal(request, response);
      if (!current) return;
      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_CONFIG_CHANGE' });
      const result = await input.service.createDraft({
        principal: current.actor,
        applicationId: parsed.data.appId,
        reason: parsed.data.reason,
        ...(parsed.data.supersedesChangeId
          ? { supersedesChangeId: parsed.data.supersedesChangeId }
          : {})
      });
      response.status(201).json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.put('/config-changes/:changeId/items', async (request, response) => {
    try {
      const current = await principal(request, response);
      if (!current) return;
      const parsed = ChangeValidateRequestSchema.safeParse({
        ...request.body,
        changeId: request.params.changeId,
        replaceDraft: true
      });
      if (!parsed.success)
        return response.status(400).json({ code: 'INVALID_CONFIG_CHANGE_ITEMS' });
      const result = await input.service.replaceItems({
        principal: current.actor,
        changeId: request.params.changeId,
        body: parsed.data
      });
      response.status(200).json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/config-changes/:changeId/validate', async (request, response) => {
    const current = await principal(request, response, true, 'variables:write');
    if (!current) return;
    const parsed = ChangeValidateRequestSchema.safeParse({
      ...request.body,
      changeId: request.params.changeId
    });
    if (!parsed.success) return response.status(400).json({ code: 'INVALID_CONFIG_CHANGE' });
    try {
      response
        .status(200)
        .json(await input.service.validate({ principal: current.actor, body: parsed.data }));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/config-changes/:changeId/save', async (request, response) => {
    const current = await principal(request, response);
    if (!current) return;
    const parsed = ChangeSaveRequestSchema.safeParse({
      ...request.body,
      changeId: request.params.changeId
    });
    if (!parsed.success) return response.status(400).json({ code: 'INVALID_CONFIG_CHANGE' });
    try {
      response
        .status(200)
        .json(await input.service.save({ principal: current.actor, body: parsed.data }));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/config-changes/:changeId/apply', async (request, response) => {
    const current = await principal(request, response, true, 'variables:apply');
    if (!current) return;
    const parsed = ChangeApplyRequestSchema.safeParse({
      ...request.body,
      changeId: request.params.changeId
    });
    if (!parsed.success || !input.stepUp)
      return response.status(400).json({ code: 'INVALID_CONFIG_APPLY' });
    const key = `${current.principal.sessionId}:${parsed.data.changeDigest}`;
    const grant = authorizations.get(key);
    if (!grant || !(await input.stepUp.consume(grant))) {
      authorizations.delete(key);
      return response.status(401).json({ code: 'APPLY_AUTHORIZATION_REQUIRED' });
    }
    authorizations.delete(key);
    try {
      response
        .status(202)
        .json(await input.service.apply({ principal: current.actor, body: parsed.data }));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/config-changes/:changeId', async (request, response) => {
    const current = await principal(request, response, false);
    if (!current) return;
    const parsed = ChangeStatusRequestSchema.safeParse({ changeId: request.params.changeId });
    if (!parsed.success) return response.status(400).json({ code: 'INVALID_CONFIG_CHANGE' });
    try {
      response
        .status(200)
        .json(await input.service.status({ principal: current.actor, body: parsed.data }));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/config-changes/:changeId/events', async (request, response) => {
    const current = await principal(request, response, false);
    if (!current) return;
    const parsed = ChangeStatusRequestSchema.safeParse({
      changeId: request.params.changeId,
      ...(request.get('Last-Event-ID') ? { afterEventId: request.get('Last-Event-ID')! } : {})
    });
    if (!parsed.success) return response.status(400).json({ code: 'INVALID_CONFIG_CHANGE' });
    try {
      response
        .status(200)
        .setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        .setHeader('Connection', 'keep-alive')
        .setHeader('Cache-Control', 'no-store, private')
        .setHeader('X-Accel-Buffering', 'no');
      let afterEventId = parsed.data.afterEventId;
      let lastSequence = -1;
      let disconnected = false;
      const onClose = (): void => {
        disconnected = true;
      };
      request.once('close', onClose);
      const startedAt = Date.now();
      try {
        while (!disconnected && !response.writableEnded && Date.now() - startedAt < 5 * 60_000) {
          const status = await input.service.status({
            principal: current.actor,
            body: {
              changeId: parsed.data.changeId,
              ...(afterEventId ? { afterEventId } : {})
            }
          });
          if (status.sequence !== lastSequence || status.events.length > 0) {
            response.write(serializeConfigChangeSse(status));
            lastSequence = status.sequence;
            const lastEventId = status.events.at(-1)?.eventId;
            if (lastEventId) afterEventId = lastEventId;
          } else {
            response.write(': heartbeat\n\n');
          }
          if (terminalChangeStates.has(status.state)) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        }
      } finally {
        request.off('close', onClose);
        if (!response.writableEnded) response.end();
      }
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else if (!response.writableEnded) response.end();
    }
  });

  router.delete('/config-changes/:changeId', async (request, response) => {
    const current = await principal(request, response);
    if (!current) return;
    const parsed = ChangeCancelRequestSchema.safeParse({
      changeId: request.params.changeId,
      eventId: request.get('X-Request-ID') ?? `EVT_${Date.now()}`
    });
    if (!parsed.success) return response.status(400).json({ code: 'INVALID_CONFIG_CHANGE' });
    try {
      response
        .status(200)
        .json(await input.service.cancel({ principal: current.actor, body: parsed.data }));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/config-applications/:appId/apply-block/clear', async (request, response) => {
    const current = await principal(request, response, true, 'variables:apply');
    if (!current) return;
    const parsed = ClearApplyBlockRequestSchema.safeParse({
      ...request.body,
      appId: request.params.appId,
      eventId: request.get('X-Request-ID') ?? `EVT_${Date.now()}`
    });
    if (!parsed.success) return response.status(400).json({ code: 'INVALID_APPLY_BLOCK_CLEAR' });
    const accountsGrant = input.accountsWriteStepUp?.resolve(current.principal, request);
    if (!accountsGrant || !(await input.accountsWriteStepUp?.consume(accountsGrant))) {
      return response.status(401).json({ code: 'ACCOUNTS_AUTHORIZATION_REQUIRED' });
    }
    try {
      response
        .status(200)
        .json(await input.service.clearApplyBlock({ principal: current.actor, body: parsed.data }));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
