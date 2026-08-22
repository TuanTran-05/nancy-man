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
      const body = { userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d', token: 'a'.repeat(32) };
      const start = await fetch(`http://127.0.0.1:${address.port}/auth/bootstrap/totp/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      expect(start.status).toBe(200);
      const verify = await fetch(`http://127.0.0.1:${address.port}/auth/bootstrap/totp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, factorId: body.userId, otp: '123456' })
      });
      expect(verify.status).toBe(204);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
