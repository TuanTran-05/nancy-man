import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import crypto from 'crypto';
import { FieldValue } from '@/server/db/documentStore.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import { setStudentCredentials } from '../../lib/student/studentCredentials.js';
import { syncStudentLinkedUsersInTransaction } from '../../lib/student/studentProfileSync.js';
import { hashSecret, verifySecret } from '../../lib/student/studentPassword.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import { getZaloConfig, sendZaloZNSMessage } from '../../lib/zalo/zaloHelper.js';
import { createLogger } from '../../lib/logging/logger.js';
import { writeCriticalAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { setStaffForcePasswordChange, setStaffPassword } from '../../lib/auth/sessionStore.js';

const log = createLogger('auth-zalo-otp');
import { hashPassword, validatePasswordStrength } from './shared.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';
import { selectStudentAuthProfile } from '../../lib/student/canonicalAuthIdentity.js';
import { readCanonicalStudentReadControl } from '../../lib/student/canonicalStudentReadControl.js';
import { logZaloNotification } from '../../zalo/helpers/zaloBaseHelpers.js';
import { createZaloPayloadSnapshot } from '../../zalo/helpers/zaloTemplatePolicy.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const ZALO_RATE_LIMIT_MAX = 5;
const ZALO_RATE_LIMIT_WINDOW = 5 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function normalizePhoneZalo(phone: string): string {
  return normalizePhoneVN(phone);
}

function acceptOtpRequestWithoutDisclosure(res: ApiResponse) {
  return res.status(200).json({ success: true });
}

type ZaloLoginType = 'student' | 'parent' | 'staff';

type StaffOtpTarget = {
  uid: string;
  email: string;
  phone: string;
};

function parseZaloLoginType(value: unknown): ZaloLoginType | null {
  return value === 'student' || value === 'parent' || value === 'staff' ? value : null;
}

function normalizeStaffEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function staffEmailHash(email: string): string {
  return crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
}

function staffOtpDocId(email: string): string {
  return `staff_${staffEmailHash(email)}`;
}

function studentOtpDocId(loginType: 'student' | 'parent', studentCode: string): string {
  return `${loginType}_${studentCode}`;
}

async function findStaffOtpTarget(
  db: AppDocumentStore.DocumentStore,
  email: string,
  phone: string
): Promise<StaffOtpTarget | null> {
  const allowedDoc = await db.collection('allowed_teachers').doc(email).get();
  if (!allowedDoc.exists) return null;

  const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (usersSnap.empty) return null;

  const userDoc = usersSnap.docs[0];
  const userData = userDoc.data();
  if (userData.blockedTeacher === true) return null;

  const uid = typeof userData.uid === 'string' && userData.uid ? userData.uid : userDoc.id;
  const storedPhone = typeof userData.phone === 'string' ? userData.phone : '';
  if (!uid || !storedPhone) return null;

  if (normalizePhoneVN(storedPhone) !== normalizePhoneVN(phone)) return null;

  return {
    uid,
    email,
    phone: storedPhone,
  };
}

export async function handleRequestZaloOtp(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { studentCode, phone, loginType, email } = req.body;
  const parsedLoginType = parseZaloLoginType(loginType);
  if (!parsedLoginType) {
    return res.status(400).json({
      success: false,
      error: 'Invalid loginType: must be "student", "parent", or "staff"',
    });
  }
  if (!phone || typeof phone !== 'string')
    return res.status(400).json({ success: false, error: 'Missing phone number' });

  const db = getDb();
  const ip = getClientIp(req);

  if (parsedLoginType === 'staff') {
    const normalizedEmail = normalizeStaffEmail(email);
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, error: 'Missing email' });
    }

    const { allowed } = await checkRateLimit(
      db,
      `staff_zalo_otp:${ip}:${staffEmailHash(normalizedEmail)}`,
      ZALO_RATE_LIMIT_MAX,
      ZALO_RATE_LIMIT_WINDOW,
      { failClosed: true }
    );
    if (!allowed) {
      return res
        .status(429)
        .json({ success: false, error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 5 phút.' });
    }

    const staffTarget = await findStaffOtpTarget(db, normalizedEmail, phone);
    if (!staffTarget) return acceptOtpRequestWithoutDisclosure(res);

    const otp = generateOtp();
    const otpDocId = staffOtpDocId(normalizedEmail);
    await db
      .collection('passwordResetOtps')
      .doc(otpDocId)
      .set({
        otpHash: hashSecret(otp),
        loginType: 'staff',
        staffUid: staffTarget.uid,
        staffEmail: normalizedEmail,
        attempts: 0,
        maxAttempts: MAX_OTP_ATTEMPTS,
        createdAt: Date.now(),
        expiresAt: Date.now() + OTP_TTL_MS,
      });

    const cfg = getZaloConfig();
    if (!cfg.appId || !cfg.appSecret || !cfg.znsOtpTemplateId) {
      return res.status(503).json({
        success: false,
        error: !cfg.znsOtpTemplateId
          ? 'Chưa cấu hình ZALO_ZNS_OTP_TEMPLATE_ID'
          : 'Zalo OA chưa được cấu hình',
      });
    }

    const normalizedPhone = normalizePhoneZalo(phone);
    const templateData = { otp };
    const zaloResult = await sendZaloZNSMessage(
      cfg.znsOtpTemplateId,
      templateData,
      normalizedPhone,
      `otp_${otpDocId}_${Date.now()}`
    );
    await logZaloNotification({
      studentName: normalizedEmail,
      email: normalizedEmail,
      phone: normalizedPhone,
      templateId: cfg.znsOtpTemplateId,
      status: zaloResult.success ? 'sent' : 'failed',
      zaloMessageId: zaloResult.messageId || '',
      errorMessage: zaloResult.error || '',
      ...(zaloResult.errorCode !== undefined ? { providerErrorCode: zaloResult.errorCode } : {}),
      date: new Date().toISOString().slice(0, 10),
      type: 'otp_password_reset',
      otpPurpose: 'staff_password_reset',
      recipientRole: 'staff',
      payloadCaptured: true,
      payloadSnapshot: createZaloPayloadSnapshot({
        templateId: cfg.znsOtpTemplateId,
        phone: normalizedPhone,
        templateData,
      }),
    });
    if (!zaloResult.success) {
      log.error('Zalo staff OTP delivery failed', {
        error: zaloResult.error || 'Unknown provider error',
      });
      return res.status(502).json({
        success: false,
        error: 'Unable to send Zalo verification message. Please try again later.',
      });
    }

    return res.status(200).json({ success: true });
  }

  if (!studentCode || typeof studentCode !== 'string')
    return res.status(400).json({ success: false, error: 'Missing studentCode' });

  const code = studentCode.trim().toUpperCase();
  const { allowed } = await checkRateLimit(
    db,
    `zalo_otp:${ip}:${code}`,
    ZALO_RATE_LIMIT_MAX,
    ZALO_RATE_LIMIT_WINDOW,
    { failClosed: true }
  );
  if (!allowed)
    return res
      .status(429)
      .json({ success: false, error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 5 phút.' });

  const queryCode = code.startsWith('PH') ? code.substring(2) : code;
  const snapshot = await db.collection('students').where('studentId', '==', queryCode).get();

  // The OTP is bound to one profile and the reset lands on it. Selecting the
  // wrong half of a merged pair sends a real code to a real phone and then
  // rewrites a password nobody logs in with.
  const { mode } = await readCanonicalStudentReadControl(db);
  const selection = await selectStudentAuthProfile(db, {
    code: queryCode,
    candidates: snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
    mode,
    surface: 'student_password_otp',
  });
  if (!selection) return acceptOtpRequestWithoutDisclosure(res);

  const foundDoc = snapshot.docs.find((doc) => doc.id === selection.profileId);
  const studentDoc = { id: selection.profileId };
  let studentData: Record<string, any>;
  if (foundDoc) {
    studentData = foundDoc.data() || {};
  } else {
    const fetched = await db.collection('students').doc(selection.profileId).get();
    if (!fetched.exists) return acceptOtpRequestWithoutDisclosure(res);
    studentData = fetched.data() || {};
  }

  if (studentData.enrollmentStatus === 'dropped' || studentData.isRevoked === true) {
    return acceptOtpRequestWithoutDisclosure(res);
  }

  const normalizedInput = phone.trim().replace(/\s/g, '');
  const normalizedContact = (studentData.contact || '').trim().replace(/\s/g, '');
  if (normalizedInput !== normalizedContact) return acceptOtpRequestWithoutDisclosure(res);

  const otp = generateOtp();
  const otpDocId = studentOtpDocId(parsedLoginType, queryCode);
  await db
    .collection('passwordResetOtps')
    .doc(otpDocId)
    .set({
      otpHash: hashSecret(otp),
      studentDocId: studentDoc.id,
      loginType: parsedLoginType,
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      createdAt: Date.now(),
      expiresAt: Date.now() + OTP_TTL_MS,
    });

  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret || !cfg.znsOtpTemplateId) {
    return res.status(503).json({
      success: false,
      error: !cfg.znsOtpTemplateId
        ? 'Chưa cấu hình ZALO_ZNS_OTP_TEMPLATE_ID'
        : 'Zalo OA chưa được cấu hình',
    });
  }

  const normalizedPhone = normalizePhoneZalo(normalizedInput);
  const templateData = { otp };
  const zaloResult = await sendZaloZNSMessage(
    cfg.znsOtpTemplateId,
    templateData,
    normalizedPhone,
    `otp_${otpDocId}_${Date.now()}`
  );
  await logZaloNotification({
    studentId: studentDoc.id,
    studentName: String(studentData.name || studentData.studentName || queryCode),
    studentCode: queryCode,
    phone: normalizedPhone,
    templateId: cfg.znsOtpTemplateId,
    status: zaloResult.success ? 'sent' : 'failed',
    zaloMessageId: zaloResult.messageId || '',
    errorMessage: zaloResult.error || '',
    ...(zaloResult.errorCode !== undefined ? { providerErrorCode: zaloResult.errorCode } : {}),
    date: new Date().toISOString().slice(0, 10),
    type: 'otp_password_reset',
    otpPurpose: `${parsedLoginType}_password_reset`,
    recipientRole: parsedLoginType,
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsOtpTemplateId,
      phone: normalizedPhone,
      templateData,
    }),
  });
  if (!zaloResult.success) {
    log.error('Zalo OTP delivery failed', { error: zaloResult.error || 'Unknown provider error' });
    return res.status(502).json({
      success: false,
      error: 'Unable to send Zalo verification message. Please try again later.',
    });
  }

  return res.status(200).json({ success: true });
}

