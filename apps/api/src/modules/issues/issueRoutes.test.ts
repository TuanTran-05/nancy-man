import express from 'express';
import { describe, expect, it } from 'vitest';
import { createIssueRouter } from './issueRoutes.js';
describe('issue routes', () => {
  it('requires issues:read before returning inbox data', async () => {
    const app = express();
    app.use(
      '/issues',
      createIssueRouter({
        authorize: async () => ({ role: 'ops_viewer', userId: 'viewer-id' }),
        inbox: { list: async () => [{ id: 'issue' }] }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/issues?limit=1`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ issues: [{ id: 'issue' }] });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('requires CSRF and issues:write before appending an issue comment', async () => {
    const comments: unknown[] = [];
    const app = express();
    app.use(
      '/issues',
      createIssueRouter({
        authorize: async () => ({ role: 'ops_maintainer', userId: 'maintainer-id' }),
        inbox: { list: async () => [] },
        workflow: {
          transition: async () => true,
          comment: async (input) => {
            comments.push(input);
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
      const response = await fetch(`http://127.0.0.1:${address.port}/issues/issue/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: '__Host-ops-session=opaque',
          'X-Ops-CSRF': 'csrf-token'
        },
        body: JSON.stringify({ comment: 'Investigating the API timeout.' })
      });
      expect(response.status).toBe(204);
      expect(comments).toEqual([
        {
          issueId: 'issue',
          actorUserId: 'maintainer-id',
          comment: 'Investigating the API timeout.'
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('records assignment through the workflow with a CSRF-protected maintainer session', async () => {
    const assignments: unknown[] = [];
    const app = express();
    app.use(
      '/issues',
      createIssueRouter({
        authorize: async () => ({ role: 'ops_maintainer', userId: 'maintainer-id' }),
        inbox: { list: async () => [] },
        workflow: {
          transition: async () => true,
          assign: async (input) => {
            assignments.push(input);
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
      const response = await fetch(`http://127.0.0.1:${address.port}/issues/issue/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: '__Host-ops-session=opaque',
          'X-Ops-CSRF': 'csrf-token'
        },
        body: JSON.stringify({ assignedUserId: 'f16f9426-010c-4e06-a459-9fd18c4a442d' })
      });
      expect(response.status).toBe(204);
      expect(assignments).toEqual([
        {
          issueId: 'issue',
          actorUserId: 'maintainer-id',
          assignedUserId: 'f16f9426-010c-4e06-a459-9fd18c4a442d'
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
