import express, { type Router } from 'express';
import { z } from 'zod';

import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';

const classifyBody = z.object({ sql: z.string().min(1).max(65_536) });

type SqlPrincipal = {
  userId: string;
  sessionId: string;
  role: OpsRole;
};

export function createSqlRouter(input: {
  authorize: (input: {
    cookieHeader?: string;
    csrfToken?: string;
    mutation: boolean;
  }) => Promise<SqlPrincipal | null>;
  worker: {
    command: (input: {
      actor: { userId: string; sessionId: string; role: 'ops_maintainer' | 'ops_owner' };
      kind: 'sql.classify';
      payload: { sql: string };
    }) => Promise<
      | { protocolVersion: 1; commandId: string; ok: true; result: unknown }
      | {
          protocolVersion: 1;
          commandId: string;
          ok: false;
          error: { code: string; safeMessage: string };
        }
    >;
  };
}): Router {
  const router = express.Router();
  router.post('/classify', express.json({ limit: '72kb' }), async (request, response, next) => {
    try {
      const parsed = classifyBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_SQL_REQUEST' });
      const cookieHeader = request.get('cookie');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
      try {
        assertPermission(principal.role, 'sql:workspace');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }
      const { role } = principal;
      if (role === 'ops_viewer') return response.status(403).json({ code: 'PERMISSION_DENIED' });
      const worker = await input.worker.command({
        actor: { userId: principal.userId, sessionId: principal.sessionId, role },
        kind: 'sql.classify',
        payload: parsed.data
      });
      if (!worker.ok) return response.status(503).json({ code: worker.error.code });
      return response.status(200).json({ classification: worker.result });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