export async function handleVerifyZaloOtp(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { studentCode, loginType, otp, email } = req.body;
  const parsedLoginType = parseZaloLoginType(loginType);
  if (!parsedLoginType) return res.status(400).json({ success: false, error: 'Invalid loginType' });
  if (!otp || typeof otp !== 'string')
    return res.status(400).json({ success: false, error: 'Missing OTP' });

  const db = getDb();
  let otpDocId: string;
  if (parsedLoginType === 'staff') {
    const normalizedEmail = normalizeStaffEmail(email);
    if (!normalizedEmail) return res.status(400).json({ success: false, error: 'Missing email' });
    otpDocId = staffOtpDocId(normalizedEmail);
  } else {
    if (!studentCode || typeof studentCode !== 'string')
      return res.status(400).json({ success: false, error: 'Missing studentCode' });
    const code = studentCode.trim().toUpperCase();
    const queryCode = code.startsWith('PH') ? code.substring(2) : code;
    otpDocId = studentOtpDocId(parsedLoginType, queryCode);
  }

  const otpRef = db.collection('passwordResetOtps').doc(otpDocId);
  const otpDoc = await otpRef.get();

  if (!otpDoc.exists)
    return res.status(400).json({
      success: false,
      error: 'Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.',
    });

  const otpData = otpDoc.data()!;
  if (Date.now() > otpData.expiresAt) {
    await otpRef.delete();
    return res
      .status(400)
      .json({ success: false, error: 'Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.' });
  }
  if (otpData.attempts >= otpData.maxAttempts) {
    await otpRef.delete();
    return res
      .status(429)
      .json({ success: false, error: 'Đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới.' });
  }
  if (!verifySecret(otpData.otpHash, otp.trim())) {
    await otpRef.update({ attempts: (otpData.attempts || 0) + 1 });
    return res.status(400).json({ success: false, error: 'Mã xác thực không đúng.' });
  }

  await otpRef.delete();
  const resetToken = crypto.randomUUID();

  const tokenData =
    parsedLoginType === 'staff'
      ? {
          resetTokenHash: hashSecret(resetToken),
          staffUid: otpData.staffUid,
          staffEmail: otpData.staffEmail,
          loginType: 'staff',
          createdAt: Date.now(),
          expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
        }
      : {
          resetTokenHash: hashSecret(resetToken),
          studentDocId: otpData.studentDocId,
          loginType: parsedLoginType,
          createdAt: Date.now(),
          expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
        };

  await db.collection('passwordResetTokens').doc(otpDocId).set(tokenData);

  if (parsedLoginType === 'staff') {
    return res.status(200).json({ success: true, resetToken });
  }
  return res.status(200).json({ success: true, resetToken, studentDocId: otpData.studentDocId });
}

