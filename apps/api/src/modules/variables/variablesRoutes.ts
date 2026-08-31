import { createHash } from 'node:crypto';

import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';

import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';
import type { AgentActor } from '../../../../../packages/config-contracts/src/agentProtocol.js';
import type { StepUpBinding } from '../auth/stepUpService.js';
import { VariablesServiceError, type VariablesService } from './variablesService.js';

type Principal = {
  sessionId: string;
  userId: string;
  role: OpsRole;
};

type VariableStepUp = {
  grant: (input: {
    capability: 'variables_secret';
    userId: string;
    sessionId: string;
    password: string;
    totpCode: string;
    ipHash: string;
    userAgentHash: string;
  }) => Promise<{ id: string; expiresAt: string }>;
  authorize: (input: StepUpBinding) => Promise<unknown>;
  revoke: (input: StepUpBinding) => Promise<void>;
};

type VariableRateLimiter = {
  allow: (input: { userId: string; sessionId: string; ipHash: string }) => Promise<boolean>;
};

type VariablesAudit = {
  append: (input: {
    actorUserId: string | null;
    action: string;
    subjectType: string;
    subjectId?: string;
    metadata: Record<string, unknown>;
  }) => Promise<unknown>;
};

const unlockBody = z
  .object({
    password: z.string().min(1).max(1_024),
    totpCode: z.string().regex(/^\d{6}$/u)
  })
  .strict();

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Vary', 'Cookie');
}

function userAgent(request: Request): string {
  return request.get('user-agent') ?? 'unknown';
}

function requestHashes(request: Request, hashClientIp: (ip: string) => string) {
  const ip = request.ip || request.socket.remoteAddress || 'unknown';
  const rawIpHash = hashClientIp(ip);
  const rawUserAgentHash = createHash('sha256').update(userAgent(request), 'utf8').digest('hex');
  return {
    ipHash: rawIpHash,
    userAgentHash: rawUserAgentHash,
    actorIpHash: rawIpHash.startsWith('sha256:') ? rawIpHash : `sha256:${rawIpHash}`,
    actorUserAgentHash: `sha256:${rawUserAgentHash}`
  };
}

function actor(
  principal: Principal,
  request: Request,
  hashClientIp: (ip: string) => string
): AgentActor {
  const hashes = requestHashes(request, hashClientIp);
  return {
    userId: principal.userId,
    sessionId: principal.sessionId,
    role: principal.role,
    ipHash: hashes.actorIpHash,
    userAgentHash: hashes.actorUserAgentHash
  };
}

function stableError(error: unknown): 'CONFIG_AGENT_UNAVAILABLE' | 'CONFIG_AGENT_PROTOCOL_ERROR' {
  return error instanceof VariablesServiceError ? error.code : 'CONFIG_AGENT_UNAVAILABLE';
}

