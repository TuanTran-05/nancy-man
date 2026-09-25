import { createHash } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';
import { captureOpsException } from '../../telemetry/runtimeTelemetry.js';
import {
  DatabaseExplorerService,
  DatabaseExplorerServiceError
} from './databaseExplorerService.js';
import {
  DatabasePiiRevealRequestSchema,
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

function handleRouteError(error: unknown, request: Request, response: Response) {
  if (error instanceof DatabaseExplorerServiceError) {
    return response.status(error.status).json({ code: error.code });
  }

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const errObj = error as { status: number; code?: unknown };
    const code = typeof errObj.code === 'string' ? errObj.code : 'ERROR';
    return response.status(errObj.status).json({ code });
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
  router.get('/targets', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const cookieHeader = request.get('cookie');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:schema:read');
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'database',
          status: 500,
          requestId: () =>
            typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
          route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
          method: () => request.method
        });
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const result = await input.service.getTargets(principal);
      return response.status(200).json(result);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500,
        requestId: () =>
          typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
        route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
        method: () => request.method
      });
      return handleRouteError(error, request, response);
    }
  });

  // 2. GET /:targetId/schema
  router.get('/:targetId/schema', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const cookieHeader = request.get('cookie');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:schema:read');
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'database',
          status: 500,
          requestId: () =>
            typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
          route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
          method: () => request.method
        });
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const targetIdParsed = TargetIdParamSchema.safeParse(request.params.targetId);
      if (!targetIdParsed.success) {
        return response.status(400).json({ code: 'DATABASE_TARGET_INVALID' });
      }

      const { ipHash } = getHashes(request, input.hashClientIp);
      const requestId = getRequestId(response);
      const snapshot = await input.service.getSchema({
        actor: principal,
        targetId: targetIdParsed.data,
        ...(requestId ? { requestId } : {}),
        ipHash
      });

      return response.status(200).json(snapshot);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500,
        requestId: () =>
          typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
        route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
        method: () => request.method
      });
      return handleRouteError(error, request, response);
    }
  });

  // 3. POST /:targetId/rows/query
  router.post('/:targetId/rows/query', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const cookieHeader = request.get('cookie');
      const csrfToken = request.get('x-ops-csrf');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        ...(csrfToken ? { csrfToken } : {}),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:data:read');
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'database',
          status: 500,
          requestId: () =>
            typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
          route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
          method: () => request.method
        });
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

      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);
      const requestId = getRequestId(response);

      const rowsResult = await input.service.queryRows({
        actor: principal,
        targetId: targetIdParsed.data,
        query: bodyParsed.data,
        ...(requestId ? { requestId } : {}),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(rowsResult);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500,
        requestId: () =>
          typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
        route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
        method: () => request.method
      });
      return handleRouteError(error, request, response);
    }
  });

  // 4. POST /:targetId/relations/query
  router.post('/:targetId/relations/query', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const cookieHeader = request.get('cookie');
      const csrfToken = request.get('x-ops-csrf');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        ...(csrfToken ? { csrfToken } : {}),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:data:read');
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'database',
          status: 500,
          requestId: () =>
            typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
          route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
          method: () => request.method
        });
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

      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);
      const requestId = getRequestId(response);

      const relatedResult = await input.service.queryRelatedRows({
        actor: principal,
        targetId: targetIdParsed.data,
        query: bodyParsed.data,
        ...(requestId ? { requestId } : {}),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(relatedResult);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500,
        requestId: () =>
          typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
        route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
        method: () => request.method
      });
      return handleRouteError(error, request, response);
    }
  });

  // 5. POST /pii-reveal
  router.post('/pii-reveal', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const cookieHeader = request.get('cookie');
      const csrfToken = request.get('x-ops-csrf');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        ...(csrfToken ? { csrfToken } : {}),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:pii:reveal');
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'database',
          status: 500,
          requestId: () =>
            typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
          route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
          method: () => request.method
        });
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const bodyParsed = DatabasePiiRevealRequestSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return response.status(400).json({ code: 'INVALID_REQUEST' });
      }

      const { targetId, ...body } = bodyParsed.data;
      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);
      const requestId = getRequestId(response);
      const revealResult = await input.service.revealPii({
        actor: principal,
        targetId,
        body,
        ...(requestId ? { requestId } : {}),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(revealResult);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500,
        requestId: () =>
          typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
        route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
        method: () => request.method
      });
      return handleRouteError(error, request, response);
    }
  });

  // 6. DELETE /pii-reveal
  router.delete('/pii-reveal', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const cookieHeader = request.get('cookie');
      const csrfToken = request.get('x-ops-csrf');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        ...(csrfToken ? { csrfToken } : {}),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });

      try {
        assertPermission(principal.role, 'database:pii:reveal');
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'database',
          status: 500,
          requestId: () =>
            typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
          route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
          method: () => request.method
        });
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }

      const { ipHash, userAgentHash } = getHashes(request, input.hashClientIp);
      const requestId = getRequestId(response);

      const revokeResult = await input.service.revokePiiReveal({
        actor: principal,
        ...(requestId ? { requestId } : {}),
        ipHash,
        userAgentHash
      });

      return response.status(200).json(revokeResult);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500,
        requestId: () =>
          typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
        route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
        method: () => request.method
      });
      return handleRouteError(error, request, response);
    }
  });

  return router;
}