export async function handleResetPasswordZalo(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { studentCode, loginType, resetToken, newPassword, email } = req.body;
  const parsedLoginType = parseZaloLoginType(loginType);
  if (!parsedLoginType) return res.status(400).json({ success: false, error: 'Invalid loginType' });
  if (!resetToken || typeof resetToken !== 'string')
    return res.status(400).json({ success: false, error: 'Missing resetToken' });
  if (!newPassword || typeof newPassword !== 'string')
    return res.status(400).json({ success: false, error: 'Missing newPassword' });

  const pwValidation = validatePasswordStrength(newPassword);
  if (!pwValidation.valid)
    return res.status(400).json({ success: false, error: pwValidation.error });

  const db = getDb();
  let tokenDocId: string;
  if (parsedLoginType === 'staff') {
    const normalizedEmail = normalizeStaffEmail(email);
    if (!normalizedEmail) return res.status(400).json({ success: false, error: 'Missing email' });
    tokenDocId = staffOtpDocId(normalizedEmail);
  } else {
    if (!studentCode || typeof studentCode !== 'string')
      return res.status(400).json({ success: false, error: 'Missing studentCode' });
    const code = studentCode.trim().toUpperCase();
    const queryCode = code.startsWith('PH') ? code.substring(2) : code;
    tokenDocId = studentOtpDocId(parsedLoginType, queryCode);
  }

  const tokenRef = db.collection('passwordResetTokens').doc(tokenDocId);
  const tokenDoc = await tokenRef.get();

  if (!tokenDoc.exists)
    return res.status(400).json({ success: false, error: 'Token không hợp lệ hoặc đã hết hạn.' });
  const tokenData = tokenDoc.data()!;
  if (Date.now() > tokenData.expiresAt) {
    await tokenRef.delete();
    return res
      .status(400)
      .json({ success: false, error: 'Token đã hết hạn. Vui lòng thực hiện lại từ đầu.' });
  }
  if (!verifySecret(tokenData.resetTokenHash, resetToken))
    return res.status(400).json({ success: false, error: 'Token không hợp lệ.' });

  if (parsedLoginType === 'staff') {
    if (tokenData.loginType !== 'staff' || !tokenData.staffUid) {
      return res.status(400).json({ success: false, error: 'Token không hợp lệ.' });
    }

    await setStaffPassword(tokenData.staffUid, newPassword);
    await setStaffForcePasswordChange(tokenData.staffUid, false);
    await db.collection('users').doc(tokenData.staffUid).update({
      forcePasswordChange: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await tokenRef.delete();

    await writeCriticalAuditLog(db, {
      userId: tokenData.staffUid,
      userRole: 'staff',
      action: 'password_reset',
      collection: 'users',
      documentId: tokenData.staffUid,
      metadata: {
        method: 'staff-zalo-otp',
        staffEmail: tokenData.staffEmail || '',
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    return res.status(200).json({ success: true });
  }

  const { salt, hash } = hashPassword(newPassword);
  const updateData: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (parsedLoginType === 'student') {
    Object.assign(updateData, {
      customLoginPasswordSet: true,
      forcePasswordChange: false,
    });
    await setStudentCredentials(db, tokenData.studentDocId, {
      loginPasswordSalt: salt,
      loginPasswordHash: hash,
      passwordVersion: 2,
    });
  } else {
    Object.assign(updateData, {
      parentPasswordSet: true,
      parentForcePasswordChange: false,
    });
    await setStudentCredentials(db, tokenData.studentDocId, {
      parentPasswordSalt: salt,
      parentPasswordHash: hash,
      parentPasswordVersion: 2,
    });
  }

  const studentRef = db.collection('students').doc(tokenData.studentDocId);
  await runStudentIdentityMutationTransaction(
    db,
    {
      actorId: `${parsedLoginType}:${tokenData.studentDocId}`,
      operation: 'student_auth:reset-password-zalo',
    },
    async (transaction) => {
      const studentSnap = await transaction.get(studentRef);
      if (!studentSnap.exists) throw new Error('Student not found');
      const after = { ...(studentSnap.data() || {}), ...updateData };
      await syncStudentLinkedUsersInTransaction(transaction, db, tokenData.studentDocId, after);
      transaction.update(studentRef, updateData);
    }
  );
  await tokenRef.delete();
  return res.status(200).json({ success: true });
}
