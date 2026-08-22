import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentReference, type DocumentStore } from '@/server/db/documentStore.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import { setStudentCredentials } from '../../lib/student/studentCredentials.js';
import { syncStudentLinkedUsersInTransaction } from '../../lib/student/studentProfileSync.js';
import {
  getStudentParentAuthContext,
  isStudentParentRole,
  requestedTargetMatchesAuthContext,
  type StudentParentRole,
} from '../../lib/student/studentParentAuth.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import {
  resolveLinkedStudentProfileId,
  selectStudentAuthProfile,
} from '../../lib/student/canonicalAuthIdentity.js';
import { readCanonicalStudentReadControl } from '../../lib/student/canonicalStudentReadControl.js';
import {
  runStudentIdentityMutationTransaction,
  type StudentIdentityMutationContext,
} from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import {
  generateRandomPassword,
  hashPassword,
  normalizePhone,
  validatePasswordStrength,
  verifyLookupToken,
  createTempPasswordRetrievalToken,
} from './shared.js';

async function updateStudentAuthFlags(
  db: DocumentStore,
  studentRef: DocumentReference,
  studentDocId: string,
  updateData: Record<string, unknown>,
  context: StudentIdentityMutationContext
) {
  await runStudentIdentityMutationTransaction(db, context, async (transaction) => {
    const currentStudent = await transaction.get(studentRef);
    if (!currentStudent.exists) throw new Error('Student not found');
    const after = { ...(currentStudent.data() || {}), ...updateData };
    await syncStudentLinkedUsersInTransaction(transaction, db, studentDocId, after);
    transaction.update(studentRef, updateData);
  });
}

export async function handleCreatePasswordRequest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res);
  if (!user) return;

  const db = getDb();
  const body = normalizeBody(req.body);
  const type = getString(body, 'type');
  if (!isStudentParentRole(type)) {
    return res.status(400).json({ success: false, error: 'Invalid password reset request type' });
  }

  const studentDocId = getString(body, 'studentDocId');
  const studentCode =
    getString(body, 'studentCode') || getString(body, 'userId') || getString(body, 'requestId');
  const lookupToken = getString(body, 'lookupToken');
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(
    db,
    `password_request:${ip}:${studentDocId || studentCode || user.uid}`,
    5,
    15 * 60 * 1000,
    { failClosed: true }
  );
  if (!allowed) return res.status(429).json({ success: false, error: 'Too many requests' });

  const resolvedDocId = studentDocId ? await resolveLinkedStudentProfileId(db, studentDocId) : '';
  let studentSnap = resolvedDocId
    ? await db.collection('students').doc(resolvedDocId).get()
    : null;
  if (!studentSnap?.exists && studentCode) {
    const code = studentCode.toUpperCase().replace(/^PH/, '');
    const byCode = await db.collection('students').where('studentId', '==', code).get();
    // Not `.limit(1)`. That silently answered "whichever one DocumentStore returned
    // first" for the codes carried by two documents, and this request creates
    // the reset that a later token spends.
    const { mode } = await readCanonicalStudentReadControl(db);
    const selection = await selectStudentAuthProfile(db, {
      code,
      candidates: byCode.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
      mode,
      surface: 'student_password_request',
    });
    const found = selection
      ? byCode.docs.find((doc) => doc.id === selection.profileId)
      : undefined;
    studentSnap = found
      ? ({ ...found, exists: true } as typeof studentSnap)
      : selection
        ? await db.collection('students').doc(selection.profileId).get()
        : null;
  }
  if (!studentSnap?.exists) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }

  // Require a valid lookup challenge token — proves the caller passed phone validation in lookup-student
  if (!lookupToken || !verifyLookupToken(lookupToken, studentSnap.id)) {
    return res.status(403).json({ success: false, error: 'Invalid or expired lookup token' });
  }

  const student = studentSnap.data() || {};
  const requestId = `${type}:${studentSnap.id}`;

  const existing = await db
    .collection('passwordResetRequests')
    .where('userId', '==', requestId)
    .where('status', '==', 'pending')
    .get();
  if (!existing.empty) {
    return res.status(409).json({ success: false, error: 'Pending request already exists' });
  }

  await db
    .collection('passwordResetRequests')
    .doc(requestId)
    .set({
      id: requestId,
      userId: requestId,
      studentDocId: studentSnap.id,
      studentName: String(student.name || ''),
      classId: String(student.classId || ''),
      teacherId: String(student.teacherId || ''),
      type,
      status: 'pending',
      createdAt: new Date().toISOString(),
      method: getString(body, 'method') || 'manual_request',
      phoneNumber: String(student.contact || ''),
      requestedBy: user.uid,
    });

  return res.status(200).json({ success: true });
}