export function createVariablesRouter(input: {
  service: Pick<VariablesService, 'getCatalog' | 'read'>;
  client?: unknown;
  session: {
    authorize: (input: {
      cookieHeader?: string;
      csrfToken?: string;
      mutation: boolean;
    }) => Promise<Principal | null>;
  };
  stepUp: VariableStepUp;
  hashClientIp: (ip: string) => string;
  rateLimiter: VariableRateLimiter;
  audit?: VariablesAudit;
  allowedOrigin?: string;
}): Router {
  const router = express.Router();
  router.use(express.json({ limit: '8kb', strict: true }));
  const allowedOrigin = input.allowedOrigin ?? 'https://man.thienuy.edu.vn';
  const grants = new Map<string, StepUpBinding>();

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
    const cookieHeader = request.get('cookie');
    const csrfToken = request.get('X-Ops-CSRF');
    const value = await input.session.authorize({
      ...(cookieHeader ? { cookieHeader } : {}),
      ...(csrfToken ? { csrfToken } : {}),
      mutation
    });
    if (!value) {
      response.status(401).json({ code: 'AUTH_DENIED' });
      return null;
    }
    try {
      assertPermission(value.role, 'variables:read');
    } catch {
      response.status(403).json({ code: 'PERMISSION_DENIED' });
      return null;
    }
    return value;
  }

  function binding(principalValue: Principal, request: Request): StepUpBinding | null {
    const grant = grants.get(principalValue.sessionId);
    if (!grant || grant.userId !== principalValue.userId) return null;
    const hashes = requestHashes(request, input.hashClientIp);
    return {
      ...grant,
      ipHash: hashes.ipHash,
      userAgentHash: hashes.userAgentHash
    };
  }

  async function appendAudit(event: {
    actorUserId: string | null;
    action: string;
    sessionId?: string;
    code: string;
  }): Promise<void> {
    await input.audit?.append({
      actorUserId: event.actorUserId,
      action: event.action,
      subjectType: 'variables_capability',
      metadata: {
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        code: event.code
      }
    });
  }

  router.post('/auth/variables/unlock', async (request, response, next) => {
    try {
      noStore(response);
      const parsed = unlockBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_VARIABLE_UNLOCK' });
      const value = await principal(request, response, true);
      if (!value) return;
      const hashes = requestHashes(request, input.hashClientIp);
      if (
        !(await input.rateLimiter.allow({
          userId: value.userId,
          sessionId: value.sessionId,
          ipHash: hashes.ipHash
        }))
      ) {
        return response.status(429).json({ code: 'RATE_LIMITED' });
      }
      try {
        const grant = await input.stepUp.grant({
          capability: 'variables_secret',
          userId: value.userId,
          sessionId: value.sessionId,
          password: parsed.data.password,
          totpCode: parsed.data.totpCode,
          ipHash: hashes.ipHash,
          userAgentHash: hashes.userAgentHash
        });
        grants.set(value.sessionId, {
          grantId: grant.id,
          capability: 'variables_secret',
          userId: value.userId,
          sessionId: value.sessionId,
          ipHash: hashes.ipHash,
          userAgentHash: hashes.userAgentHash
        });
        await appendAudit({
          actorUserId: value.userId,
          action: 'variables.unlock',
          sessionId: value.sessionId,
          code: 'SUCCESS'
        });
        return response.status(200).json({ unlockedUntil: grant.expiresAt });
      } catch {
        await appendAudit({
          actorUserId: value.userId,
          action: 'variables.unlock_failed',
          sessionId: value.sessionId,
          code: 'MFA_DENIED'
        });
        return response.status(401).json({ code: 'MFA_DENIED' });
      }
    } catch (error) {
      next(error);
    }
  });

  router.delete('/auth/variables/unlock', async (request, response, next) => {
    try {
      const value = await principal(request, response, true);
      if (!value) return;
      const current = binding(value, request);
      if (current) {
        try {
          await input.stepUp.revoke(current);
        } catch {
          return response.status(401).json({ code: 'STEP_UP_REQUIRED' });
        }
        grants.delete(value.sessionId);
      }
      await appendAudit({
        actorUserId: value.userId,
        action: 'variables.lock',
        sessionId: value.sessionId,
        code: 'SUCCESS'
      });
      return response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/variables/catalog', async (request, response, next) => {
    try {
      const value = await principal(request, response, false);
      if (!value) return;
      return response.status(200).json(await input.service.getCatalog());
    } catch (error) {
      next(error);
    }
  });

  router.get('/variables', async (request, response, next) => {
    try {
      const value = await principal(request, response, false);
      if (!value) return;
      const current = binding(value, request);
      if (!current) return response.status(401).json({ code: 'STEP_UP_REQUIRED' });
      try {
        await input.stepUp.authorize(current);
      } catch {
        grants.delete(value.sessionId);
        await appendAudit({
          actorUserId: value.userId,
          action: 'variables.expired',
          sessionId: value.sessionId,
          code: 'STEP_UP_REQUIRED'
        });
        return response.status(401).json({ code: 'STEP_UP_REQUIRED' });
      }
      try {
        return response
          .status(200)
          .json(await input.service.read({ actor: actor(value, request, input.hashClientIp) }));
      } catch (error) {
        return response.status(503).json({ code: stableError(error) });
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
