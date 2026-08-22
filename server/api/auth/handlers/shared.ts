import crypto from 'crypto';
import { hashStudentPassword } from '../../lib/student/studentPassword.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';
import { validatePasswordStrength as validatePasswordPolicy } from '../../../../shared/passwordPolicy.js';

export type StaffRole = 'admin' | 'teacher' | 'accounting' | 'office';

// Challenge token for password-reset request flow (proves phone was validated in lookup)
export const LOOKUP_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
export function getChallengeSecret(): string {
  const secret = process.env.LOOKUP_CHALLENGE_SECRET?.trim();
  if (secret) return secret;
  // In production, fail closed — token system must not run with a weak/default secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LOOKUP_CHALLENGE_SECRET is required in production');
  }
  // Development/staging fallback for local-only use.
  return 'dev-only-challenge-secret-do-not-use-in-prod';
}

export function createLookupToken(studentDocId: string): string {
  const ts = Date.now();
  const payload = `${studentDocId}:${ts}`;
  const sig = crypto.createHmac('sha256', getChallengeSecret()).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

export function verifyLookupToken(token: string, expectedStudentDocId: string): boolean {
  try {
    if (!token || !expectedStudentDocId) return false;
    const parts = token.split(':');
    if (parts.length !== 3) return false;
    const [studentDocId, tsStr, sig] = parts;
    if (studentDocId !== expectedStudentDocId) return false;
    const ts = Number(tsStr);
    if (!Number.isFinite(ts) || Date.now() - ts > LOOKUP_TOKEN_TTL_MS) return false;
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    const expected = crypto
      .createHmac('sha256', getChallengeSecret())
      .update(`${studentDocId}:${tsStr}`)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export const STAFF_ROLE_ALIASES: Record<string, StaffRole> = {
  admin: 'admin',
  administrator: 'admin',
  teacher: 'teacher',
  accounting: 'accounting',
  accountant: 'accounting',
  finance: 'accounting',
  ketoan: 'accounting',
  ke_toan: 'accounting',
  'ke-toan': 'accounting',
  office: 'office',
  van_phong: 'office',
  'van-phong': 'office',
  vanphong: 'office',
};

export function normalizeStaffRole(value: unknown): StaffRole | '' {
  if (typeof value !== 'string') return '';
  const key = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
  return STAFF_ROLE_ALIASES[key] || '';
}

export function inferStaffRoleFromEmail(email: string): StaffRole | '' {
  if (email.endsWith('.accounting@nancy.com')) return 'accounting';
  if (email.endsWith('.office@nancy.com')) return 'office';
  if (email.endsWith('.teacher@nancy.com')) return 'teacher';
  return '';
}

export function hashPassword(password: string): { salt: string; hash: string } {
  return hashStudentPassword(password);
}

export function generateRandomPassword(length = 12): string {
  const charset = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (v) => charset[v % charset.length]).join('');
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  return validatePasswordPolicy(password, 'en');
}

export function normalizePhone(phone?: string): string {
  return normalizePhoneVN(phone || '');
}

export async function getStaffConfig() {
  const snap = await getDb().collection('config').doc('allowedStaff').get();
  const data = snap.exists ? snap.data() || {} : {};
  const googleSignInAllowedDomains = Array.isArray(data.googleSignInAllowedDomains)
    ? (data.googleSignInAllowedDomains as unknown[])
        .filter((domain): domain is string => typeof domain === 'string')
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const googleSignInDomainPolicy =
    typeof data.googleSignInDomainPolicy === 'string'
      ? data.googleSignInDomainPolicy.trim().toLowerCase()
      : '';

  return {
    emails: Array.isArray(data.emails) ? (data.emails as string[]).map((e) => e.toLowerCase()) : [],
    roles:
      data.roles && typeof data.roles === 'object' ? (data.roles as Record<string, StaffRole>) : {},
    googleSignInAllowedDomains,
    googleSignInDomainPolicy,
  };
}

export async function resolveAllowedStaff(
  uid: string,
  email: string,
  requestedDisplayName?: string
): Promise<
  | { allowed: true; userData: Record<string, unknown> }
  | { allowed: false; reason: 'not_allowed' | 'revoked' }
> {
  const db = getDb();
  const normalizedEmail = email.toLowerCase();
  const [config, userSnap, allowedSnap, blockedSnap] = await Promise.all([
    getStaffConfig(),
    db.collection('users').doc(uid).get(),
    db.collection('allowed_teachers').doc(normalizedEmail).get(),
    db.collection('blocked_teachers').doc(normalizedEmail).get(),
  ]);

  const existing = userSnap.data() || {};
  const allowedData = allowedSnap.data() || {};
  const configRole = normalizeStaffRole(config.roles[normalizedEmail]);
  const emailInferredRole = inferStaffRoleFromEmail(normalizedEmail);
  const allowedRole = allowedSnap.exists
    ? normalizeStaffRole(allowedData.role) ||
      (typeof allowedData.role === 'string' && allowedData.role
        ? ''
        : emailInferredRole || 'teacher')
    : '';
  const role =
    configRole ||
    allowedRole ||
    (config.emails.includes(normalizedEmail) ? emailInferredRole || 'teacher' : '');

  if (blockedSnap.exists || existing.blockedTeacher === true) {
    return { allowed: false, reason: 'revoked' };
  }
  if (!role) {
    return { allowed: false, reason: 'not_allowed' };
  }

  const userData: Record<string, unknown> = {
    uid,
    email: normalizedEmail,
    displayName:
      (typeof existing.displayName === 'string' && existing.displayName) ||
      requestedDisplayName ||
      normalizedEmail.split('@')[0],
    role,
    blockedTeacher: false,
    updatedAt: new Date().toISOString(),
  };



  return { allowed: true, userData };
}

export async function createTempPasswordRetrievalToken(
  tempPassword: string,
  uid: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const db = getDb();
  await db
    .collection('_temp_password_retrievals')
    .doc(token)
    .set({
      tempPassword,
      uid,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes TTL
    });
  return token;
}