export async function handleLogReset(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'teacher']);
  if (!user) return;

  const db = getDb();
  const body = normalizeBody(req.body);

  const studentDocId = getString(body, 'studentDocId');
  const type = getString(body, 'type');
  const validTypes = ['student', 'parent'];

  if (!studentDocId) {
    return res.status(400).json({ success: false, error: 'Missing studentDocId' });
  }
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid or missing type' });
  }

  const studentSnap = await db.collection('students').doc(studentDocId).get();
  if (!studentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }

  const studentData = studentSnap.data()!;
  const userDoc = await db.collection('users').doc(user.uid).get();
  const userRole = userDoc.data()?.role;

  if (userRole !== 'admin' && studentData.teacherId !== user.uid) {
    return res
      .status(403)
      .json({ success: false, error: 'Not authorized to log reset for this student' });
  }

  const userId = `${type}:${studentDocId}`;
  const teacherId = String(studentData.teacherId || '');
  const studentName = String(studentData.fullName || studentData.name || '');
  const phoneNumber = String(
    studentData.phoneNumber || studentData.parentPhone || studentData.contact || ''
  );
  const method = getString(body, 'method').trim();
  const reason = getString(body, 'reason').trim();

  if (!userId || !teacherId || !studentName || !phoneNumber || !method || !reason) {
    return res.status(400).json({
      success: false,
      error: 'Missing required reset log fields (name, phone, method, reason, teacherId)',
    });
  }

  const logRef = db.collection('passwordResetRequests').doc();
  await logRef.set({
    id: logRef.id,
    userId,
    studentDocId,
    type,
    status: 'approved',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    teacherId,
    studentName,
    phoneNumber,
    method,
    reason,
    loggedBy: user.uid,
  });

  return res.status(200).json({ success: true, id: logRef.id });
}

