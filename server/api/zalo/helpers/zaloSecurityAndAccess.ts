import { type DocumentStore } from '@/server/db/documentStore.js';
import { withStatus, getString } from '../../lib/http/helpers.js';
import { isValidVNPhone, normalizePhoneVN } from '../../../../shared/phone.js';
import { type UserInfo, type CanonicalStudentRecipient } from './tuitionNotices.js';
import { resolveLinkedStudentProfileId } from '../../lib/student/canonicalAuthIdentity.js';
import { studentBelongsToClass } from '../../lib/auth/authz.js';

export type ZaloActorInfo = {
  uid: string;
  email?: string;
  role: string;
  name: string;
  displayName?: string;
  studentId?: string;
  teacherId?: string;
};

export async function getUserInfo(
  db: DocumentStore,
  uid: string,
  fallbackEmail?: string
): Promise<UserInfo> {
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.data() || {};
  return {
    uid,
    role: typeof data.role === 'string' ? data.role : 'unknown',
    name:
      (typeof data.displayName === 'string' && data.displayName) ||
      (typeof data.name === 'string' && data.name) ||
      fallbackEmail ||
      uid,
    studentId: typeof data.studentId === 'string' ? data.studentId : undefined,
    teacherId: typeof data.teacherId === 'string' ? data.teacherId : undefined,
  };
}

export function requireNotificationSenderRole(userInfo: ZaloActorInfo) {
  if (userInfo.role !== 'admin' && userInfo.role !== 'teacher') {
    throw withStatus('Not authorized for notifications', 403);
  }
}

export async function assertClassAccess(db: DocumentStore, classId: string, userInfo: ZaloActorInfo) {
  if (!classId) return;
  const snap = await db.collection('classes').doc(classId).get();
  if (!snap.exists) throw withStatus('Class not found', 404);
  const data = snap.data() || {};
  if (userInfo.role !== 'admin' && userInfo.role !== 'office' && data.teacherId !== userInfo.uid) {
    throw withStatus('Not authorized for this class', 403);
  }
}

export async function assertZaloStudentAccess(
  db: DocumentStore,
  requestedStudentId: string,
  classId: string,
  userInfo: ZaloActorInfo
) {
  if (!requestedStudentId) throw withStatus('Missing studentId', 400);
  // A Zalo message names the child it is about, and the link that carried
  // that id may predate a merge. Resolving first is what stops a tuition
  // notice about a real child being refused as an unknown student.
  const studentId = await resolveLinkedStudentProfileId(db, requestedStudentId);
  const studentSnap = await db.collection('students').doc(studentId).get();
  if (!studentSnap.exists) throw withStatus('Student not found', 404);
  const student = studentSnap.data() || {};
  const resolvedClassId = classId || String(student.classId || '');
  if (!resolvedClassId) throw withStatus('Missing classId', 400);
  // Membership is asked of the enrollment, with the profile field as the
  // fallback it already was. The projection alone refused a student who had
  // moved on paper but not in the record that decides attendance.
  if (!(await studentBelongsToClass(db, studentId, resolvedClassId))) {
    throw withStatus('Student does not belong to this class', 403);
  }
  const classSnap = await db.collection('classes').doc(resolvedClassId).get();
  if (!classSnap.exists) throw withStatus('Class not found', 404);
  const classData = classSnap.data() || {};
  const canAccess =
    userInfo.role === 'admin' ||
    userInfo.role === 'office' ||
    userInfo.role === 'accounting' ||
    String(classData.teacherId || student.teacherId || '') === userInfo.uid;
  if (!canAccess) throw withStatus('Not authorized for this student', 403);
  return { student, classData, classId: resolvedClassId };
}

