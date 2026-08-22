import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import crypto from 'crypto';
import { FieldValue } from '@/server/db/documentStore.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import { getClientIp, type AuditLogEntry } from '../../lib/logging/auditLog.js';
import { hashSecret, verifySecret } from '../../lib/student/studentPassword.js';
import { getZaloConfig, sendZaloZNSMessage } from '../../lib/zalo/zaloHelper.js';
import { isValidVNPhone, normalizePhoneVN } from '../../../../shared/phone.js';
import { logZaloNotification } from '../../zalo/helpers/zaloBaseHelpers.js';
import { createZaloPayloadSnapshot } from '../../zalo/helpers/zaloTemplatePolicy.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const PROFILE_PHONE_RATE_LIMIT_MAX = 5;
const PROFILE_PHONE_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

const INTERNAL_STAFF_ROLES = ['admin', 'teacher', 'accounting', 'office'] as const;
type InternalStaffRole = (typeof INTERNAL_STAFF_ROLES)[number];

type ProfilePhoneOtpData = {
  uid?: string;
  newPhone?: string;
  otpHash?: string;
  attempts?: number;
  maxAttempts?: number;
  verified?: boolean;
  expiresAt?: number;
};

function isInternalStaffRole(value: unknown): value is InternalStaffRole {
  return typeof value === 'string' && INTERNAL_STAFF_ROLES.includes(value as InternalStaffRole);
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function hashUidSuffix(uid: string): string {
  return crypto.createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

export function buildProfilePhoneOtpTrackingId(uid: string, now = Date.now()): string {
  return `profile_phone_${now}_${hashUidSuffix(uid)}`;
}

function maskPhone(phone: unknown): string {
  const normalized = normalizePhoneVN(String(phone || ''));
  if (normalized.length <= 5) return normalized ? '***' : '';
  return `${normalized.slice(0, 2)}***${normalized.slice(-3)}`;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildProfilePhoneAuditData(args: {
  uid: string;
  role: InternalStaffRole;
  oldPhone: string;
  newPhone: string;
  req: ApiRequest;
}): Omit<AuditLogEntry, 'id'> {
  return {
    userId: args.uid,
    userRole: args.role,
    action: 'update',
    collection: 'users',
    documentId: args.uid,
    metadata: {
      method: 'zalo-otp-profile-phone-change',
      oldPhoneMasked: maskPhone(args.oldPhone),
      newPhoneMasked: maskPhone(args.newPhone),
      role: args.role,
    },
    ip: getClientIp(args.req),
    userAgent: String(args.req.headers['user-agent'] || ''),
    timestamp: new Date().toISOString(),
  };
}

async function getAuthorizedStaffProfile(req: ApiRequest, res: ApiResponse) {
  const user = await verifyAuthToken(req, res, [...INTERNAL_STAFF_ROLES]);
  if (!user) return null;

  const db = getDb();
  const userRef = db.collection('users').doc(user.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    res.status(404).json({ success: false, error: 'User profile not found' });
    return null;
  }

  const userData = userSnap.data() || {};
  const role = userData.role;
  if (!isInternalStaffRole(role)) {
    res.status(403).json({ success: false, error: 'Not authorized for profile phone changes' });
    return null;
  }

  return { db, user, userRef, userData, role };
}

function getPendingDoc(db: AppDocumentStore.DocumentStore, uid: string) {
  return db.collection('profilePhoneOtps').doc(uid);
}

function validatePending(data: ProfilePhoneOtpData | undefined) {
  if (!data || !data.newPhone || !data.otpHash) {
    return { ok: false as const, status: 400, error: 'No pending phone verification found.' };
  }
  if (getNumber(data.expiresAt, 0) <= Date.now()) {
    return { ok: false as const, status: 400, error: 'OTP expired. Please request a new code.' };
  }
  const attempts = getNumber(data.attempts, 0);
  const maxAttempts = getNumber(data.maxAttempts, MAX_OTP_ATTEMPTS);
  if (attempts >= maxAttempts) {
    return {
      ok: false as const,
      status: 429,
      error: 'Too many incorrect OTP attempts. Please request a new code.',
    };
  }
  return { ok: true as const, attempts, maxAttempts };
}

export async function handleRequestProfilePhoneOtp(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const context = await getAuthorizedStaffProfile(req, res);
  if (!context) return;

  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (!isValidVNPhone(phone)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number' });
  }

  const { db, user, userData, role } = context;
  const { allowed } = await checkRateLimit(
    db,
    `profile_phone_otp:${user.uid}`,
    PROFILE_PHONE_RATE_LIMIT_MAX,
    PROFILE_PHONE_RATE_LIMIT_WINDOW_MS,
    { failClosed: true }
  );
  if (!allowed) {
    return res.status(429).json({
      success: false,
      error: 'Too many OTP requests. Please try again later.',
    });
  }

  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret || !cfg.znsOtpTemplateId) {
    return res.status(503).json({
      success: false,
      error: !cfg.znsOtpTemplateId
        ? 'ZALO_ZNS_OTP_TEMPLATE_ID is not configured'
        : 'Zalo OA is not configured',
    });
  }

  const newPhone = normalizePhoneVN(phone);
  const otp = generateOtp();
  const templateData = { otp };
  await getPendingDoc(db, user.uid).set({
    uid: user.uid,
    newPhone,
    otpHash: hashSecret(otp),
    attempts: 0,
    maxAttempts: MAX_OTP_ATTEMPTS,
    verified: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + OTP_TTL_MS,
  });

  const zaloResult = await sendZaloZNSMessage(
    cfg.znsOtpTemplateId,
    templateData,
    newPhone,
    buildProfilePhoneOtpTrackingId(user.uid)
  );
  await logZaloNotification({
    studentName: String(userData.displayName || userData.name || user.email || user.uid),
    email: String(user.email || ''),
    phone: newPhone,
    templateId: cfg.znsOtpTemplateId,
    status: zaloResult.success ? 'sent' : 'failed',
    zaloMessageId: zaloResult.messageId || '',
    errorMessage: zaloResult.error || '',
    ...(zaloResult.errorCode !== undefined ? { providerErrorCode: zaloResult.errorCode } : {}),
    date: new Date().toISOString().slice(0, 10),
    type: 'otp_profile_phone',
    otpPurpose: 'profile_phone_change',
    recipientRole: String(role || 'staff'),
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsOtpTemplateId,
      phone: newPhone,
      templateData,
    }),
  });
  if (!zaloResult.success) {
    await getPendingDoc(db, user.uid).delete();
    return res.status(502).json({
      success: false,
      error: 'Unable to send Zalo verification message. Please try again later.',
    });
  }

  return res.status(200).json({ success: true });
}

