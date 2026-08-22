import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../http/types.js';
import { getPostgresPool } from '../../../db/client.js';
import { normalizeAuthRole, type AuthRole } from './roles.js';
import {
  hashStudentPassword,
  studentDobMatches,
  verifyStudentPassword,
} from '../student/studentPassword.js';

const SESSION_COOKIE = 'edutrack_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const STAFF_ROLES = new Set<AuthRole>(['admin', 'teacher', 'accounting', 'office']);

export type SessionProvider = 'password' | 'google' | 'student' | 'parent';

export type SessionPrincipal = {
  /** Native PostgreSQL identity used for credentials, providers, and auth sessions. */
  authUid: string;
  /** Application profile/document id used by academic ownership fields. */
  uid: string;
  email?: string;
  displayName: string;
  bio?: string;
  phone?: string;
  faceImage?: string;
  role: AuthRole;
  studentId?: string;
  classId?: string;
  teacherId?: string;
  forcePasswordChange: boolean;
  provider: SessionProvider;
  googleLinked: boolean;
};

export type DecodedAuthToken = {
  uid: string;
  email?: string;
  role: AuthRole;
  studentId?: string;
  name: string;
  auth_time: number;
  iat: number;
  exp: number;
  aud: string;
  iss: string;
  sub: string;
  [key: string]: unknown;
};

