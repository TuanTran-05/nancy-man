import express, { type Router } from 'express';

import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';

export function createIssueRouter(input: {
  authorize: (cookieHeader?: string) => Promise<{ role: OpsRole } | null>;
  inbox: { list: (input: { limit: number }) => Promise<unknown[]> };
}): Router {
  const router = express.Router();
  router.get('/', async (request, response, next) => {
    try {
      const cookieHeader = request.get('cookie');
      const principal = await input.authorize(cookieHeader || undefined);
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
      try {
        assertPermission(principal.role, 'issues:read');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }
      const rawLimit = Number(request.query.limit ?? '50');
      const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 50;
      return response.status(200).json({ issues: await input.inbox.list({ limit }) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
