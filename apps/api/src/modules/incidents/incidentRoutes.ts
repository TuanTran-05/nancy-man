import express, { type Router } from 'express';
import { z } from 'zod';

import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';

type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

export function createIncidentRouter(input: {
  authorize: (input: {
    cookieHeader?: string;
    csrfToken?: string;
    mutation: boolean;
  }) => Promise<{ role: OpsRole; userId: string } | null>;
  incidents: {
    list: (input: { limit: number }) => Promise<unknown[]>;
    create: (input: {
      actorUserId: string;
      title: string;
      severity: IncidentSeverity;
      summary?: string;
      issueIds: string[];
    }) => Promise<{ id: string; incidentKey: string; linkedIssueCount: number } | null>;
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
      return response.status(200).json({ incidents: await input.incidents.list({ limit }) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', express.json({ limit: '12kb' }), async (request, response, next) => {
    try {
      const parsed = z
        .object({
          title: z.string().trim().min(3).max(200),
          severity: z.enum(['critical', 'high', 'medium', 'low']),
          summary: z.string().trim().min(1).max(4_000).optional(),
          issueIds: z.array(z.string().uuid()).max(50).default([])
        })
        .safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_INCIDENT' });
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
      const incident = await input.incidents.create({
        actorUserId: principal.userId,
        title: parsed.data.title,
        severity: parsed.data.severity,
        issueIds: parsed.data.issueIds,
        ...(parsed.data.summary ? { summary: parsed.data.summary } : {})
      });
      return incident
        ? response.status(201).json({
            incidentId: incident.id,
            incidentKey: incident.incidentKey,
            linkedIssueCount: incident.linkedIssueCount
          })
        : response.status(400).json({ code: 'INCIDENT_ISSUE_LINK_INVALID' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
