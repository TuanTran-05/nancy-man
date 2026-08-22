import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue } from '@/server/db/documentStore.js';
import { writeCriticalAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import {
  generateRandomPassword,
  inferStaffRoleFromEmail,
  createTempPasswordRetrievalToken,
} from './shared.js';
import { sendZaloZNSMessage, getZaloConfig } from '../../lib/zalo/zaloHelper.js';
import { turnstileFailureBody } from './turnstileLogin.js';
import { verifyTurnstileToken, isTurnstileFailure } from '../../lib/auth/turnstile.js';
import { createZaloPayloadSnapshot } from '../../zalo/helpers/zaloTemplatePolicy.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  createStaffIdentity,
  findStaffUserIdByEmail,
  rollbackCreatedStaffIdentity,
  revokeStaffIdentitiesByEmail,
  revokeStaffIdentity,
  setStaffForcePasswordChange,
  setStaffPassword,
} from '../../lib/auth/sessionStore.js';

export async function handleStaffLoginRateCheck(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const email = getString(body, 'email').toLowerCase();
  if (!email) return res.status(400).json({ success: false, error: 'Missing email' });

  const ip = getClientIp(req);
  try {
    const db = getDb();
    const rl = await checkRateLimit(db, `staff_login:${ip}:${email}`, 5, 5 * 60 * 1000, {
      failOpen: true,
    });
    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Too many login attempts. Please try again in 5 minutes.',
      });
    }
  } catch (err) {
    console.warn(
      '[Auth/staff-login-rate-check] Rate limit unavailable; continuing staff Turnstile precheck',
      err
    );
  }

  const turnstile = await verifyTurnstileToken(body.turnstileToken, {
    remoteIp: ip,
    expectedAction: 'login',
  });
  if (isTurnstileFailure(turnstile)) {
    return res.status(400).json(turnstileFailureBody(turnstile));
  }

  return res.status(200).json({ success: true });
}

export async function handleStaffForgotPassword(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const ip = getClientIp(req);
  const rl = await checkRateLimit(getDb(), ip, 3, 15 * 60 * 1000);
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ success: false, error: 'Too many requests. Please try again later.' });
  }

  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing email' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const db = getDb();

    const allowedDoc = await db.collection('allowed_teachers').doc(normalizedEmail).get();
    if (!allowedDoc.exists) {
      // Return same response as success to prevent email enumeration
      return res.status(200).json({ success: true });
    }

    const existingSnap = await db
      .collection('staffPasswordResetRequests')
      .where('email', '==', normalizedEmail)
      .where('status', '==', 'pending')
      .get();
    if (!existingSnap.empty) {
      // Return same response as success to prevent email enumeration
      return res.status(200).json({ success: true });
    }

    const teacherData = allowedDoc.data();
    const displayName = teacherData?.name || normalizedEmail.split('@')[0];
    const role = teacherData?.role || 'teacher';

    const uid = (await findStaffUserIdByEmail(normalizedEmail)) || '';

    await db.collection('staffPasswordResetRequests').add({
      uid,
      email: normalizedEmail,
      displayName,
      role,
      status: 'pending',
      createdAt: new Date().toISOString(),
      requestedBy: uid,
    });

    await writeCriticalAuditLog(db, {
      userId: uid || 'anonymous',
      userRole: role,
      action: 'create',
      collection: 'staffPasswordResetRequests',
      documentId: normalizedEmail,
      metadata: { method: 'forgot-password' },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[StaffForgot] Error creating request:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to create request',
    });
  }
}