export async function resolveCanonicalStudentRecipient(
  db: DocumentStore,
  requestedStudentId: string,
  classId: string,
  userInfo: ZaloActorInfo,
  options: { allowAccounting?: boolean; allowMissingStudentClass?: boolean } = {}
): Promise<CanonicalStudentRecipient> {
  if (!requestedStudentId || !classId) throw withStatus('Missing studentId or classId', 400);
  const studentId = await resolveLinkedStudentProfileId(db, requestedStudentId);
  const [studentSnap, classSnap] = await Promise.all([
    db.collection('students').doc(studentId).get(),
    db.collection('classes').doc(classId).get(),
  ]);
  if (!studentSnap.exists) throw withStatus('Student not found', 404);
  if (!classSnap.exists) throw withStatus('Class not found', 404);

  const student = studentSnap.data() || {};
  const classData = classSnap.data() || {};
  const studentClassId = String(student.classId || '');
  const belongs = await studentBelongsToClass(db, studentId, classId);
  if (!belongs && !(options.allowMissingStudentClass && !studentClassId)) {
    throw withStatus('Student does not belong to this class', 400);
  }
  const canAccessClass =
    userInfo.role === 'admin' ||
    userInfo.role === 'office' ||
    (options.allowAccounting && userInfo.role === 'accounting') ||
    String(classData.teacherId || '') === userInfo.uid;
  if (!canAccessClass) {
    throw withStatus('Not authorized for this class', 403);
  }

  const rawPhone = String(student.contact || '');
  if (!rawPhone) throw withStatus('Student contact is missing', 400);
  if (!isValidVNPhone(rawPhone)) throw withStatus('Student contact is invalid', 400);
  const phone = normalizePhoneVN(rawPhone);

  return {
    studentId,
    studentName: String(student.name || ''),
    studentCode: String(student.code || student.studentId || ''),
    classId,
    className: String(classData.name || ''),
    teacherId: String(classData.teacherId || student.teacherId || userInfo.uid),
    phone,
    classData,
  };
}

export async function getReceiptByRequest(
  db: DocumentStore,
  body: Record<string, unknown>
): Promise<{ id: string; data: Record<string, unknown> }> {
  const receiptId = getString(body, 'receiptId');
  const paymentRequestId = getString(body, 'paymentRequestId');
  const receiptNo = getString(body, 'receiptNo');

  if (receiptId) {
    const snap = await db.collection('receipts').doc(receiptId).get();
    if (!snap.exists) throw withStatus('Receipt not found', 404);
    return { id: snap.id, data: snap.data() || {} };
  }

  if (paymentRequestId) {
    const paymentSnap = await db.collection('payment_requests').doc(paymentRequestId).get();
    if (!paymentSnap.exists) throw withStatus('Payment request not found', 404);
    const payment = paymentSnap.data() || {};
    const resolvedReceiptId = String(payment.receiptId || '');
    if (!resolvedReceiptId) throw withStatus('Payment has no posted receipt', 400);
    const receiptSnap = await db.collection('receipts').doc(resolvedReceiptId).get();
    if (!receiptSnap.exists) throw withStatus('Receipt not found', 404);
    return { id: receiptSnap.id, data: receiptSnap.data() || {} };
  }

  if (receiptNo) {
    const snap = await db.collection('receipts').where('receiptNo', '==', receiptNo).limit(1).get();
    if (snap.empty) throw withStatus('Receipt not found', 404);
    const doc = snap.docs[0];
    return { id: doc.id, data: doc.data() || {} };
  }

  throw withStatus('Missing receiptId, paymentRequestId, or receiptNo', 400);
}

export function canReadNotification(data: Record<string, unknown>, userInfo: ZaloActorInfo) {
  if (userInfo.role === 'admin' || userInfo.role === 'accounting' || userInfo.role === 'office') {
    return true;
  }
  if (userInfo.role === 'teacher' && data.teacherId === userInfo.uid) return true;
  if (userInfo.role === 'parent' && data.studentId === userInfo.studentId) return true;
  return false;
}

export async function getNotificationWithReadAccess(
  db: DocumentStore,
  notificationId: string,
  userInfo: ZaloActorInfo
) {
  const ref = db.collection('notifications').doc(notificationId);
  const snap = await ref.get();
  if (!snap.exists) throw withStatus('Notification not found', 404);

  const data = snap.data() || {};
  if (canReadNotification(data, userInfo)) return { ref, data };
  throw withStatus('Not authorized for this notification', 403);
}
