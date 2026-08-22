import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { getClientIp, writeAuditLog } from '../../lib/logging/auditLog.js';
import { normalizeBody, withStatus } from '../../lib/http/helpers.js';
import {
  admissionAddToWaitlistSchema,
  admissionDeletePendingSchema,
  validateBody,
} from '../../lib/validation/validations.js';
import { buildAdmissionSearchFields, findAdmissionMatches } from '../../lib/admissions/matching.js';
import { appendAdmissionHistory } from '../../lib/admissions/history.js';
import { createStudentWithGeneratedCode } from '../../lib/student/studentCreation.js';
import { formatStudentDisplayName } from '../../../../shared/studentRecords.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import { resolveCanonicalStudentIdInTransaction } from '../../lib/student/studentIdentityResolver.js';

type AuthenticatedUser = { uid: string; email?: string };
type UserInfo = { role: string; name: string };

export async function handleAddToWaitlist(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: AuthenticatedUser,
  userInfo: UserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role)) {
    throw withStatus('Not authorized to manage waiting list', 403);
  }
  const body = normalizeBody(req.body);
  const validation = validateBody(admissionAddToWaitlistSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const input = validation.data;

  const matches = await findAdmissionMatches(db, input);
  if (matches.currentExactMatches.length > 0) {
    throw withStatus('Student already has a current enrollment', 409);
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';

  const created = await createStudentWithGeneratedCode(db, (studentCode) => ({
    ...buildAdmissionSearchFields(input),
    name: formatStudentDisplayName(input.name),
    dob: input.dob,
    contact: input.contact.trim(),
    grade: input.grade ?? null,
    studentId: studentCode,
    studentLifecycle: 'pending',
    admissionStatus: 'pending',
    ...(note ? { note } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    admittedBy: user.uid,
  }), undefined, {
    actorId: user.uid,
    actorRole: userInfo.role,
    mutationOperation: 'waitlist_create',
  });

  try {
    await appendAdmissionHistory(db, {
      studentId: created.ref.id,
      action: 'added_to_waitlist',
      actorId: user.uid,
      actorRole: userInfo.role,
    });
  } catch (historyErr) {
    console.error('[admissions/add-to-waitlist] Failed to write history:', historyErr);
  }

  await writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'create',
    collection: 'students',
    documentId: created.ref.id,
    metadata: {
      action: 'add-to-waitlist',
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  await Promise.all([
    touchRealtimeEvent('admissions'),
    touchRealtimeEvent('students'),
    touchRealtimeEvent('admin-summary'),
  ]);

  return res.status(201).json({
    success: true,
    data: {
      mode: 'added',
      studentId: created.ref.id,
      studentCode: created.studentId,
    },
  });
}

export async function handleDeletePending(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: AuthenticatedUser,
  userInfo: UserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role)) {
    throw withStatus('Not authorized to delete pending students', 403);
  }
  const body = normalizeBody(req.body);
  const validation = validateBody(admissionDeletePendingSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const requestedId = validation.data.studentId;
  let studentId = '';
  let studentData: Record<string, unknown> = {};
  await runStudentIdentityMutationTransaction(
    db,
    { actorId: user.uid, operation: 'admissions:delete-pending' },
    async (tx) => {
      const resolution = await resolveCanonicalStudentIdInTransaction(tx, db, requestedId);
      studentId = resolution.canonicalProfileId;
      const studentRef = db.collection('students').doc(studentId);
      const studentSnap = await tx.get(studentRef);
      if (!studentSnap.exists) {
        throw withStatus('Student not found', 404);
      }
      studentData = studentSnap.data() || {};
      if (studentData.studentLifecycle !== 'pending') {
        throw withStatus('Student is not in pending state', 409);
      }
      tx.delete(studentRef);
    }
  );

  try {
    await appendAdmissionHistory(db, {
      studentId,
      action: 'deleted_from_waitlist',
      actorId: user.uid,
      actorRole: userInfo.role,
    });
  } catch (historyErr) {
    console.error('[admissions/delete-pending] Failed to write history:', historyErr);
  }

  await writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'delete',
    collection: 'students',
    documentId: studentId,
    metadata: {
      action: 'delete-pending',
      studentName: studentData.name,
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  await Promise.all([
    touchRealtimeEvent('admissions'),
    touchRealtimeEvent('students'),
    touchRealtimeEvent('admin-summary'),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      studentId,
      success: true,
    },
  });
}

export async function handleListPending(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: UserInfo
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role)) {
    throw withStatus('Not authorized to read waiting list', 403);
  }

  const snap = await db.collection('students').where('studentLifecycle', '==', 'pending').get();

  const students = snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      name: String(data.name || ''),
      studentId: String(data.studentId || ''),
      dob: String(data.dob || ''),
      contact: String(data.contact || ''),
      grade: data.grade !== undefined ? Number(data.grade) : null,
      note: typeof data.note === 'string' ? data.note : '',
      createdAt: data.createdAt
        ? typeof data.createdAt.toDate === 'function'
          ? data.createdAt.toDate().toISOString()
          : String(data.createdAt)
        : '',
    };
  });

  students.sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tB - tA;
  });

  return res.status(200).json({
    success: true,
    data: { students },
  });
}