export async function handleApprove(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'teacher']);
  if (!user) return;

  const { requestId } = normalizeBody(req.body);
  if (!requestId || typeof requestId !== 'string') {
    return res
      .status(400)
      .json({ success: false, error: 'Missing required fields', code: 'MISSING_FIELDS' });
  }

  const db = getDb();
  const requestRef = db.collection('passwordResetRequests').doc(requestId);
  const requestDoc = await requestRef.get();
  if (!requestDoc.exists) {
    return res.status(404).json({ success: false, error: 'Request not found', code: 'NOT_FOUND' });
  }

  const requestData = requestDoc.data()!;
  const studentDocId = requestData.studentDocId;
  const type = requestData.type;
  if (!studentDocId || typeof studentDocId !== 'string' || !isStudentParentRole(type)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid password reset request data',
      code: 'INVALID_REQUEST_DATA',
    });
  }
  if (requestData.status !== 'pending') {
    return res.status(409).json({
      success: false,
      error: `Request already ${requestData.status}`,
      code: 'ALREADY_PROCESSED',
    });
  }

  const [userDoc, studentDoc] = await Promise.all([
    db.collection('users').doc(user.uid).get(),
    db.collection('students').doc(studentDocId).get(),
  ]);
  if (!studentDoc.exists) {
    return res.status(404).json({ success: false, error: 'Student not found', code: 'NOT_FOUND' });
  }

  const userRole = userDoc.data()?.role;
  const studentData = studentDoc.data() || {};
  if (userRole !== 'admin' && studentData.teacherId !== user.uid) {
    return res.status(403).json({
      success: false,
      error: 'Not authorized to approve this request',
      code: 'FORBIDDEN',
    });
  }

  const tempPassword = generateRandomPassword();
  const { salt, hash } = hashPassword(tempPassword);
  const updateData: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (type === 'student') {
    updateData.customLoginPasswordSet = true;
    updateData.forcePasswordChange = true;
    await setStudentCredentials(db, studentDocId, {
      loginPasswordSalt: salt,
      loginPasswordHash: hash,
      passwordVersion: 2,
    });
  } else {
    updateData.parentPasswordSet = true;
    updateData.parentForcePasswordChange = true;
    await setStudentCredentials(db, studentDocId, {
      parentPasswordSalt: salt,
      parentPasswordHash: hash,
      parentPasswordVersion: 2,
    });
  }

  await updateStudentAuthFlags(db, studentDoc.ref, studentDocId, updateData, {
    actorId: user.uid,
    operation: 'student_auth:approve',
  });
  await requestRef.update({
    status: 'approved',
    approvedBy: user.uid,
    updatedAt: new Date().toISOString(),
  });

  void writeAuditLog(getDb(), {
    userId: user.uid,
    userRole: userRole || 'unknown',
    action: 'password_reset',
    collection: 'students',
    documentId: studentDocId,
    metadata: { method: 'approve', type, requestId },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  const retrievalToken = await createTempPasswordRetrievalToken(
    tempPassword,
    `${type}:${studentDocId}`
  );

  return res.status(200).json({ success: true, retrievalToken });
}

export async function handleReset(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = normalizeBody(req.body);
  const requestedType = getString(body, 'type') || undefined;
  const requestedStudentDocId = getString(body, 'studentDocId');
  const lookupToken = getString(body, 'lookupToken');
  const newPassword = getString(body, 'newPassword');

  if (requestedType !== undefined && !isStudentParentRole(requestedType)) {
    return res
      .status(400)
      .json({ success: false, error: 'Invalid type: must be "student" or "parent"' });
  }
  if (!newPassword) return res.status(400).json({ success: false, error: 'Missing newPassword' });

  const pwValidation = validatePasswordStrength(newPassword);
  if (!pwValidation.valid) {
    return res.status(400).json({ success: false, error: pwValidation.error });
  }

  const db = getDb();
  const otpAuthorized = Boolean(
    requestedType &&
      requestedStudentDocId &&
      lookupToken &&
      verifyLookupToken(lookupToken, requestedStudentDocId)
  );
  if (lookupToken && !otpAuthorized) {
    return res.status(403).json({ success: false, error: 'Invalid or expired lookup token' });
  }

  const user = otpAuthorized
    ? ({ uid: `otp:${requestedStudentDocId}` } as Awaited<ReturnType<typeof verifyAuthToken>>)
    : await verifyAuthToken(req, res);
  if (!user) return;

  const userDoc = otpAuthorized
    ? null
    : await db.collection('users').doc(user.uid).get();
  const authContext = otpAuthorized
    ? null
    : getStudentParentAuthContext(
        user.uid,
        user as unknown as Record<string, unknown>,
        userDoc?.data()
      );
  let targetStudentDocId: string;
  let targetType: StudentParentRole;

  if (otpAuthorized && isStudentParentRole(requestedType) && requestedStudentDocId) {
    targetStudentDocId = requestedStudentDocId;
    targetType = requestedType;
  } else if (authContext) {
    if (!requestedTargetMatchesAuthContext(body, authContext)) {
      return res
        .status(403)
        .json({ success: false, error: 'Not authorized to reset this password' });
    }
    targetStudentDocId = authContext.studentId;
    targetType = authContext.role;
  } else {
    return res.status(403).json({ success: false, error: 'Not authorized to reset this password' });
  }

  // Resolved after authorization, never before: the token binding above is
  // checked against the id the caller actually holds, and this only decides
  // which profile's credentials the new password is written to.
  targetStudentDocId = await resolveLinkedStudentProfileId(db, targetStudentDocId);

  const studentDoc = await db.collection('students').doc(targetStudentDocId).get();
  if (!studentDoc.exists)
    return res.status(404).json({ success: false, error: 'Student not found' });

  const studentData = studentDoc.data() || {};
  const { salt, hash } = hashPassword(newPassword);
  const updateData: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (targetType === 'student') {
    updateData.customLoginPasswordSet = true;
    updateData.forcePasswordChange = false;
    await setStudentCredentials(db, targetStudentDocId, {
      loginPasswordSalt: salt,
      loginPasswordHash: hash,
      passwordVersion: 2,
    });
  } else {
    updateData.parentPasswordSet = true;
    updateData.parentForcePasswordChange = false;
    await setStudentCredentials(db, targetStudentDocId, {
      parentPasswordSalt: salt,
      parentPasswordHash: hash,
      parentPasswordVersion: 2,
    });
  }

  await updateStudentAuthFlags(db, studentDoc.ref, targetStudentDocId, updateData, {
    actorId: user.uid,
    operation: 'student_auth:reset',
  });

  void writeAuditLog(db, {
    userId: user.uid,
    userRole: authContext?.role || targetType,
    action: 'password_reset',
    collection: 'students',
    documentId: targetStudentDocId,
    metadata: { method: 'reset', type: targetType },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  return res.status(200).json({ success: true });
}

export async function handleRejectPasswordReset(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const user = await verifyAuthToken(req, res, ['admin', 'teacher']);
  if (!user) return;

  const body = normalizeBody(req.body);
  const requestId = getString(body, 'requestId');
  const reason = getString(body, 'reason');
  if (!requestId) return res.status(400).json({ success: false, error: 'Missing requestId' });

  const db = getDb();
  const requestRef = db.collection('passwordResetRequests').doc(requestId);
  const requestDoc = await requestRef.get();
  if (!requestDoc.exists)
    return res.status(404).json({ success: false, error: 'Request not found' });

  const requestData = requestDoc.data()!;
  if (requestData.status !== 'pending') {
    return res.status(409).json({ success: false, error: `Request already ${requestData.status}` });
  }

  const userDoc = await db.collection('users').doc(user.uid).get();
  const userRole = userDoc.data()?.role;
  if (userRole !== 'admin' && requestData.teacherId !== user.uid) {
    return res.status(403).json({ success: false, error: 'Not authorized to reject this request' });
  }

  await requestRef.update({
    status: 'rejected',
    reason: reason || 'No reason provided',
    rejectedBy: user.uid,
    updatedAt: new Date().toISOString(),
  });

  void writeAuditLog(db, {
    userId: user.uid,
    userRole: userRole || 'unknown',
    action: 'update',
    collection: 'passwordResetRequests',
    documentId: requestId,
    metadata: { method: 'reject-password-reset', reason: reason || 'No reason provided' },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  return res.status(200).json({ success: true });
}
