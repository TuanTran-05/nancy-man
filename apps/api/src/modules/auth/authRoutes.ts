import express, { type Request, type Router } from 'express';
import { z } from 'zod';

type BeginLoginResult =
  | { status: 'denied' }
  | { status: 'mfa_required'; mfaChallenge: string; factors: readonly unknown[] };
type CompleteTotpResult =
  | { status: 'denied' }
  | {
      status: 'authenticated';
      sessionToken: string;
      csrfToken: string;
      role: 'ops_viewer' | 'ops_maintainer' | 'ops_owner';
      idleExpiresAt: string;
      absoluteExpiresAt: string;
    };

function requestMetadata(request: Request, hashClientIp: (ip: string) => string) {
  return {
    ipHash: hashClientIp(request.ip || request.socket.remoteAddress || 'unknown'),
    userAgent: request.get('user-agent') ?? 'unknown'
  };
}

const loginBody = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(1_024)
});
const totpBody = z.object({
  mfaChallenge: z.string().min(32).max(256),
  factorId: z.string().uuid(),
  token: z.string().regex(/^\d{6}$/)
});
const enrollmentStartBody = z.object({
  userId: z.string().uuid(),
  token: z.string().min(32).max(256)
});
const enrollmentVerifyBody = enrollmentStartBody.extend({
  factorId: z.string().uuid(),
  otp: z.string().regex(/^\d{6}$/)
});

export function createAuthRouter(input: {
  service: {
    beginLogin: (input: {
      identifier: string;
      password: string;
      ipHash: string;
      userAgent: string;
    }) => Promise<BeginLoginResult>;
    completeTotpLogin: (input: {
      mfaChallenge: string;
      factorId: string;
      token: string;
      ipHash: string;
      userAgent: string;
    }) => Promise<CompleteTotpResult>;
  };
  hashClientIp: (ip: string) => string;
  session?: {
    authorize: (input: {
      cookieHeader?: string;
      csrfToken?: string;
      mutation: boolean;
    }) => Promise<{ sessionId: string; userId: string; role: string } | null>;
    revoke: (sessionId: string) => Promise<void>;
  };
  bootstrap?: {
    start: (input: {
      userId: string;
      token: string;
    }) => Promise<{ factorId: string; secret: string; otpauthUri: string } | null>;
    verify: (input: {
      userId: string;
      token: string;
      factorId: string;
      otp: string;
    }) => Promise<boolean>;
  };
}): Router {
  const router = express.Router();
  router.use(express.json({ limit: '8kb' }));
  router.post('/login', async (request, response, next) => {
    try {
      const parsed = loginBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_LOGIN_REQUEST' });
      const result = await input.service.beginLogin({
        ...parsed.data,
        ...requestMetadata(request, input.hashClientIp)
      });
      if (result.status === 'denied') return response.status(401).json({ code: 'AUTH_DENIED' });
      return response.status(202).json({
        status: result.status,
        mfaChallenge: result.mfaChallenge,
        factors: result.factors
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/bootstrap/totp/start', async (request, response, next) => {
    try {
      const parsed = enrollmentStartBody.safeParse(request.body);
      if (!parsed.success || !input.bootstrap)
        return response.status(400).json({ code: 'INVALID_ENROLLMENT_REQUEST' });
      const result = await input.bootstrap.start(parsed.data);
      return result
        ? response.status(200).json(result)
        : response.status(401).json({ code: 'ENROLLMENT_DENIED' });
    } catch (error) {
      next(error);
    }
  });
  router.post('/bootstrap/totp/verify', async (request, response, next) => {
    try {
      const parsed = enrollmentVerifyBody.safeParse(request.body);
      if (!parsed.success || !input.bootstrap)
        return response.status(400).json({ code: 'INVALID_ENROLLMENT_REQUEST' });
      return (await input.bootstrap.verify(parsed.data))
        ? response.status(204).end()
        : response.status(401).json({ code: 'ENROLLMENT_DENIED' });
    } catch (error) {
      next(error);
    }
  });
  router.post('/login/totp', async (request, response, next) => {
    try {
      const parsed = totpBody.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_MFA_REQUEST' });
      const result = await input.service.completeTotpLogin({
        ...parsed.data,
        ...requestMetadata(request, input.hashClientIp)
      });
      if (result.status !== 'authenticated')
        return response.status(401).json({ code: 'AUTH_DENIED' });
      response.cookie('__Host-ops-session', result.sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 30 * 60 * 1_000
      });
      return response.status(200).json({
        csrfToken: result.csrfToken,
        role: result.role,
        idleExpiresAt: result.idleExpiresAt,
        absoluteExpiresAt: result.absoluteExpiresAt
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/session', async (request, response, next) => {
    try {
      const cookieHeader = request.get('cookie');
      const principal = await input.session?.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
      return response.status(200).json({ userId: principal.userId, role: principal.role });
    } catch (error) {
      next(error);
    }
  });
  router.post('/logout', async (request, response, next) => {
    try {
      const cookieHeader = request.get('cookie');
      const csrfToken = request.get('X-Ops-CSRF');
      const principal = await input.session?.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        ...(csrfToken ? { csrfToken } : {}),
        mutation: true
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
      await input.session?.revoke(principal.sessionId);
      response.clearCookie('__Host-ops-session', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/'
      });
      return response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
