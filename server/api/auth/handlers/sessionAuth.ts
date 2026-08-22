import { createHmac, randomBytes } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../../lib/http/types.js';
import { getPostgresPool } from '../../../db/client.js';
import { verifyTurnstileToken, isTurnstileFailure } from '../../lib/auth/turnstile.js';
import {
  constantTimeTextEqual,
  createSession,
  destroySession,
  linkGoogleProvider,
  loadSession,
  publicSessionUser,
  resolveGoogleUserAccess,
  setStaffForcePasswordChange,
  setStaffPassword,
  verifyStaffPassword,
  verifyStaffPasswordAccess,
} from '../../lib/auth/sessionStore.js';
import { validatePasswordStrength } from '../../../../shared/passwordPolicy.js';

const GOOGLE_STATE_COOKIE = 'edutrack_google_state';
const GOOGLE_STATE_TTL_SECONDS = 10 * 60;

function textHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function clientIp(req: ApiRequest): string {
  return textHeader(req.headers['x-forwarded-for']).split(',')[0]?.trim() || req.socket.remoteAddress || '';
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required');
  return 'development-session-secret-change-me';
}

function sameOriginRequest(req: ApiRequest): boolean {
  const origin = textHeader(req.headers.origin);
  if (!origin) return textHeader(req.headers['x-requested-with']) === 'XMLHttpRequest';
  const allowed = [process.env.APP_URL, process.env.PUBLIC_BASE_URL]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => new URL(value).origin);
  return allowed.includes(origin);
}

function rejectCrossSite(req: ApiRequest, res: ApiResponse): boolean {
  if (sameOriginRequest(req)) return false;
  res.status(403).json({ success: false, error: 'Cross-site request rejected' });
  return true;
}

function rateKey(req: ApiRequest, identity: string): string {
  return createHmac('sha256', sessionSecret())
    .update(`${clientIp(req)}:${identity.trim().toLowerCase()}`)
    .digest('hex');
}

async function registerLoginAttempt(keyHash: string): Promise<boolean> {
  const result = await getPostgresPool().query<{ attempts: number; blocked: boolean }>(
    `insert into auth_rate_limits (key_hash, attempts, window_started_at)
     values ($1, 1, now())
     on conflict (key_hash) do update
       set attempts = case
             when auth_rate_limits.window_started_at < now() - interval '5 minutes' then 1
             else auth_rate_limits.attempts + 1
           end,
           window_started_at = case
             when auth_rate_limits.window_started_at < now() - interval '5 minutes' then now()
             else auth_rate_limits.window_started_at
           end,
           blocked_until = case
             when auth_rate_limits.window_started_at >= now() - interval '5 minutes'
              and auth_rate_limits.attempts + 1 >= 10
             then now() + interval '5 minutes'
             else auth_rate_limits.blocked_until
           end,
           updated_at = now()
     returning attempts, coalesce(blocked_until > now(), false) as blocked`,
    [keyHash]
  );
  return result.rows[0]?.blocked !== true;
}

async function clearLoginAttempts(keyHash: string): Promise<void> {
  await getPostgresPool().query('delete from auth_rate_limits where key_hash = $1', [keyHash]);
}

export async function handleSessionLogin(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (rejectCrossSite(req, res)) return;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ success: false, error: 'Invalid credentials' });

  const keyHash = rateKey(req, email);
  if (!(await registerLoginAttempt(keyHash))) {
    return res.status(429).json({ success: false, error: 'Too many attempts. Please try again later.' });
  }

  const turnstile = await verifyTurnstileToken(req.body?.turnstileToken, {
    remoteIp: clientIp(req),
    expectedAction: 'login',
  });
  if (isTurnstileFailure(turnstile)) {
    return res.status(400).json({ success: false, error: 'Bot verification failed' });
  }

  const access = await verifyStaffPasswordAccess(email, password);
  if (!access.authenticated) {
    if (access.reason === 'revoked') {
      return res.status(403).json({
        success: false,
        reason: 'revoked',
        error: 'Account access revoked',
      });
    }
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  await clearLoginAttempts(keyHash);
  const principal = await createSession(req, res, access.userId, 'password');
  return res.status(200).json({ success: true, user: publicSessionUser(principal) });
}

export async function handleSession(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const principal = await loadSession(req);
  if (!principal) return res.status(401).json({ success: false, error: 'Not authenticated' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, user: publicSessionUser(principal) });
}

export async function handleSessionLogout(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (rejectCrossSite(req, res)) return;
  await destroySession(req, res);
  return res.status(200).json({ success: true });
}

export async function handleChangeStaffPassword(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (rejectCrossSite(req, res)) return;
  const principal = await loadSession(req);
  if (!principal || !['admin', 'teacher', 'accounting', 'office'].includes(principal.role)) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const policy = validatePasswordStrength(newPassword, 'en');
  if (!currentPassword || !policy.valid) {
    return res.status(400).json({ success: false, error: policy.error || 'Invalid password' });
  }
  if (!principal.email || (await verifyStaffPassword(principal.email, currentPassword)) !== principal.authUid) {
    return res.status(401).json({ success: false, error: 'Current password is incorrect' });
  }
  await setStaffPassword(principal.authUid, newPassword);
  await setStaffForcePasswordChange(principal.authUid, false);
  const renewed = await createSession(req, res, principal.authUid, 'password');
  return res.status(200).json({ success: true, user: publicSessionUser(renewed) });
}

