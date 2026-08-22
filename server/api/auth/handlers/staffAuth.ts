import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody, getString, sendSuccess } from '../../lib/http/helpers.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import { getStaffConfig, resolveAllowedStaff } from './shared.js';
import { setStaffForcePasswordChange } from '../../lib/auth/sessionStore.js';

export async function handleStaffConfig(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin']);
  if (!user) return;

  try {
    const config = await getStaffConfig();
    return sendSuccess(res, { data: config });
  } catch (err) {
    console.error('[StaffConfig] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function handleAutoCreateProfile(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res);
  if (!user) return;

  const body = normalizeBody(req.body);
  const email = (user.email || '').toLowerCase();
  if (!email) return res.status(400).json({ success: false, error: 'Missing email' });

  const resolved = await resolveAllowedStaff(user.uid, email, getString(body, 'displayName'));
  if (resolved.allowed === false) {
    return res.status(403).json({ success: false, reason: resolved.reason });
  }

  await getDb().collection('users').doc(user.uid).set(resolved.userData, { merge: true });

  void writeAuditLog(getDb(), {
    userId: user.uid,
    userRole: String(resolved.userData.role),
    userName: String(resolved.userData.displayName || ''),
    action: 'login',
    collection: 'users',
    documentId: user.uid,
    metadata: { method: 'auto-create-profile' },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  return res.status(200).json({ success: true, user: resolved.userData });
}

export async function handleSyncLogin(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res);
  if (!user) return;

  const body = normalizeBody(req.body);
  const email = (user.email || '').toLowerCase();
  if (!email) return res.status(400).json({ success: false, error: 'Missing email' });

  const resolved = await resolveAllowedStaff(user.uid, email, getString(body, 'displayName'));
  if (resolved.allowed === false) {
    return res.status(403).json({ success: false, reason: resolved.reason });
  }

  await getDb().collection('users').doc(user.uid).set(resolved.userData, { merge: true });

  void writeAuditLog(getDb(), {
    userId: user.uid,
    userRole: String(resolved.userData.role),
    userName: String(resolved.userData.displayName || ''),
    action: 'login',
    collection: 'users',
    documentId: user.uid,
    metadata: { method: 'sync-login' },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  return res.status(200).json({ success: true, user: resolved.userData });
}

export async function handleChangePasswordComplete(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, [
    'admin',
    'teacher',
    'accounting',
    'office',
  ]);
  if (!user) return;

  try {
    const db = getDb();
    await setStaffForcePasswordChange(user.uid, false);
    await db.collection('users').doc(user.uid).set(
      {
        forcePasswordChange: false,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    const userDoc = await db.collection('users').doc(user.uid).get();
    void writeAuditLog(db, {
      userId: user.uid,
      userRole: String(userDoc.data()?.role || 'unknown'),
      action: 'password_reset',
      collection: 'users',
      documentId: user.uid,
      metadata: { method: 'change-password-complete' },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[ChangePasswordComplete] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to change password' });
  }
}
