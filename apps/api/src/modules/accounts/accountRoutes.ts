import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';

import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';
import type { StepUpBinding } from '../auth/stepUpService.js';
import type { AccountService, OpsAccountSummary } from './accountService.js';

const role = z.enum(['ops_viewer', 'ops_maintainer', 'ops_owner']);
const createBody = z
  .object({
    username: z.string().trim().min(3).max(80),
    email: z.string().trim().email().max(320),
    displayName: z.string().trim().min(1).max(160),
    role: role.optional()
  })
  .strict();
const roleBody = z.object({ role }).strict();
const lockBody = z.object({ reason: z.string().trim().min(3).max(250).optional() }).strict();
const revokeBody = z.object({ confirmationUsername: z.string().min(1).max(80) }).strict();

type Principal = {
  sessionId: string;
  userId: string;
  role: OpsRole;
  username?: string;
  displayName?: string;
};

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'ACCOUNT_MUTATION_FAILED';
}

function statusFor(code: string): number {
  if (code === 'ACCOUNT_NOT_FOUND') return 404;
  if (code === 'STEP_UP_REQUIRED') return 401;
  if (code === 'ACCOUNT_NOT_OWNER' || code === 'ACCOUNT_FINAL_OWNER_PROTECTED') return 403;
  if (code === 'ACCOUNT_USERNAME_CONFIRMATION_REQUIRED') return 400;
  return 409;
}

export function createAccountRouter(input: {
  service: Pick<AccountService, 'list' | 'create' | 'changeRole' | 'lock' | 'recover' | 'revoke'>;
  session: {
    authorize: (input: {
      cookieHeader?: string;
      csrfToken?: string;
      mutation: boolean;
    }) => Promise<Principal | null>;
  };
  resolveAuthorization?: (principal: Principal, request: Request) => StepUpBinding | null;
  allowedOrigin?: string;
}): Router {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  const allowedOrigin = input.allowedOrigin ?? 'https://man.thienuy.edu.vn';

  async function principal(request: Request, response: Response, mutation: boolean): Promise<Principal | null> {
    noStore(response);
    if (mutation && request.get('origin') !== allowedOrigin) {
      response.status(403).json({ code: 'ORIGIN_DENIED' });
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
      assertPermission(value.role, 'accounts:write');
    } catch {
      response.status(403).json({ code: 'PERMISSION_DENIED' });
      return null;
    }
    return value;
  }

  function authorization(value: Principal, request: Request, response: Response): StepUpBinding | null {
    const resolved = input.resolveAuthorization?.(value, request) ?? null;
    if (!resolved) {
      response.status(401).json({ code: 'STEP_UP_REQUIRED' });
      return null;
    }
    return resolved;
  }

  async function execute(response: Response, operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      const code = errorCode(error);
      response.status(statusFor(code)).json({ code });
    }
  }

  router.get('/', async (request, response, next) => {
    try {
      const value = await principal(request, response, false);
      if (!value) return;
      const accounts = (await input.service.list()) as readonly OpsAccountSummary[];
      return response.status(200).json({ accounts });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    try {
      const value = await principal(request, response, true);
      if (!value) return;
      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_ACCOUNT_REQUEST' });
      const grant = authorization(value, request, response);
      if (!grant) return;
      await execute(response, async () => {
        const result = await input.service.create({
          actorUserId: value.userId,
          username: parsed.data.username,
          email: parsed.data.email,
          displayName: parsed.data.displayName,
          ...(parsed.data.role ? { role: parsed.data.role } : {}),
          authorization: grant
        });
        response.status(201).json(result);
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:userId/role', async (request, response, next) => {
    try {
      const value = await principal(request, response, true);
      if (!value) return;
      const parsed = roleBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_ACCOUNT_REQUEST' });
      const grant = authorization(value, request, response);
      if (!grant) return;
      await execute(response, async () => {
        await input.service.changeRole({
          actorUserId: value.userId,
          targetUserId: request.params.userId ?? '',
          role: parsed.data.role,
          authorization: grant
        });
        response.status(204).end();
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:userId/lock', async (request, response, next) => {
    try {
      const value = await principal(request, response, true);
      if (!value) return;
      const parsed = lockBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_ACCOUNT_REQUEST' });
      const grant = authorization(value, request, response);
      if (!grant) return;
      await execute(response, async () => {
        await input.service.lock({
          actorUserId: value.userId,
          targetUserId: request.params.userId ?? '',
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
          authorization: grant
        });
        response.status(204).end();
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:userId/recover', async (request, response, next) => {
    try {
      const value = await principal(request, response, true);
      if (!value) return;
      const grant = authorization(value, request, response);
      if (!grant) return;
      await execute(response, async () => {
        const result = await input.service.recover({
          actorUserId: value.userId,
          targetUserId: request.params.userId ?? '',
          authorization: grant
        });
        response.status(200).json(result);
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:userId/revoke', async (request, response, next) => {
    try {
      const value = await principal(request, response, true);
      if (!value) return;
      const parsed = revokeBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_ACCOUNT_REQUEST' });
      const grant = authorization(value, request, response);
      if (!grant) return;
      await execute(response, async () => {
        await input.service.revoke({
          actorUserId: value.userId,
          targetUserId: request.params.userId ?? '',
          ...parsed.data,
          authorization: grant
        });
        response.status(204).end();
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
