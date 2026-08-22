import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import {
  normalizeBody,
  getString,
  getOptionalString,
  getUserAgent,
} from '../../lib/http/helpers.js';

export async function handleUpdateProfile(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const displayName = getString(body, 'displayName');
  const faceImage = getOptionalString(body, 'faceImage') || '';
  const bio = getOptionalString(body, 'bio') || '';

  const userRef = db.collection('users').doc(user.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return res.status(404).json({ success: false, error: 'User not found' });

  const userData = userSnap.data() || {};

  try {
    await runStudentIdentityMutationTransaction(db, { actorId: user.uid, operation: 'students:update-profile' }, async (tx) => {
      if (userData.role === 'student' && userData.studentId) {
        const studentRef = db.collection('students').doc(String(userData.studentId));
        const studentSnap = await tx.get(studentRef);
        if (!studentSnap.exists) {
          throw new Error('Student record not found');
        }
        const studentData = studentSnap.data() || {};
        if (studentData.studentLifecycle === 'archived' || studentData.isRevoked === true) {
          throw new Error('Student record is archived or revoked');
        }
        tx.update(studentRef, {
          faceImage,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(userRef, {
        displayName: displayName || userData.displayName,
        faceImage,
        bio,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err: any) {
    if (
      err.message === 'Student record not found' ||
      err.message === 'Student record is archived or revoked'
    ) {
      return res.status(400).json({ success: false, error: err.message });
    }
    throw err;
  }

  writeAuditLog(db, {
    userId: user.uid,
    userRole: userData.role || 'unknown',
    action: 'update',
    collection: 'users',
    documentId: user.uid,
    metadata: { action: 'update-profile', displayName },
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  return res.status(200).json({ success: true });
}
