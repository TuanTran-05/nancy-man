import express from 'express';
import { describe, expect, it } from 'vitest';
import { createIssueRouter } from './issueRoutes.js';
describe('issue routes', () => {
  it('requires issues:read before returning inbox data', async () => {
    const app = express();
    app.use(
      '/issues',
      createIssueRouter({
        authorize: async () => ({ role: 'ops_viewer' }),
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
});