export async function handleStaffCreateAccount(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const { emailPrefix, displayName, role, phone } = req.body || {};
  if (!emailPrefix || typeof emailPrefix !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing emailPrefix' });
  }

  // Safe emailPrefix regex validation (only allow letters, numbers, dot, underscore, dash)
  if (!/^[a-zA-Z0-9._-]+$/.test(emailPrefix)) {
    return res.status(400).json({ success: false, error: 'Invalid emailPrefix characters' });
  }

  if (!['teacher', 'accounting', 'office'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }

  const emailSuffix =
    role === 'accounting'
      ? '.accounting@nancy.com'
      : role === 'office'
        ? '.office@nancy.com'
        : '.teacher@nancy.com';
  const email = `${emailPrefix.trim().toLowerCase()}${emailSuffix}`;
  const db = getDb();
  const tempPassword = generateRandomPassword();
  let createdIdentityUid = '';
  let uid = '';
  let createdAt = new Date().toISOString();

  try {
    try {
      const identity = await createStaffIdentity({
        email,
        password: tempPassword,
        displayName: displayName || emailPrefix,
        role,
        ...(phone ? { phone } : {}),
        forcePasswordChange: true,
      });
      uid = identity.uid;
      createdIdentityUid = uid;
      createdAt = identity.createdAt;
    } catch (err: any) {
      if (err?.code !== '23505') throw err;
      return res.status(409).json({
        success: false,
        errorCode: 'email_already_exists',
        error: 'Email already exists',
      });
    }

    const allowedData: Record<string, unknown> = {
      addedAt: new Date().toISOString(),
      addedByAdmin: true,
      role,
    };
    await db.collection('allowed_teachers').doc(email).set(allowedData, { merge: true });

    const userData: Record<string, unknown> = {
      uid,
      email,
      displayName: displayName || emailPrefix,
      role,
      blockedTeacher: false,
      forcePasswordChange: true,
      createdAt,
      updatedAt: new Date().toISOString(),
    };
    if (phone) userData.phone = phone;
    await db.collection('users').doc(uid).set(userData, { merge: true });

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'create',
      collection: 'users',
      documentId: uid,
      metadata: { method: 'create-account', email, role },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    // Server-side Zalo credentials notification sending (Finding #7 / #20)
    let zaloSent = false;
    let zaloMessageId = '';
    let zaloError = '';
    let zaloTemplateId = '';
    let providerErrorCode: number | undefined;
    let payloadSnapshot: ReturnType<typeof createZaloPayloadSnapshot> | undefined;
    if (phone) {
      const cfg = getZaloConfig();
      zaloTemplateId = cfg.znsStaffTemplateId || '';
      if (cfg.appId && cfg.appSecret && cfg.znsStaffTemplateId) {
        const templateData = {
          name: displayName.trim() || emailPrefix.trim(),
          user_name: email,
          pass_word: tempPassword,
        };
        payloadSnapshot = createZaloPayloadSnapshot({
          templateId: cfg.znsStaffTemplateId,
          phone,
          templateData,
        });
        try {
          const result = await sendZaloZNSMessage(
            cfg.znsStaffTemplateId,
            templateData,
            phone,
            `edutrack_staff_${Date.now()}`.substring(0, 48)
          );
          zaloSent = result.success;
          zaloMessageId = result.messageId || '';
          zaloError = result.error || '';
          providerErrorCode = result.errorCode;
        } catch (zaloErr: any) {
          console.error('[StaffCreate] Zalo notify error:', zaloErr);
          zaloError = zaloErr?.message || String(zaloErr);
        }
      } else {
        zaloError = !cfg.znsStaffTemplateId
          ? 'ZALO_ZNS_STAFF_TEMPLATE_ID is not configured'
          : 'Zalo OA is not configured';
      }

      try {
        await db.collection('zalo_notifications').add({
          studentName: displayName.trim() || emailPrefix.trim(),
          phone,
          status: zaloSent ? 'sent' : 'failed',
          zaloMessageId,
          errorMessage: zaloError,
          createdAt: new Date().toISOString(),
          date: new Date().toISOString().split('T')[0],
          type: 'staff-credentials',
          email,
          templateId: zaloTemplateId,
          payloadCaptured: Boolean(payloadSnapshot),
          ...(payloadSnapshot ? { payloadSnapshot } : {}),
          ...(providerErrorCode !== undefined ? { providerErrorCode } : {}),
        });
      } catch (logErr) {
        console.error('[StaffCreate] Failed to write Zalo notification log:', logErr);
      }
    }

    const retrievalToken = await createTempPasswordRetrievalToken(tempPassword, uid);
    if (role === 'teacher') {
      await Promise.all([
        touchRealtimeEvent('office-schedule-changed'),
        touchRealtimeEvent('office-academic-changed'),
      ]);
    }

    return res.status(200).json({
      success: true,
      uid,
      email,
      retrievalToken,
      authCreated: true,
      zaloSent,
      zaloMessageId,
      zaloError: zaloError || undefined,
    });
  } catch (err) {
    if (createdIdentityUid) {
      try {
        await rollbackCreatedStaffIdentity(createdIdentityUid, email);
      } catch (rollbackErr) {
        console.error('[StaffCreate] Error rolling back staff identity:', rollbackErr);
      }
    }
    console.error('[StaffCreate] Error creating staff account:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to create staff account',
    });
  }
}

