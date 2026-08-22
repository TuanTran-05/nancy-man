import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue } from '@/server/db/documentStore.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import {
  getStudentCredentials,
  bulkMigrateCredentials,
  verifyNoLegacyStudentCredentials,
  setStudentCredentials,
  migrateStudentCredentialsAfterAuthentication,
  readStudentCredentialsForVerification,
} from '../../lib/student/studentCredentials.js';
import {
  studentDobMatches,
  verifyStudentPassword,
  hashStudentPassword,
} from '../../lib/student/studentPassword.js';
import {
  getStudentParentAuthContext,
  isStudentParentRole,
  requestedTargetMatchesAuthContext,
} from '../../lib/student/studentParentAuth.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import {
  createSession,
  ensureStudentSessionUser,
  publicSessionUser,
  verifyStaffPassword,
} from '../../lib/auth/sessionStore.js';
import {
  resolveLinkedStudentProfileId,
  selectStudentAuthProfile,
} from '../../lib/student/canonicalAuthIdentity.js';
import { readCanonicalStudentReadControl } from '../../lib/student/canonicalStudentReadControl.js';
import { turnstileFailureBody } from './turnstileLogin.js';
import { verifyTurnstileToken, isTurnstileFailure } from '../../lib/auth/turnstile.js';
import { createLookupToken } from './shared.js';

import {
  canStudentParentLogin,
  getLinkedStudentAccessBlock,
} from '../../../../shared/studentLifecycle.js';

function getStudentLoginBlock(
  studentData: Record<string, unknown>,
  loginType: string
): { status: number; body: Record<string, unknown> } | null {
  const role = loginType === 'parent' ? 'parent' : 'student';
  const block = getLinkedStudentAccessBlock(studentData, role);
  if (!block) return null;

  return {
    status: 403,
    body: {
      success: false,
      error: 'Account disabled',
      blockedReason: block.reason === 'inactive_lifecycle' ? 'revoked' : block.reason,
      studentName: studentData.name || null,
    },
  };
}

