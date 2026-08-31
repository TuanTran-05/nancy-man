import express from 'express';
import { describe, expect, it } from 'vitest';

import { createAuthRouter } from './authRoutes.js';

describe('createAuthRouter', () => {
  it('keeps password failure generic and issues a host-only strict session cookie only after MFA', async () => {
    const app = express();
    app.use(
      '/auth',
      createAuthRouter({
        service: {
          beginLogin: async () => ({ status: 'denied' as const }),
          completeTotpLogin: async () => ({
            status: 'authenticated' as const,
            sessionToken: 'opaque-session',
            csrfToken: 'csrf-token',
            role: 'ops_owner' as const,
            idleExpiresAt: '2026-08-22T03:44:00.000Z',
            absoluteExpiresAt: '2026-08-22T15:14:00.000Z'
          })
        },
        hashClientIp: () => 'a'.repeat(64)
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test server');

    try {
      const denied = await fetch(`http://127.0.0.1:${address.port}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'ops.owner', password: 'wrong' })
      });
      expect(denied.status).toBe(401);
      await expect(denied.json()).resolves.toEqual({ code: 'AUTH_DENIED' });

      const authenticated = await fetch(`http://127.0.0.1:${address.port}/auth/login/totp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mfaChallenge: 'c'.repeat(32),
          factorId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          token: '123456'
        })
      });
      expect(authenticated.status).toBe(200);
      expect(authenticated.headers.get('set-cookie')).toContain(
        '__Host-ops-session=opaque-session'
      );
      expect(authenticated.headers.get('set-cookie')).toContain('HttpOnly');
      expect(authenticated.headers.get('set-cookie')).toContain('SameSite=Strict');
      await expect(authenticated.json()).resolves.toMatchObject({
        csrfToken: 'csrf-token',
        role: 'ops_owner'
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('exposes only token-gated bootstrap TOTP start and verification', async () => {
    const app = express();
    app.use(
      '/auth',
      createAuthRouter({
        service: {
          beginLogin: async () => ({ status: 'denied' as const }),
          completeTotpLogin: async () => ({ status: 'denied' as const })
        },
        hashClientIp: () => 'a'.repeat(64),
        bootstrap: {
          start: async () => ({
            factorId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
            secret: 'SECRET',
            otpauthUri: 'otpauth://totp/test'
          }),
          verify: async () => true
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    try {
      const body = {
        userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        token: 'a'.repeat(32)
      };
      const start = await fetch(`http://127.0.0.1:${address.port}/auth/bootstrap/totp/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      expect(start.status).toBe(200);
      const verify = await fetch(`http://127.0.0.1:${address.port}/auth/bootstrap/totp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          factorId: body.userId,
          otp: '123456',
          password: 'a-long-new-password'
        })
      });
      expect(verify.status).toBe(204);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('requires a CSRF-protected maintainer session and fresh TOTP proof to elevate SQL access', async () => {
    const grants: unknown[] = [];
    const app = express();
    app.use(
      '/auth',
      createAuthRouter({
        service: {
          beginLogin: async () => ({ status: 'denied' as const }),
          completeTotpLogin: async () => ({ status: 'denied' as const })
        },
        sqlElevation: {
          grant: async (input) => {
            grants.push(input);
            return {
              status: 'granted' as const,
              idleExpiresAt: '2026-08-22T10:15:00.000Z',
              absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
            };
          }
        },
        hashClientIp: () => 'a'.repeat(64),
        session: {
          authorize: async ({ csrfToken, mutation }) =>
            mutation && csrfToken !== 'csrf-token'
              ? null
              : {
                  sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
                  userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
                  role: 'ops_maintainer'
                },
          revoke: async () => undefined
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test server');
    const body = {
      factorId: 'f16f9426-010c-4e06-a459-9fd18c4a442f',
      token: '123456',
      reason: 'Investigate database error'
    };
    try {
      const denied = await fetch(`http://127.0.0.1:${address.port}/auth/sql-elevation/totp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      expect(denied.status).toBe(401);

      const granted = await fetch(`http://127.0.0.1:${address.port}/auth/sql-elevation/totp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ops-CSRF': 'csrf-token' },
        body: JSON.stringify(body)
      });
      expect(granted.status).toBe(200);
      await expect(granted.json()).resolves.toEqual({
        idleExpiresAt: '2026-08-22T10:15:00.000Z',
        absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
      });
      expect(grants).toEqual([
        {
          userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
          ...body
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('returns only an expiry for an owner account step-up authorization', async () => {
    const grants: unknown[] = [];
    const app = express();
    app.use(
      '/auth',
      createAuthRouter({
        service: {
          beginLogin: async () => ({ status: 'denied' as const }),
          completeTotpLogin: async () => ({ status: 'denied' as const })
        },
        hashClientIp: () => 'a'.repeat(64),
        session: {
          authorize: async ({ mutation, csrfToken }) =>
            mutation && csrfToken === 'csrf-token'
              ? { sessionId: 'session-id', userId: 'owner-id', role: 'ops_owner' as const }
              : null,
          revoke: async () => undefined
        },
        stepUp: {
          grant: async (input) => {
            grants.push(input);
            return { id: 'internal-grant-id', expiresAt: '2026-08-31T12:05:00.000Z' };
          }
        }
      })
    );
    await withTestServer(app, async (origin) => {
      const response = await fetch(`${origin}/auth/accounts/authorization`, {
        method: 'POST',
        headers: {
          Origin: 'https://man.thienuy.edu.vn',
          Cookie: '__Host-ops-session=session-token',
          'X-Ops-CSRF': 'csrf-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          password: 'a-long-new-password',
          factorId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          token: '123456'
        })
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        authorizedUntil: '2026-08-31T12:05:00.000Z'
      });
      expect(JSON.stringify(grants)).not.toContain('internal-grant-id');
    });
  });
});

async function withTestServer(app: express.Express, action: (origin: string) => Promise<void>) {
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