type SessionRow = {
  auth_user_id: string;
  user_id: string;
  email: string | null;
  display_name: string;
  bio: string | null;
  phone: string | null;
  face_image: string | null;
  role: string;
  student_id: string | null;
  class_id: string | null;
  teacher_id: string | null;
  force_password_change: boolean;
  user_revoked: boolean;
  staff_status: string | null;
  student_lifecycle: string | null;
  student_revoked: boolean | null;
  provider: SessionProvider;
  google_linked: boolean;
  created_at: Date;
  expires_at: Date;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function cookieValue(req: ApiRequest, name: string): string {
  const raw = headerValue(req.headers.cookie);
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export function readSessionToken(req: ApiRequest): string {
  const authorization = headerValue(req.headers.authorization);
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  return cookieValue(req, SESSION_COOKIE);
}

function sessionCookie(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clientFingerprint(req: ApiRequest): { ipHash: string | null; userAgent: string } {
  const forwarded = headerValue(req.headers['x-forwarded-for']).split(',')[0]?.trim();
  const ip = forwarded || req.socket.remoteAddress || '';
  const pepper = process.env.SESSION_SECRET?.trim() || '';
  return {
    ipHash: ip && pepper ? createHash('sha256').update(`${pepper}:${ip}`).digest('hex') : null,
    userAgent: headerValue(req.headers['user-agent']).slice(0, 500),
  };
}

function isPrincipalActive(row: SessionRow, role: AuthRole): boolean {
  if (row.user_revoked) return false;
  if (STAFF_ROLES.has(role)) return row.staff_status === 'allowed';
  if (role === 'student' || role === 'parent') {
    return (
      row.student_revoked !== true &&
      row.student_lifecycle !== null &&
      row.student_lifecycle !== 'archived'
    );
  }
  return false;
}

function principalFromRow(row: SessionRow): SessionPrincipal | null {
  const role = normalizeAuthRole(row.role);
  if (!role || !isPrincipalActive(row, role)) return null;
  return {
    authUid: row.auth_user_id || row.user_id,
    uid: row.user_id,
    ...(row.email ? { email: row.email } : {}),
    displayName: row.display_name,
    ...(row.bio ? { bio: row.bio } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.face_image ? { faceImage: row.face_image } : {}),
    role,
    ...(row.student_id ? { studentId: row.student_id } : {}),
    ...(row.class_id ? { classId: row.class_id } : {}),
    ...(row.teacher_id ? { teacherId: row.teacher_id } : {}),
    forcePasswordChange: row.force_password_change,
    provider: row.provider,
    googleLinked: row.google_linked,
  };
}

async function findSession(token: string): Promise<SessionRow | null> {
  if (!token) return null;
  const result = await getPostgresPool().query<SessionRow>(
    `select s.user_id as auth_user_id,
            coalesce(profile.document_id, s.user_id) as user_id,
            u.email,
            coalesce(nullif(profile.data ->> 'displayName', ''), u.display_name) as display_name,
            coalesce(profile.data ->> 'bio', u.bio) as bio,
            coalesce(nullif(profile.data ->> 'phone', ''), u.phone) as phone,
            nullif(profile.data ->> 'faceImage', '') as face_image,
            u.role,
            u.student_id,
            nullif(profile.data ->> 'classId', '') as class_id,
            nullif(profile.data ->> 'teacherId', '') as teacher_id,
            u.force_password_change,
            u.is_revoked as user_revoked,
            access.status as staff_status,
            student.student_lifecycle,
            student.is_revoked as student_revoked,
            s.provider,
            exists (
              select 1 from auth_user_providers provider_link
               where provider_link.user_id = u.id
                 and provider_link.provider = 'google'
            ) as google_linked,
            s.created_at,
            s.expires_at
       from auth_sessions s
       join users u on u.id = s.user_id
       left join staff_email_access access on access.email = lower(u.email)
       left join students student on student.id = u.student_id
       left join lateral (
         select document_id, data
           from app_documents user_profile
          where user_profile.collection_path = 'users'
            and coalesce(user_profile.data ->> 'role', u.role) = u.role
            and (
              user_profile.document_id = u.id
              or (
                u.email is not null
                and lower(coalesce(user_profile.data ->> 'email', '')) = lower(u.email)
              )
            )
          order by (user_profile.document_id = u.id) desc, user_profile.updated_at desc
          limit 1
       ) profile on true
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1`,
    [sha256(token)]
  );
  return result.rows[0] || null;
}

export async function loadSession(req: ApiRequest): Promise<SessionPrincipal | null> {
  const token = readSessionToken(req);
  const row = await findSession(token);
  if (!row) return null;
  const principal = principalFromRow(row);
  if (!principal) return null;
  void getPostgresPool()
    .query(
      `update auth_sessions
          set last_seen_at = now()
        where token_hash = $1
          and last_seen_at < now() - interval '5 minutes'`,
      [sha256(token)]
    )
    .catch((error) => console.error('[auth] failed to update session activity', error));
  return principal;
}

export async function createSession(
  req: ApiRequest,
  res: ApiResponse,
  userId: string,
  provider: SessionProvider
): Promise<SessionPrincipal> {
  const token = randomBytes(32).toString('base64url');
  const fingerprint = clientFingerprint(req);
  await getPostgresPool().query(
    `insert into auth_sessions
       (token_hash, user_id, provider, expires_at, ip_hash, user_agent)
     values ($1, $2, $3, now() + ($4 * interval '1 second'), $5, $6)`,
    [sha256(token), userId, provider, SESSION_TTL_SECONDS, fingerprint.ipHash, fingerprint.userAgent]
  );
  const row = await findSession(token);
  const principal = row && principalFromRow(row);
  if (!principal) {
    await getPostgresPool().query('delete from auth_sessions where token_hash = $1', [sha256(token)]);
    throw Object.assign(new Error('Account is not allowed to sign in'), {
      statusCode: 403,
      reason: 'not_allowed',
    });
  }
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_SECONDS));
  return principal;
}

export async function destroySession(req: ApiRequest, res: ApiResponse): Promise<void> {
  const token = readSessionToken(req);
  if (token) {
    await getPostgresPool().query(
      'update auth_sessions set revoked_at = coalesce(revoked_at, now()) where token_hash = $1',
      [sha256(token)]
    );
  }
  res.setHeader('Set-Cookie', sessionCookie('', 0));
}

export function decodedFromSession(
  principal: SessionPrincipal,
  now = Math.floor(Date.now() / 1000)
): DecodedAuthToken {
  return {
    uid: principal.uid,
    ...(principal.email ? { email: principal.email } : {}),
    role: principal.role,
    ...(principal.studentId ? { studentId: principal.studentId } : {}),
    ...(principal.classId ? { classId: principal.classId } : {}),
    ...(principal.teacherId ? { teacherId: principal.teacherId } : {}),
    name: principal.displayName,
    auth_time: now,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    aud: 'edutrack-vps',
    iss: 'edutrack-vps',
    sub: principal.uid,
  };
}

export function publicSessionUser(principal: SessionPrincipal) {
  const primaryProvider =
    principal.provider === 'google'
      ? 'google.com'
      : principal.provider === 'password'
        ? 'password'
        : 'edutrack.student';
  const providerData = [
    {
      providerId: primaryProvider,
      displayName: principal.displayName,
      email: principal.email || null,
      photoURL: null,
    },
  ];
  if (principal.googleLinked && primaryProvider !== 'google.com') {
    providerData.push({
      providerId: 'google.com',
      displayName: principal.displayName,
      email: principal.email || null,
      photoURL: null,
    });
  }
  return {
    uid: principal.uid,
    email: principal.email || null,
    displayName: principal.displayName,
    bio: principal.bio || null,
    phone: principal.phone || null,
    faceImage: principal.faceImage || null,
    role: principal.role,
    studentId: principal.studentId || null,
    classId: principal.classId || null,
    teacherId: principal.teacherId || null,
    forcePasswordChange: principal.forcePasswordChange,
    emailVerified: Boolean(principal.email),
    isAnonymous: false,
    tenantId: null,
    providerData,
  };
}

type StaffCredentialRow = {
  user_id: string;
  password_hash: string;
  password_salt: string;
  password_version: number;
  status: string;
  is_revoked: boolean;
};

export type StaffPasswordAccessResult =
  | { authenticated: true; userId: string }
  | { authenticated: false; reason: 'invalid_credentials' | 'revoked' };

export async function verifyStaffPasswordAccess(
  email: string,
  password: string
): Promise<StaffPasswordAccessResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await getPostgresPool().query<StaffCredentialRow>(
    `select u.id as user_id,
            credentials.password_hash,
            credentials.password_salt,
            credentials.password_version,
            access.status,
            u.is_revoked
       from users u
       join staff_email_access access on access.email = lower(u.email)
       join staff_password_credentials credentials on credentials.user_id = u.id
      where lower(u.email) = $1
      limit 1`,
    [normalizedEmail]
  );
  const row = result.rows[0];
  if (
    !row ||
    !verifyStudentPassword(password, row.password_salt, row.password_hash, row.password_version)
  ) {
    return { authenticated: false, reason: 'invalid_credentials' };
  }
  if (row.status !== 'allowed' || row.is_revoked) {
    return { authenticated: false, reason: 'revoked' };
  }
  return { authenticated: true, userId: row.user_id };
}