export async function handleVerifyStudentLogin(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { studentCode, password, loginType } = req.body;
  if (
    !studentCode ||
    typeof studentCode !== 'string' ||
    !password ||
    typeof password !== 'string' ||
    !loginType ||
    !['student', 'parent'].includes(loginType)
  ) {
    return res.status(400).json({ success: false, error: 'Invalid parameters' });
  }

  const code = studentCode.trim().toUpperCase();
  const pw = password.trim();
  const ip = getClientIp(req);
  const rateKey = `${ip}:${code}`;
  const rl = await checkRateLimit(getDb(), rateKey, 10, 5 * 60 * 1000, { failClosed: true });
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ success: false, error: 'Too many attempts. Please try again later.' });
  }

  const turnstile = await verifyTurnstileToken(req.body.turnstileToken, {
    remoteIp: ip,
    expectedAction: 'login',
  });
  if (isTurnstileFailure(turnstile)) {
    return res.status(400).json(turnstileFailureBody(turnstile));
  }

  try {
    const db = getDb();
    const snapshot = await db.collection('students').where('studentId', '==', code).get();

    // Which of the documents carrying this code is the human logging in. The
    // old answer was "whichever one is still marked active", which for a
    // promoted student is the retired half of the pair by construction.
    const { mode } = await readCanonicalStudentReadControl(db);
    const selection = await selectStudentAuthProfile(db, {
      code,
      candidates: snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
      mode,
      surface: 'student_login',
    });
    if (!selection) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    const studentDocId = selection.profileId;
    // The resolver can name a profile the code query never returned — a retired
    // code still pointing at the child who used to carry it — so it is fetched
    // only in that case. A document the query returned exists by definition.
    const selectedDoc = snapshot.docs.find((doc) => doc.id === studentDocId);
    let studentData: Record<string, unknown>;
    if (selectedDoc) {
      studentData = selectedDoc.data() || {};
    } else {
      const fetched = await db.collection('students').doc(studentDocId).get();
      if (!fetched.exists)
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      studentData = fetched.data() || {};
    }

    const initialBlock = getStudentLoginBlock(studentData, loginType);
    if (initialBlock) return res.status(initialBlock.status).json(initialBlock.body);

    let isPasswordValid = false;
    const credentialRead = await readStudentCredentialsForVerification(
      db,
      studentDocId,
      studentData
    );
    const creds = credentialRead.credentials;
    if (loginType === 'parent') {
      if (studentData.parentPasswordSet === true) {
        if (!creds.parentPasswordSalt || !creds.parentPasswordHash)
          return res.status(500).json({ success: false, error: 'Account configuration error' });
        isPasswordValid = verifyStudentPassword(
          pw,
          creds.parentPasswordSalt,
          creds.parentPasswordHash,
          creds.parentPasswordVersion
        );

        // Auto-upgrade legacy SHA-256 passwords on successful login (Finding #10)
        if (isPasswordValid && creds.parentPasswordVersion !== 2) {
          const { salt: newSalt, hash: newHash } = hashStudentPassword(pw);
          await setStudentCredentials(db, studentDocId, {
            parentPasswordSalt: newSalt,
            parentPasswordHash: newHash,
            parentPasswordVersion: 2,
          });
          console.log(
            `[studentAuth] Parent legacy credentials successfully upgraded to PBKDF2 v2 for student ${studentDocId}`
          );
        }
      } else if (studentDobMatches(String(studentData.dob || ''), pw)) {
        isPasswordValid = true;
      } else {
        return res.status(403).json({
          success: false,
          error:
            'Tài khoản chưa đặt mật khẩu. Vui lòng sử dụng "Quên mật khẩu" để tạo mật khẩu mới.',
          code: 'PASSWORD_NOT_SET',
        });
      }
    } else {
      if (studentData.customLoginPasswordSet === true) {
        if (!creds.loginPasswordSalt || !creds.loginPasswordHash)
          return res.status(500).json({ success: false, error: 'Account configuration error' });
        isPasswordValid = verifyStudentPassword(
          pw,
          creds.loginPasswordSalt,
          creds.loginPasswordHash,
          creds.passwordVersion
        );

        // Auto-upgrade legacy SHA-256 passwords on successful login (Finding #10)
        if (isPasswordValid && creds.passwordVersion !== 2) {
          const { salt: newSalt, hash: newHash } = hashStudentPassword(pw);
          await setStudentCredentials(db, studentDocId, {
            loginPasswordSalt: newSalt,
            loginPasswordHash: newHash,
            passwordVersion: 2,
          });
          console.log(
            `[studentAuth] Student legacy credentials successfully upgraded to PBKDF2 v2 for student ${studentDocId}`
          );
        }
      } else if (studentDobMatches(String(studentData.dob || ''), pw)) {
        isPasswordValid = true;
      } else {
        return res.status(403).json({
          success: false,
          error:
            'Tài khoản chưa đặt mật khẩu. Vui lòng sử dụng "Quên mật khẩu" để tạo mật khẩu mới.',
          code: 'PASSWORD_NOT_SET',
        });
      }
    }

    if (!isPasswordValid) {
      void writeAuditLog(db, {
        userId: `${loginType}:${studentDocId}`,
        userRole: loginType,
        action: 'login',
        collection: 'users',
        documentId: `${loginType}:${studentDocId}`,
        metadata: { success: false, reason: 'invalid_credentials', studentCode: code },
        ip,
        userAgent: String(req.headers['user-agent'] || ''),
      });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const deterministicUid =
      loginType === 'parent' ? `parent:${studentDocId}` : `student:${studentDocId}`;
    if (credentialRead.requiresMigration) {
      await migrateStudentCredentialsAfterAuthentication(db, studentDocId, {
        actorId: deterministicUid,
        operation: 'student_auth:verify-student-login',
      });
    }
    const userRef = db.collection('users').doc(deterministicUid);
    const profile = await db.runTransaction(async (transaction) => {
      const canonicalStudent = await transaction.get(db.collection('students').doc(studentDocId));
      if (!canonicalStudent.exists) {
        return {
          denied: { status: 401, body: { success: false, error: 'Invalid credentials' } },
        };
      }
      studentData = canonicalStudent.data() || {};
      const currentBlock = getStudentLoginBlock(studentData, loginType);
      if (currentBlock) return { denied: currentBlock };

      const userSnap = await transaction.get(userRef);
      const existingDisplayName = userSnap.exists ? userSnap.data()?.displayName : null;
      const defaultDisplayName =
        loginType === 'parent' ? `Phụ huynh ${studentData.name || code}` : studentData.name || code;
      const forcePasswordChange =
        loginType === 'parent'
          ? studentData.parentForcePasswordChange || false
          : studentData.forcePasswordChange || false;
      const faceImage = loginType === 'parent' ? null : studentData.faceImage || null;

      await transaction.set(
        userRef,
        {
          uid: deterministicUid,
          displayName: existingDisplayName || defaultDisplayName,
          role: loginType,
          studentId: studentDocId,
          classId: studentData.classId || null,
          teacherId: studentData.teacherId || null,
          faceImage,
          faceImageStoragePath:
            loginType === 'parent' ? null : studentData.faceImageStoragePath || null,
          forcePasswordChange,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        displayName: existingDisplayName || defaultDisplayName,
        faceImage,
        forcePasswordChange,
      };
    });
    if ('denied' in profile) {
      return res.status(profile.denied.status).json(profile.denied.body);
    }

    await ensureStudentSessionUser({
      userId: deterministicUid,
      studentId: studentDocId,
      role: loginType as 'student' | 'parent',
      displayName: String(profile.displayName || studentData.name || code),
      forcePasswordChange: Boolean(profile.forcePasswordChange),
    });
    const principal = await createSession(
      req,
      res,
      deterministicUid,
      loginType === 'parent' ? 'parent' : 'student'
    );

    void writeAuditLog(db, {
      userId: deterministicUid,
      userRole: loginType,
      userName: profile.displayName,
      action: 'login',
      collection: 'users',
      documentId: deterministicUid,
      metadata: { success: true, studentCode: code, classId: studentData.classId || null },
      ip,
      userAgent: String(req.headers['user-agent'] || ''),
    });

    return res.status(200).json({
      success: true,
      user: publicSessionUser(principal),
      student: {
        docId: studentDocId,
        name: studentData.name || null,
        studentId: studentData.studentId || code,
        classId: studentData.classId || null,
        faceImage: profile.faceImage,
        forcePasswordChange: profile.forcePasswordChange,
      },
    });
  } catch (err) {
    console.error('[VerifyStudentLogin] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Internal server error',
    });
  }
}

