import type { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import type { createAuthService } from '../security/auth.js';

export type AuthService = ReturnType<typeof createAuthService>;
export interface SessionRequest extends Request {
  opsSession?: ReturnType<AuthService['requireSession']>;
}

const credentialsSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
    totp: z.string().regex(/^\d{6}$/u)
  })
  .strict();

export function readSessionCookie(request: Request): string | null {
  const raw = request.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === '__Host-ops_session') return value.join('=') || null;
  }
  return null;
}

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

export function requireOpsSession(auth: AuthService) {
  return (request: SessionRequest, response: Response, next: NextFunction): void => {
    noStore(response);
    const token = readSessionCookie(request);
    if (!token) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      request.opsSession = auth.requireSession(token);
      next();
    } catch {
      response.status(401).json({ error: 'unauthorized' });
    }
  };
}

export function attachAuthRoutes(router: Router, auth: AuthService): void {
  router.post('/api/session', async (request, response) => {
    noStore(response);
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    try {
      const session = await auth.authenticate(parsed.data);
      response.setHeader(
        'Set-Cookie',
        `__Host-ops_session=${session.token}; Max-Age=28800; Path=/; Secure; HttpOnly; SameSite=Strict`
      );
      response.status(201).json({
        username: session.username,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt
      });
    } catch {
      response.status(401).json({ error: 'Invalid credentials' });
    }
  });

  router.get('/api/session', requireOpsSession(auth), (request: SessionRequest, response) => {
    noStore(response);
    response.json({
      username: request.opsSession!.username,
      csrfToken: request.opsSession!.csrfToken,
      expiresAt: request.opsSession!.expiresAt
    });
  });

  router.delete('/api/session', requireOpsSession(auth), (request: SessionRequest, response) => {
    noStore(response);
    const csrf = request.header('X-CSRF-Token');
    if (!csrf || !auth.verifySessionCsrf(request.opsSession!, csrf)) {
      response.status(403).json({ error: 'csrf_required' });
      return;
    }
    const token = readSessionCookie(request);
    if (token) auth.destroySession(token);
    response.setHeader(
      'Set-Cookie',
      '__Host-ops_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict'
    );
    response.status(204).end();
  });
}