export async function handleStaffResetPassword(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const user = await verifyAuthToken(req, res, ['admin']);
  if (!user) return;

  const { uid } = req.body;
  if (!uid) {
    return res.status(400).json({ success: false, error: 'Missing uid' });
  }

  try {
    const db = getDb();

    // Read the user document first to verify it exists before mutating Auth
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const tempPassword = generateRandomPassword();

    await setStaffPassword(uid, tempPassword);
    await setStaffForcePasswordChange(uid, true);

    await db.collection('users').doc(uid).update({
      forcePasswordChange: true,
      updatedAt: new Date().toISOString(),
    });

    await writeCriticalAuditLog(db, {
      userId: user.uid,
      userRole: 'admin',
      action: 'password_reset',
      collection: 'users',
      documentId: uid,
      metadata: { method: 'reset-password' },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    const retrievalToken = await createTempPasswordRetrievalToken(tempPassword, uid);

    return res.status(200).json({ success: true, retrievalToken });
  } catch (err) {
    console.error('[StaffReset] Error resetting password:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to reset password',
    });
  }
}

export async function handleStaffApproveResetRequest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const body = normalizeBody(req.body);
  const requestId = getString(body, 'requestId');
  const uid = getString(body, 'uid');
  if (!requestId || !uid)
    return res.status(400).json({ success: false, error: 'Missing requestId or uid' });

  try {
    const db = getDb();

    // Read and validate the request document first
    const requestDoc = await db.collection('staffPasswordResetRequests').doc(requestId).get();
    if (!requestDoc.exists) {
      return res.status(404).json({ success: false, error: 'Reset request not found' });
    }

    const requestData = requestDoc.data()!;
    if (requestData.status !== 'pending') {
      return res.status(409).json({
        success: false,
        error: `Request already ${requestData.status}`,
      });
    }
    if (requestData.uid !== uid) {
      return res.status(400).json({ success: false, error: 'UID does not match the request' });
    }

    const tempPassword = generateRandomPassword();
    await setStaffPassword(uid, tempPassword);
    await setStaffForcePasswordChange(uid, true);
    await db
      .collection('users')
      .doc(uid)
      .update({ forcePasswordChange: true, updatedAt: new Date().toISOString() });
    await db
      .collection('staffPasswordResetRequests')
      .doc(requestId)
      .update({ status: 'approved', updatedAt: new Date().toISOString() });

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'password_reset',
      collection: 'staffPasswordResetRequests',
      documentId: requestId,
      metadata: { method: 'approve-reset-request', targetUid: uid },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    const retrievalToken = await createTempPasswordRetrievalToken(tempPassword, uid);

    return res.status(200).json({ success: true, retrievalToken });
  } catch (err) {
    console.error('[StaffApproveReset] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to approve request',
    });
  }
}

