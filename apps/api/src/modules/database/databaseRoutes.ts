import { createHash } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';
import { captureOpsException } from '../../telemetry/runtimeTelemetry.js';
import {
  DatabaseExplorerService,
  DatabaseExplorerServiceError
} from './databaseExplorerService.js';
import {
  DatabasePiiRevealBodySchema,
  DatabaseRelatedRowsQueryBodySchema,
  DatabaseRowsQueryBodySchema,
  TargetIdParamSchema
} from './databaseSchemas.js';

export type DatabasePrincipal = {
  userId: string;
  sessionId: string;
  role: OpsRole;
};

export type DatabaseRouterInput = {
  service: DatabaseExplorerService;
  authorize: (input: {
    cookieHeader?: string;
    csrfToken?: string;
    mutation: boolean;
  }) => Promise<DatabasePrincipal | null>;
  hashClientIp: (ip: string) => string;
};

function getHashes(request: Request, hashClientIp: (ip: string) => string) {
  const ip = request.ip || request.socket.remoteAddress || '127.0.0.1';
  const ipHash = hashClientIp(ip);
  const userAgent = request.get('user-agent') || 'unknown';
  const userAgentHash = createHash('sha256').update(userAgent, 'utf8').digest('hex');
  return { ipHash, userAgentHash };
}

function getRequestId(response: Response): string | undefined {
  return typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined;
}

function handleRouteError(
  error: unknown,
  request: Request,
  response: Response,
  next: express.NextFunction
) {
  if (error instanceof DatabaseExplorerServiceError) {
    return response.status(error.status).json({ code: error.code });
  }

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as any).status === 'number'
  ) {
    return response.status((error as any).status).json({ code: (error as any).code || 'ERROR' });
  }

  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') {
    return response.status(400).json({ code: 'INVALID_REQUEST' });
  }

  captureOpsException(error, {
    code: 'UNHANDLED_OPS_EXCEPTION',
    source: 'database',
    status: 500,
    requestId: () => getRequestId(response),
    route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
    method: () => request.method
  });

  return response.status(500).json({ code: 'INTERNAL_ERROR' });
}

export function createDatabaseRouter(input: {
  service: DatabaseExplorerService;
  authorize: (input: {
    cookieHeader?: string;
    csrfToken?: string;
    mutation: boolean;
  }) => Promise<DatabasePrincipal | null>;
  hashClientIp: (ip: string) => string;
}): Router {
  const router = express.Router();

  // 1. GET /targets
  router.get('/targets', async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const principal = await input.authorize({
        cookieHeader: request.get('cookie'),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:schema:read');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const result = await input.service.getTargets();
      return response.status(200).json(result);
    } catch (error) {
      return handleRouteError(error, request, response, next);
    }
  });

  // 2. GET /:targetId/schema
  router.get('/:targetId/schema', async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const principal = await input.authorize({
        cookieHeader: request.get('cookie'),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:schema:read');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const targetIdParsed = TargetIdParamSchema.safeParse(request.params.targetId);
      if (!targetIdParsed.success) {
        return response.status(400).json({ code: 'DATABASE_TARGET_INVALID' });
      }

      const { ipHash } = getHashes(request, input.hashClientIp);
      const snapshot = await input.service.getSchema({
        actor: principal,
        targetId: targetIdParsed.data,
        requestId: getRequestId(response),
        ipHash
      });

      return response.status(200).json(snapshot);
    } catch (error) {
      return handleRouteError(error, request, response, next);
    }
  });

  // 3. POST /:targetId/rows/query
  router.post('/:targetId/rows/query', async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const principal = await input.authorize({
        cookieHeader: request.get('cookie'),
        csrfToken: request.get('x-ops-csrf'),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:data:read');
      } catch {
        return response.status(403).json({ code: 'DATABASE_DATA_PERMISSION_DENIED' });
      }

      const targetIdParsed = TargetIdParamSchema.safeParse(request.params.targetId);
      if (!targetIdParsed.success) {
        return response.status(400).json({ code: 'DATABASE_TARGET_INVALID' });
      }

      const bodyParsed = DatabaseRowsQueryBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return response.status(400).json({ code: 'DATABASE_FILTER_INVALID' });
      }

      const grantId = request.get('x-ops-step-up-grant');
      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);

      const rowsResult = await input.service.queryRows({
        actor: principal,
        targetId: targetIdParsed.data,
        query: bodyParsed.data,
        grantId,
        requestId: getRequestId(response),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(rowsResult);
    } catch (error) {
      return handleRouteError(error, request, response, next);
    }
  });

  // 4. POST /:targetId/relations/query
  router.post('/:targetId/relations/query', async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const principal = await input.authorize({
        cookieHeader: request.get('cookie'),
        csrfToken: request.get('x-ops-csrf'),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:data:read');
      } catch {
        return response.status(403).json({ code: 'DATABASE_DATA_PERMISSION_DENIED' });
      }

      const targetIdParsed = TargetIdParamSchema.safeParse(request.params.targetId);
      if (!targetIdParsed.success) {
        return response.status(400).json({ code: 'DATABASE_TARGET_INVALID' });
      }

      const bodyParsed = DatabaseRelatedRowsQueryBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return response.status(400).json({ code: 'DATABASE_FILTER_INVALID' });
      }

      const grantId = request.get('x-ops-step-up-grant');
      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);

      const relatedResult = await input.service.queryRelatedRows({
        actor: principal,
        targetId: targetIdParsed.data,
        query: bodyParsed.data,
        grantId,
        requestId: getRequestId(response),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(relatedResult);
    } catch (error) {
      return handleRouteError(error, request, response, next);
    }
  });

  // 5. POST /:targetId/pii-reveal
  router.post('/:targetId/pii-reveal', async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const principal = await input.authorize({
        cookieHeader: request.get('cookie'),
        csrfToken: request.get('x-ops-csrf'),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:pii:reveal');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const targetIdParsed = TargetIdParamSchema.safeParse(request.params.targetId);
      if (!targetIdParsed.success) {
        return response.status(400).json({ code: 'DATABASE_TARGET_INVALID' });
      }

      const bodyParsed = DatabasePiiRevealBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return response.status(400).json({ code: 'INVALID_REQUEST' });
      }

      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);
      const revealResult = await input.service.revealPii({
        actor: principal,
        targetId: targetIdParsed.data,
        body: bodyParsed.data,
        requestId: getRequestId(response),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(revealResult);
    } catch (error) {
      return handleRouteError(error, request, response, next);
    }
  });

  // 6. DELETE /:targetId/pii-reveal
  router.delete('/:targetId/pii-reveal', async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const principal = await input.authorize({
        cookieHeader: request.get('cookie'),
        csrfToken: request.get('x-ops-csrf'),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:pii:reveal');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const targetIdParsed = TargetIdParamSchema.safeParse(request.params.targetId);
      if (!targetIdParsed.success) {
        return response.status(400).json({ code: 'DATABASE_TARGET_INVALID' });
      }

      const grantId = request.get('x-ops-step-up-grant');
      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);

      const revokeResult = await input.service.revokePiiReveal({
        actor: principal,
        targetId: targetIdParsed.data,
        grantId,
        requestId: getRequestId(response),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(revokeResult);
    } catch (error) {
      return handleRouteError(error, request, response, next);
    }
  });

  return router;
}