export async function handleVerifyProfilePhoneOtp(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const context = await getAuthorizedStaffProfile(req, res);
  if (!context) return;

  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ success: false, error: 'Invalid OTP' });
  }

  const pendingRef = getPendingDoc(context.db, context.user.uid);
  const pendingSnap = await pendingRef.get();
  const data = pendingSnap.exists ? (pendingSnap.data() as ProfilePhoneOtpData) : undefined;
  const validation = validatePending(data);
  if (!validation.ok) {
    return res.status(validation.status).json({ success: false, error: validation.error });
  }

  if (!verifySecret(data!.otpHash!, otp)) {
    await pendingRef.update({ attempts: validation.attempts + 1 });
    return res.status(400).json({ success: false, error: 'Invalid OTP' });
  }

  await pendingRef.update({
    verified: true,
    verifiedAt: Date.now(),
  });

  return res.status(200).json({ success: true, phone: data!.newPhone });
}

export async function handleConfirmProfilePhoneChange(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const context = await getAuthorizedStaffProfile(req, res);
  if (!context) return;

  const { db, user, role } = context;
  const userRef = db.collection('users').doc(user.uid);
  const pendingRef = getPendingDoc(db, user.uid);
  const auditRef = db.collection('audit_logs').doc();
  let newPhone = '';

  try {
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists)
        throw Object.assign(new Error('User profile not found'), { status: 404 });
      const userData = userSnap.data() || {};

      const pendingSnap = await tx.get(pendingRef);
      if (!pendingSnap.exists) {
        throw Object.assign(new Error('No pending phone verification found.'), { status: 400 });
      }
      const pending = pendingSnap.data() as ProfilePhoneOtpData;
      const validation = validatePending(pending);
      if (!validation.ok) {
        throw Object.assign(new Error(validation.error), { status: validation.status });
      }
      if (pending.verified !== true) {
        throw Object.assign(new Error('Phone number has not been verified yet.'), { status: 400 });
      }

      const oldPhone = typeof userData.phone === 'string' ? userData.phone : '';
      newPhone = pending.newPhone!;
      const auditData = buildProfilePhoneAuditData({
        uid: user.uid,
        role,
        oldPhone,
        newPhone,
        req,
      });

      tx.update(userRef, {
        phone: newPhone,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.delete(pendingRef);
      tx.set(auditRef, auditData);
    });
  } catch (err: any) {
    return res.status(err?.status || 500).json({
      success: false,
      error: err?.message || 'Unable to confirm phone change.',
    });
  }

  if (role === 'teacher') {
    await touchRealtimeEvent('office-schedule-changed');
  }

  return res.status(200).json({ success: true, phone: newPhone });
}