export async function handleStaffRejectResetRequest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const body = normalizeBody(req.body);
  const requestId = getString(body, 'requestId');
  const reason = getString(body, 'reason');
  if (!requestId || !reason)
    return res.status(400).json({ success: false, error: 'Missing requestId or reason' });

  try {
    const db = getDb();

    // Read the request document first to verify it exists and is still pending
    const requestDoc = await db.collection('staffPasswordResetRequests').doc(requestId).get();
    if (!requestDoc.exists) {
      return res.status(404).json({ success: false, error: 'Reset request not found' });
    }

    const requestData = requestDoc.data()!;
    if (requestData.status !== 'pending') {
      return res.status(409).json({
        success: false,
        error: `Request already ${requestData.status}`,
      });
    }

    await db.collection('staffPasswordResetRequests').doc(requestId).update({
      status: 'rejected',
      reason,
      updatedAt: new Date().toISOString(),
    });

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'update',
      collection: 'staffPasswordResetRequests',
      documentId: requestId,
      metadata: { method: 'reject-reset-request', reason },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[StaffRejectReset] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to reject request',
    });
  }
}

export async function handleStaffAddEmail(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const body = normalizeBody(req.body);
  const email = getString(body, 'email');
  if (!email) return res.status(400).json({ success: false, error: 'Missing email' });

  try {
    const db = getDb();
    const inferredRole = inferStaffRoleFromEmail(email) || 'teacher';
    await db.collection('blocked_teachers').doc(email).delete();
    await db
      .collection('allowed_teachers')
      .doc(email)
      .set({ email, role: inferredRole, addedAt: new Date().toISOString() });

    const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!usersSnap.empty) {
      await usersSnap.docs[0].ref.update({ blockedTeacher: false });
    }

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'create',
      collection: 'allowed_teachers',
      documentId: email,
      metadata: { method: 'add-email', inferredRole },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    if (!usersSnap.empty && inferredRole === 'teacher') {
      await touchRealtimeEvent('office-schedule-changed');
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[StaffAddEmail] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to add email',
    });
  }
}

export async function handleStaffRemoveEmail(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const body = normalizeBody(req.body);
  const email = getString(body, 'email');
  if (!email) return res.status(400).json({ success: false, error: 'Missing email' });

  const adminEmail = (adminUser.email || '').toLowerCase();
  if (adminEmail && email.toLowerCase() === adminEmail) {
    return res.status(400).json({ success: false, error: 'Cannot remove your own email' });
  }

  try {
    const db = getDb();
    await db
      .collection('blocked_teachers')
      .doc(email)
      .set({ email, blockedAt: new Date().toISOString() });
    await db.collection('allowed_teachers').doc(email).delete();

    const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!usersSnap.empty) {
      await usersSnap.docs[0].ref.update({
        blockedTeacher: true,
        blockedAt: new Date().toISOString(),
      });
    }

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'delete',
      collection: 'allowed_teachers',
      documentId: email,
      metadata: { method: 'remove-email' },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    if (!usersSnap.empty && (inferStaffRoleFromEmail(email) || 'teacher') === 'teacher') {
      await touchRealtimeEvent('office-schedule-changed');
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[StaffRemoveEmail] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to remove email',
    });
  }
}

export async function handleStaffUnblockEmail(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const body = normalizeBody(req.body);
  const email = getString(body, 'email');
  if (!email) return res.status(400).json({ success: false, error: 'Missing email' });

  try {
    const db = getDb();
    const inferredRole = inferStaffRoleFromEmail(email) || 'teacher';
    await db
      .collection('allowed_teachers')
      .doc(email)
      .set({ email, role: inferredRole, addedAt: new Date().toISOString() });
    await db.collection('blocked_teachers').doc(email).delete();

    const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!usersSnap.empty) {
      await usersSnap.docs[0].ref.update({ blockedTeacher: false });
    }

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'update',
      collection: 'blocked_teachers',
      documentId: email,
      metadata: { method: 'unblock-email', inferredRole },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    if (!usersSnap.empty && inferredRole === 'teacher') {
      await touchRealtimeEvent('office-schedule-changed');
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[StaffUnblockEmail] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to unblock email',
    });
  }
}

