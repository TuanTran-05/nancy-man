import type { DocumentStore } from '@/server/db/documentStore.js';
import { canManageAcademicRecords } from '../auth/permissions.js';

/**
 * Verify that a user has access to a class.
 * Academic managers have access to all classes. Teachers only to their own.
 * Throws with statusCode on failure.
 */
export async function assertTeacherClassAccess(
  db: DocumentStore,
  classId: string,
  uid: string,
  role: string
): Promise<Record<string, unknown>> {
  if (!classId) throw Object.assign(new Error('Missing classId'), { statusCode: 400 });
  const classDoc = await db.collection('classes').doc(classId).get();
  if (!classDoc.exists) throw Object.assign(new Error('Class not found'), { statusCode: 404 });
  const classData = classDoc.data() || {};
  if (!canManageAcademicRecords(role) && classData.teacherId !== uid) {
    throw Object.assign(new Error('Not authorized for this class'), { statusCode: 403 });
  }
  return classData;
}
