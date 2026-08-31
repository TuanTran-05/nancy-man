import express from 'express';
import { describe, expect, it } from 'vitest';

import { createAccountRouter } from './accountRoutes.js';

const principal = {
  sessionId: 'session-id',
  userId: 'owner-id',
  username: 'tuan.dev',
  displayName: 'Tuan Dev',
  role: 'ops_owner' as const
};
const authorization = {
  grantId: 'grant-id',
  capability: 'accounts_write' as const,
  userId: principal.userId,
  sessionId: principal.sessionId,
  ipHash: 'a'.repeat(64),
  userAgentHash: 'b'.repeat(64)
};

async function withServer(app: express.Express, action: (origin: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  try {
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('createAccountRouter', () => {
  it('denies unauthenticated and non-owner account administration', async () => {
    const app = express();
    app.use(
      '/users',
      createAccountRouter({
        service: {} as never,
        session: { authorize: async () => null },
        resolveAuthorization: () => authorization
      })
    );
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/users`, { headers: { Origin: 'https://man.thienuy.edu.vn' } });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ code: 'AUTH_DENIED' });
    });
  });

  it('creates users through canonical session, origin, csrf, and hidden step-up binding', async () => {
    const calls: unknown[] = [];
    const app = express();
    app.use(
      '/users',
      createAccountRouter({
        service: {
          list: async () => [],
          create: async (input) => {
            calls.push(input);
            return {
              userId: 'new-user',
              enrollmentUrl: 'https://man.thienuy.edu.vn/bootstrap/mfa?token=one-time',
              expiresAt: '2026-09-01T12:00:00.000Z'
            };
          }
        } as never,
        session: { authorize: async () => principal },
        resolveAuthorization: () => authorization
      })
    );
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/users`, {
        method: 'POST',
        headers: {
          Origin: 'https://man.thienuy.edu.vn',
          'X-Ops-CSRF': 'csrf-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'ops-new',
          email: 'new@example.test',
          displayName: 'New User'
        })
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toMatchObject({ userId: 'new-user' });
      expect(calls[0]).toMatchObject({ actorUserId: 'owner-id', authorization });
    });
  });

  it('rejects forged role fields and exposes no grant id in authorization responses', async () => {
    const app = express();
    app.use(
      '/users',
      createAccountRouter({
        service: { create: async () => { throw new Error('UNEXPECTED'); } } as never,
        session: { authorize: async () => principal },
        resolveAuthorization: () => authorization
      })
    );
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/users`, {
        method: 'POST',
        headers: {
          Origin: 'https://man.thienuy.edu.vn',
          'X-Ops-CSRF': 'csrf-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: 'ops-new', email: 'new@example.test', displayName: 'New', extra: 'nope' })
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ code: 'INVALID_ACCOUNT_REQUEST' });
    });
  });
});