export async function handleStaffDeleteAccount(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const body = normalizeBody(req.body);
  const uid = getString(body, 'uid');
  const email = getString(body, 'email');
  if (!uid || !email)
    return res.status(400).json({ success: false, error: 'Missing uid or email' });

  if (uid === adminUser.uid) {
    return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
  }

  try {
    const db = getDb();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const wasTeacher = userSnap.exists && userSnap.data()?.role === 'teacher';
    await db.collection('allowed_teachers').doc(email).delete();
    await db.collection('blocked_teachers').doc(email).delete();
    await userRef.delete();
    await revokeStaffIdentity(uid);

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'delete',
      collection: 'users',
      documentId: uid,
      metadata: { method: 'delete-account', email },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    if (wasTeacher) {
      await Promise.all([
        touchRealtimeEvent('office-schedule-changed'),
        touchRealtimeEvent('office-academic-changed'),
      ]);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[StaffDeleteAccount] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to delete account',
    });
  }
}

export async function handleStaffDeleteBlockedEmail(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const body = normalizeBody(req.body);
  const email = getString(body, 'email');
  if (!email) return res.status(400).json({ success: false, error: 'Missing email' });

  const adminEmail = (adminUser.email || '').toLowerCase();
  if (adminEmail && email.toLowerCase() === adminEmail) {
    return res.status(400).json({ success: false, error: 'Cannot delete your own email' });
  }

  try {
    const db = getDb();
    await db.collection('allowed_teachers').doc(email).delete();
    await db.collection('blocked_teachers').doc(email).delete();

    const usersSnap = await db.collection('users').where('email', '==', email).get();
    const deletedTeacher = usersSnap.docs.some((doc) => doc.data()?.role === 'teacher');
    const batch = db.batch();
    for (const doc of usersSnap.docs) {
      batch.delete(doc.ref);
      await revokeStaffIdentity(doc.id);
    }
    await revokeStaffIdentitiesByEmail(email);
    if (!usersSnap.empty) await batch.commit();

    await writeCriticalAuditLog(db, {
      userId: adminUser.uid,
      userRole: 'admin',
      action: 'delete',
      collection: 'blocked_teachers',
      documentId: email,
      metadata: { method: 'delete-blocked-email', deletedUsers: usersSnap.size },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    if (deletedTeacher) {
      await Promise.all([
        touchRealtimeEvent('office-schedule-changed'),
        touchRealtimeEvent('office-academic-changed'),
      ]);
    }

    return res.status(200).json({ success: true, deletedUsers: usersSnap.size });
  } catch (err) {
    console.error('[StaffDeleteBlockedEmail] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to delete blocked email',
    });
  }
}

export async function handleStaffStandardizeTeacherIds(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  try {
    const db = getDb();
    const usersSnap = await db.collection('users').where('role', '==', 'teacher').get();
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = `GV${year}`;

    let batch = db.batch();
    let count = 0;
    let updated = 0;

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const currentId = data.teacherId || '';
      if (currentId.startsWith(prefix) && /^GV\d{6}$/.test(currentId)) continue;

      const seq = String(updated + 1).padStart(4, '0');
      batch.update(doc.ref, {
        teacherId: `${prefix}${seq}`,
        updatedAt: FieldValue.serverTimestamp(),
      });
      updated++;
      count++;
      if (count >= 450) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
    if (updated > 0) {
      await touchRealtimeEvent('office-schedule-changed');
    }
    return res.status(200).json({ success: true, updated });
  } catch (err) {
    console.error('[StaffStandardizeIds] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to standardize teacher IDs',
    });
  }
}