export async function handleVerifyCurrentPassword(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const user = await verifyAuthToken(req, res);
  if (!user) return;

  const { studentDocId, type, currentPassword } = req.body;
  if (studentDocId !== undefined && typeof studentDocId !== 'string')
    return res.status(400).json({ success: false, error: 'Invalid studentDocId' });
  if (type !== undefined && !isStudentParentRole(type))
    return res.status(400).json({ success: false, error: 'Invalid type' });
  if (!currentPassword || typeof currentPassword !== 'string')
    return res.status(400).json({ success: false, error: 'Missing currentPassword' });

  if (['admin', 'teacher', 'accounting', 'office'].includes(String(user.role || ''))) {
    const valid = Boolean(
      user.email && (await verifyStaffPassword(user.email, currentPassword)) === user.uid
    );
    return res.status(200).json({ success: true, valid });
  }

  try {
    const db = getDb();
    const userSnap = await db.collection('users').doc(user.uid).get();
    const authContext = getStudentParentAuthContext(
      user.uid,
      user as unknown as Record<string, unknown>,
      userSnap.data()
    );
    if (!authContext || !requestedTargetMatchesAuthContext(req.body, authContext)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    // The uid binding above was checked against the id the account stores, so
    // identity is already settled. This only decides which profile's records
    // the session reads — and after a merge the stored id names a tombstone
    // whose credentials moved with the rest of the child.
    const linkedStudentId = await resolveLinkedStudentProfileId(db, authContext.studentId);

    const studentSnap = await db.collection('students').doc(linkedStudentId).get();
    if (!studentSnap.exists)
      return res.status(404).json({ success: false, error: 'Student not found' });

    const studentData = studentSnap.data()!;
    let valid = false;
    const creds = await getStudentCredentials(db, linkedStudentId, {
      actorId: user.uid,
      operation: 'student_auth:verify-current-password',
    });

    if (authContext.role === 'parent') {
      if (studentData.parentPasswordSet === true) {
        const salt = creds.parentPasswordSalt;
        const hash = creds.parentPasswordHash;
        valid =
          !!salt &&
          !!hash &&
          verifyStudentPassword(currentPassword, salt, hash, creds.parentPasswordVersion);
      } else {
        valid = false;
      }
    } else if (studentData.customLoginPasswordSet === true) {
      const salt = creds.loginPasswordSalt;
      const hash = creds.loginPasswordHash;
      valid =
        !!salt &&
        !!hash &&
        verifyStudentPassword(currentPassword, salt, hash, creds.passwordVersion);
    } else {
      valid = false;
    }

    return res.status(200).json({ success: true, valid });
  } catch (err) {
    console.error('[VerifyCurrentPassword] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Verification failed',
    });
  }
}

