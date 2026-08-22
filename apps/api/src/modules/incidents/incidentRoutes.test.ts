import express from 'express';
import { describe, expect, it } from 'vitest';

import { createIncidentRouter } from './incidentRoutes.js';

describe('incident routes', () => {
  it('creates an incident only with CSRF-protected issues:write access', async () => {
    const created: unknown[] = [];
    const app = express();
    app.use(
      '/incidents',
      createIncidentRouter({
        authorize: async () => ({ role: 'ops_maintainer', userId: 'maintainer-id' }),
        incidents: {
          list: async () => [],
          create: async (input) => {
            created.push(input);
            return { id: 'incident-id', incidentKey: 'INC_AB12CD34', linkedIssueCount: 1 };
          }
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: '__Host-ops-session=opaque',
          'X-Ops-CSRF': 'csrf-token'
        },
        body: JSON.stringify({
          title: 'Payments unavailable',
          severity: 'critical',
          summary: 'Investigating.',
          issueIds: ['cf0c3ff9-1c73-4112-a5c9-1bd5f8a05f16']
        })
      });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        incidentId: 'incident-id',
        incidentKey: 'INC_AB12CD34',
        linkedIssueCount: 1
      });
      expect(created).toEqual([
        {
          actorUserId: 'maintainer-id',
          title: 'Payments unavailable',
          severity: 'critical',
          summary: 'Investigating.',
          issueIds: ['cf0c3ff9-1c73-4112-a5c9-1bd5f8a05f16']
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('links an issue with the current maintainer as actor', async () => {
    const links: unknown[] = [];
    const app = express();
    app.use(
      '/incidents',
      createIncidentRouter({
        authorize: async () => ({ role: 'ops_maintainer', userId: 'maintainer-id' }),
        incidents: {
          list: async () => [],
          create: async () => ({
            id: 'incident-id',
            incidentKey: 'INC_AB12CD34',
            linkedIssueCount: 0
          }),
          linkIssue: async (input) => {
            links.push(input);
            return true;
          }
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/incidents/f16f9426-010c-4e06-a459-9fd18c4a442d/issues`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: '__Host-ops-session=opaque',
            'X-Ops-CSRF': 'csrf-token'
          },
          body: JSON.stringify({ issueId: 'f16f9426-010c-4e06-a459-9fd18c4a442e' })
        }
      );
      expect(response.status).toBe(204);
      expect(links).toEqual([
        {
          incidentId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          issueId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
          actorUserId: 'maintainer-id'
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