type GoogleState = {
  nonce: string;
  returnTo: string;
  expiresAt: number;
  mode: 'login' | 'link';
  userId?: string;
};

function encodeGoogleState(value: GoogleState): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeGoogleState(value: string): GoogleState | null {
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  if (!constantTimeTextEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleState;
    if (!parsed.nonce || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null;
    if (!parsed.returnTo.startsWith('/') || parsed.returnTo.startsWith('//')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function googleRedirectUri(): string {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('PUBLIC_BASE_URL is required for Google login');
  return `${base}/api/v1/auth/google-callback`;
}

function stateCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/v1/auth/google-callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(req: ApiRequest, name: string): string {
  for (const part of textHeader(req.headers.cookie).split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export async function handleGoogleStart(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (rejectCrossSite(req, res)) return;

  const turnstile = await verifyTurnstileToken(req.body?.turnstileToken, {
    remoteIp: clientIp(req),
    expectedAction: 'login',
  });
  if (isTurnstileFailure(turnstile)) {
    return res.status(400).json({ success: false, error: 'Bot verification failed' });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!clientId) return res.status(503).json({ success: false, error: 'Google login is not configured' });
  const returnTo = typeof req.body?.returnTo === 'string' && req.body.returnTo.startsWith('/') && !req.body.returnTo.startsWith('//')
    ? req.body.returnTo
    : '/';
  const state = encodeGoogleState({
    nonce: randomBytes(24).toString('base64url'),
    returnTo,
    expiresAt: Date.now() + GOOGLE_STATE_TTL_SECONDS * 1000,
    mode: 'login',
  });
  res.setHeader('Set-Cookie', stateCookie(createHmac('sha256', sessionSecret()).update(state).digest('base64url'), GOOGLE_STATE_TTL_SECONDS));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return res.status(200).json({
    success: true,
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
}

export async function handleGoogleLinkStart(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (rejectCrossSite(req, res)) return;
  const principal = await loadSession(req);
  if (!principal?.email || !['admin', 'teacher', 'accounting', 'office'].includes(principal.role)) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!clientId) return res.status(503).json({ success: false, error: 'Google login is not configured' });
  const returnTo = typeof req.body?.returnTo === 'string' && req.body.returnTo.startsWith('/') && !req.body.returnTo.startsWith('//')
    ? req.body.returnTo
    : '/profile';
  const state = encodeGoogleState({
    nonce: randomBytes(24).toString('base64url'),
    returnTo,
    expiresAt: Date.now() + GOOGLE_STATE_TTL_SECONDS * 1000,
    mode: 'link',
    userId: principal.authUid,
  });
  res.setHeader('Set-Cookie', stateCookie(createHmac('sha256', sessionSecret()).update(state).digest('base64url'), GOOGLE_STATE_TTL_SECONDS));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return res.status(200).json({
    success: true,
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
}

export async function handleGoogleCallback(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const rawState = typeof req.query.state === 'string' ? req.query.state : '';
  const state = decodeGoogleState(rawState);
  const expectedCookie = createHmac('sha256', sessionSecret()).update(rawState).digest('base64url');
  if (!code || !state || !constantTimeTextEqual(readCookie(req, GOOGLE_STATE_COOKIE), expectedCookie)) {
    return res.redirect(303, '/login?authError=invalid_google_state');
  }
  res.appendHeader('Set-Cookie', stateCookie('', 0));

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return res.redirect(303, '/login?authError=google_not_configured');

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('Google token exchange failed');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileResponse.json()) as { sub?: string; email?: string; email_verified?: boolean };
    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
      throw new Error('Google email is not verified');
    }
    if (state.mode === 'link') {
      const principal = await loadSession(req);
      if (!principal || !state.userId || principal.authUid !== state.userId) {
        return res.redirect(303, '/login?authError=link_session_expired');
      }
      if (!(await linkGoogleProvider(principal.authUid, profile.sub, profile.email))) {
        return res.redirect(303, `${state.returnTo}?authError=google_email_mismatch`);
      }
      await createSession(req, res, principal.authUid, 'google');
      return res.redirect(303, `${state.returnTo}${state.returnTo.includes('?') ? '&' : '?'}googleLinked=1`);
    }
    const access = await resolveGoogleUserAccess(profile.email, profile.sub);
    if (!access.allowed) {
      return res.redirect(303, `/login?authError=${access.reason}`);
    }
    const userId = access.userId;
    await linkGoogleProvider(userId, profile.sub, profile.email);
    await createSession(req, res, userId, 'google');
    return res.redirect(303, state.returnTo);
  } catch (error) {
    console.error('[auth/google-callback] login failed', error);
    return res.redirect(303, '/login?authError=google_failed');
  }
}
