import express, { type Router } from 'express';
import { z } from 'zod';

import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';

export function createIssueRouter(input: {
  authorize: (input: {
    cookieHeader?: string;
    csrfToken?: string;
    mutation: boolean;
  }) => Promise<{ role: OpsRole; userId: string } | null>;
  inbox: {
    list: (input: { limit: number }) => Promise<unknown[]>;
    detail?: (issueId: string) => Promise<unknown | null>;
  };
  workflow?: {
    transition: (input: {
      issueId: string;
      actorUserId: string;
      status: 'acknowledged' | 'investigating' | 'resolved' | 'ignored';
    }) => Promise<boolean>;
    comment?: (input: {
      issueId: string;
      actorUserId: string;
      comment: string;
    }) => Promise<boolean>;
    assign?: (input: {
      issueId: string;
      actorUserId: string;
      assignedUserId: string | null;
    }) => Promise<boolean>;
  };
}): Router {
  const router = express.Router();
  router.get('/', async (request, response, next) => {
    try {
      const cookieHeader = request.get('cookie');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        mutation: false
      });
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
  router.get('/:issueId', async (request, response, next) => {
    try {
      const cookieHeader = request.get('cookie');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
      try {
        assertPermission(principal.role, 'issues:read');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }
      const detail = await input.inbox.detail?.(request.params.issueId);
      return detail
        ? response.status(200).json(detail)
        : response.status(404).json({ code: 'ISSUE_NOT_FOUND' });
    } catch (error) {
      next(error);
    }
  });
  router.patch(
    '/:issueId/status',
    express.json({ limit: '2kb' }),
    async (request, response, next) => {
      try {
        const parsed = z
          .object({ status: z.enum(['acknowledged', 'investigating', 'resolved', 'ignored']) })
          .safeParse(request.body);
        if (!parsed.success || !input.workflow)
          return response.status(400).json({ code: 'INVALID_ISSUE_TRANSITION' });
        const cookieHeader = request.get('cookie');
        const csrfToken = request.get('X-Ops-CSRF');
        const principal = await input.authorize({
          ...(cookieHeader ? { cookieHeader } : {}),
          ...(csrfToken ? { csrfToken } : {}),
          mutation: true
        });
        if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
        try {
          assertPermission(principal.role, 'issues:write');
        } catch {
          return response.status(403).json({ code: 'PERMISSION_DENIED' });
        }
        if (
          !(await input.workflow.transition({
            issueId: request.params.issueId,
            actorUserId: principal.userId,
            status: parsed.data.status
          }))
        )
          return response.status(404).json({ code: 'ISSUE_NOT_FOUND' });
        return response.status(204).end();
      } catch (error) {
        next(error);
      }
    }
  );
  router.post(
    '/:issueId/comments',
    express.json({ limit: '4kb' }),
    async (request, response, next) => {
      try {
        const parsed = z
          .object({ comment: z.string().trim().min(1).max(2_000) })
          .safeParse(request.body);
        if (!parsed.success || !input.workflow?.comment)
          return response.status(400).json({ code: 'INVALID_ISSUE_COMMENT' });
        const cookieHeader = request.get('cookie');
        const csrfToken = request.get('X-Ops-CSRF');
        const principal = await input.authorize({
          ...(cookieHeader ? { cookieHeader } : {}),
          ...(csrfToken ? { csrfToken } : {}),
          mutation: true
        });
        if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
        try {
          assertPermission(principal.role, 'issues:write');
        } catch {
          return response.status(403).json({ code: 'PERMISSION_DENIED' });
        }
        const created = await input.workflow.comment({
          issueId: request.params.issueId,
          actorUserId: principal.userId,
          comment: parsed.data.comment
        });
        return created
          ? response.status(204).end()
          : response.status(404).json({ code: 'ISSUE_NOT_FOUND' });
      } catch (error) {
        next(error);
      }
    }
  );
  router.post(
    '/:issueId/assign',
    express.json({ limit: '2kb' }),
    async (request, response, next) => {
      try {
        const parsed = z
          .object({ assignedUserId: z.string().uuid().nullable() })
          .safeParse(request.body);
        if (!parsed.success || !input.workflow?.assign)
          return response.status(400).json({ code: 'INVALID_ISSUE_ASSIGNMENT' });
        const cookieHeader = request.get('cookie');
        const csrfToken = request.get('X-Ops-CSRF');
        const principal = await input.authorize({
          ...(cookieHeader ? { cookieHeader } : {}),
          ...(csrfToken ? { csrfToken } : {}),
          mutation: true
        });
        if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
        try {
          assertPermission(principal.role, 'issues:write');
        } catch {
          return response.status(403).json({ code: 'PERMISSION_DENIED' });
        }
        const changed = await input.workflow.assign({
          issueId: request.params.issueId,
          actorUserId: principal.userId,
          assignedUserId: parsed.data.assignedUserId
        });
        return changed
          ? response.status(204).end()
          : response.status(404).json({ code: 'ISSUE_NOT_FOUND_OR_ASSIGNEE_INVALID' });
      } catch (error) {
        next(error);
      }
    }
  );
  return router;
}