export async function handleLookupStudent(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const db = getDb();

  // Rate limit: 10 requests per IP per 5 minutes
  const ip = getClientIp(req);
  const rl = await checkRateLimit(db, `lookup-student:${ip}`, 10, 5 * 60 * 1000, {
    failClosed: true,
  });
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ success: false, error: 'Too many requests. Please try again later.' });
  }
  const body = normalizeBody(req.body);
  const studentCode = getString(body, 'studentCode').trim().toUpperCase();
  const phone = getString(body, 'phone').trim();
  const loginType = getString(body, 'loginType') || 'student';

  // Generic error helper — same response for all failure cases to prevent enumeration
  const genericFail = () => res.status(200).json({ success: false, error: 'lookup_failed' });

  if (!studentCode || !phone) {
    return genericFail();
  }

  const queryId =
    loginType === 'parent' && studentCode.startsWith('PH') ? studentCode.substring(2) : studentCode;

  try {
    const snap = await db.collection('students').where('studentId', '==', queryId).get();

    // Same selection as login, and for the same reason: this issues a reset
    // token for one profile, so choosing the wrong half of a merged pair
    // resets a password on a record nobody logs in with.
    const { mode } = await readCanonicalStudentReadControl(db);
    const selection = await selectStudentAuthProfile(db, {
      code: queryId,
      candidates: snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
      mode,
      surface: 'student_password_lookup',
    });
    if (!selection) return genericFail();

    const foundDoc = snap.docs.find((doc) => doc.id === selection.profileId);
    const studentDoc = { id: selection.profileId };
    let studentData: Record<string, any>;
    if (foundDoc) {
      studentData = foundDoc.data() || {};
    } else {
      const fetched = await db.collection('students').doc(selection.profileId).get();
      if (!fetched.exists) return genericFail();
      studentData = fetched.data() || {};
    }

    // Validate phone matches student contact (normalize both sides)
    const normalizePhoneDigits = (p: string) => p.replace(/\D/g, '').replace(/^84/, '0');
    if (normalizePhoneDigits(studentData.contact || '') !== normalizePhoneDigits(phone)) {
      return genericFail();
    }

    // Blocked lifecycle — same generic response to prevent enumeration
    if (!canStudentParentLogin(studentData)) {
      return genericFail();
    }

    // Check for existing pending request
    const normalizedId = loginType === 'parent' ? 'PH' + queryId : queryId;
    const existingSnap = await db
      .collection('passwordResetRequests')
      .where('userId', '==', normalizedId)
      .where('status', '==', 'pending')
      .get();

    if (!existingSnap.empty) {
      // Pending exists — still generic, client handles via success + flag
      return res.status(200).json({ success: true, pending: true });
    }

    // Success — return minimal data + challenge token, NO PII (no contact, classId, teacherId)
    return res.status(200).json({
      success: true,
      pending: false,
      lookupToken: createLookupToken(studentDoc.id),
      student: {
        id: studentDoc.id,
        name: studentData.name,
      },
    });
  } catch (err) {
    console.error('[LookupStudent] Error:', err);
    return genericFail();
  }
}

export async function handleMigrateCredentials(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin']);
  if (!user) return;

  const db = getDb();
  try {
    const result = await bulkMigrateCredentials(db, {
      actorId: user.uid,
      operation: 'student_auth:migrate-credentials',
    });
    const verification = await verifyNoLegacyStudentCredentials(db);
    void writeAuditLog(db, {
      userId: user.uid,
      userRole: 'admin',
      action: 'update',
      collection: 'students',
      documentId: 'bulk',
      metadata: { action: 'migrate-credentials', ...result, verification },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
    return res.json({ success: true, ...result, verification });
  } catch (err) {
    console.error('[Auth/migrate-credentials] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Migration failed',
    });
  }
}

export async function handleVerifyCredentialMigration(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin']);
  if (!user) return;

  const db = getDb();
  const verification = await verifyNoLegacyStudentCredentials(db);
  await writeAuditLog(db, {
    userId: user.uid,
    userRole: 'admin',
    userName: user.email || user.uid,
    action: 'update',
    collection: 'student_auth_credentials',
    documentId: 'migration-verification',
    metadata: { action: 'verify-credential-migration', ...verification },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  return res.status(200).json({ success: true, verification });
}