export async function verifyStaffPassword(email: string, password: string): Promise<string | null> {
  const result = await verifyStaffPasswordAccess(email, password);
  return result.authenticated ? result.userId : null;
}

export async function findStaffUserIdByEmail(email: string): Promise<string | null> {
  const result = await getPostgresPool().query<{ id: string }>(
    'select id from users where lower(email) = $1 limit 1',
    [email.trim().toLowerCase()]
  );
  return result.rows[0]?.id || null;
}

export async function createStaffIdentity(input: {
  email: string;
  displayName: string;
  role: 'teacher' | 'accounting' | 'office' | 'admin';
  password: string;
  phone?: string;
  forcePasswordChange?: boolean;
}): Promise<{ uid: string; createdAt: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const uid = randomUUID();
  const credential = hashStudentPassword(input.password);
  const email = input.email.trim().toLowerCase();
  try {
    await client.query('begin');
    await client.query(
      `insert into users
         (id, email, display_name, role, phone, force_password_change, is_revoked)
       values ($1, $2, $3, $4, $5, $6, false)`,
      [
        uid,
        email,
        input.displayName,
        input.role,
        input.phone || null,
        input.forcePasswordChange ?? true,
      ]
    );
    await client.query(
      `insert into staff_email_access (email, status, role, added_at, added_by_admin)
       values ($1, 'allowed', $2, now(), true)
       on conflict (email) do update
         set status = 'allowed',
             role = excluded.role,
             blocked_at = null,
             blocked_by = null,
             updated_at = now()`,
      [email, input.role]
    );
    await client.query(
      `insert into staff_password_credentials
         (user_id, password_hash, password_salt, password_version)
       values ($1, $2, $3, 2)`,
      [uid, credential.hash, credential.salt]
    );
    await client.query('commit');
    return { uid, createdAt: new Date().toISOString() };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Compensating cleanup for a staff identity that was created by the current
 * request but could not be fully provisioned. This is deliberately separate
 * from normal account deletion, which remains a revocation so historical
 * foreign-key references stay intact.
 */
export async function rollbackCreatedStaffIdentity(userId: string, email: string): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const normalizedEmail = email.trim().toLowerCase();
  try {
    await client.query('begin');
    await client.query(
      `delete from app_documents
        where (collection_path = 'users' and document_id = $1)
           or (collection_path in ('allowed_teachers', 'blocked_teachers') and document_id = $2)`,
      [userId, normalizedEmail]
    );
    await client.query('delete from users where id = $1', [userId]);
    await client.query('delete from staff_email_access where email = $1', [normalizedEmail]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function setStaffPassword(userId: string, password: string): Promise<void> {
  const credential = hashStudentPassword(password);
  await getPostgresPool().query(
    `insert into staff_password_credentials
       (user_id, password_hash, password_salt, password_version, changed_at)
     values ($1, $2, $3, 2, now())
     on conflict (user_id) do update
       set password_hash = excluded.password_hash,
           password_salt = excluded.password_salt,
           password_version = 2,
           changed_at = now(),
           updated_at = now()`,
    [userId, credential.hash, credential.salt]
  );
  await getPostgresPool().query(
    `update auth_sessions
        set revoked_at = now()
      where user_id = $1 and revoked_at is null`,
    [userId]
  );
}

export async function setStaffForcePasswordChange(
  userId: string,
  forcePasswordChange: boolean
): Promise<void> {
  await getPostgresPool().query(
    `update users set force_password_change = $2, updated_at = now() where id = $1`,
    [userId, forcePasswordChange]
  );
}

export async function revokeStaffIdentity(userId: string): Promise<void> {
  await getPostgresPool().query(
    `update users set is_revoked = true, updated_at = now() where id = $1`,
    [userId]
  );
  await getPostgresPool().query(
    `update auth_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1`,
    [userId]
  );
}

export async function revokeStaffIdentitiesByEmail(email: string): Promise<number> {
  const normalized = email.trim().toLowerCase();
  const result = await getPostgresPool().query<{ id: string }>(
    `update users
        set is_revoked = true, updated_at = now()
      where lower(email) = $1
      returning id`,
    [normalized]
  );
  await getPostgresPool().query(
    `update staff_email_access
        set status = 'blocked', blocked_at = now(), updated_at = now()
      where email = $1`,
    [normalized]
  );
  if (result.rows.length) {
    await getPostgresPool().query(
      `update auth_sessions
          set revoked_at = coalesce(revoked_at, now())
        where user_id = any($1::text[])`,
      [result.rows.map((row) => row.id)]
    );
  }
  return result.rows.length;
}

export async function ensureStudentSessionUser(input: {
  userId: string;
  studentId: string;
  role: 'student' | 'parent';
  displayName: string;
  forcePasswordChange: boolean;
}): Promise<void> {
  await getPostgresPool().query(
    `insert into users
       (id, display_name, role, student_id, force_password_change, is_revoked)
     values ($1, $2, $3, $4, $5, false)
     on conflict (id) do update
       set display_name = excluded.display_name,
           role = excluded.role,
           student_id = excluded.student_id,
           force_password_change = excluded.force_password_change,
           updated_at = now()`,
    [
      input.userId,
      input.displayName,
      input.role,
      input.studentId,
      input.forcePasswordChange,
    ]
  );
}

export type GoogleUserAccessResult =
  | { allowed: true; userId: string }
  | { allowed: false; reason: 'not_allowed' | 'revoked' };

export async function resolveGoogleUserAccess(
  email: string,
  providerSubject?: string
): Promise<GoogleUserAccessResult> {
  const result = await getPostgresPool().query<{
    id: string;
    status: string | null;
    is_revoked: boolean;
  }>(
    `select u.id, access.status, u.is_revoked
       from users u
       left join staff_email_access access on access.email = lower(u.email)
       left join auth_user_providers provider_link
         on provider_link.user_id = u.id
        and provider_link.provider = 'google'
      where (
          ($2::text is not null and provider_link.provider_subject = $2)
          or lower(u.email) = $1
        )
      order by (provider_link.provider_subject = $2) desc nulls last
      limit 1`,
    [email.trim().toLowerCase(), providerSubject || null]
  );
  const row = result.rows[0];
  if (!row) return { allowed: false, reason: 'not_allowed' };
  if (row.is_revoked || row.status === 'blocked') {
    return { allowed: false, reason: 'revoked' };
  }
  if (row.status !== 'allowed') return { allowed: false, reason: 'not_allowed' };
  return { allowed: true, userId: row.id };
}

export async function findAllowedGoogleUser(
  email: string,
  providerSubject?: string
): Promise<string | null> {
  const result = await resolveGoogleUserAccess(email, providerSubject);
  return result.allowed ? result.userId : null;
}

export async function linkGoogleProvider(
  userId: string,
  providerSubject: string,
  email: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await getPostgresPool().query(
    `insert into auth_user_providers
       (user_id, provider, provider_subject, provider_email)
     select id, 'google', $2, $3
       from users
      where id = $1 and lower(email) = $3 and is_revoked = false
     on conflict (user_id, provider) do update
       set provider_subject = excluded.provider_subject,
           provider_email = excluded.provider_email,
           updated_at = now()`,
    [userId, providerSubject, normalizedEmail]
  );
  return Boolean(result.rowCount);
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
