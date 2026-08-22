import type { DocumentStore } from '@/server/db/documentStore.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import {
  buildAssignmentAttemptDraftId,
  normalizeAssignmentAttemptDraftPayload,
  resolveNextAttemptNumber,
} from '../../../../shared/assignmentAttemptDraft.js';
import { canStudentAccessAssignment } from '../../../../shared/assignmentDelivery.js';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import { assertStudentInClass } from '../../lib/auth/authz.js';

async function loadStudentDraftContext(db: DocumentStore, assignmentId: string, uid: string) {
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.data() || {};
  const studentId = String(userData.studentId || '');
  if (!studentId) throw Object.assign(new Error('Not authorized'), { statusCode: 403 });

  const assignmentSnap = await db.collection('assignments').doc(assignmentId).get();
  if (!assignmentSnap.exists) {
    throw Object.assign(new Error('Assignment not found'), { statusCode: 404 });
  }
  const assignmentData = assignmentSnap.data()!;

  if (
    !canStudentAccessAssignment(
      { classId: assignmentData.classId, deliveryPolicy: assignmentData.deliveryPolicy },
      { classId: String(userData.classId || ''), studentId }
    )
  ) {
    throw Object.assign(new Error('Assignment is not available for this student'), {
      statusCode: 403,
    });
  }

  const studentData = await assertStudentInClass(
    db,
    studentId,
    String(assignmentData.classId || '')
  );

  const dueMs = Date.parse(String(assignmentData.dueDate || ''));
  if (Number.isFinite(dueMs) && Date.now() > dueMs + 24 * 60 * 60 * 1000 - 1) {
    throw Object.assign(new Error('Assignment is past due'), { statusCode: 400 });
  }

  return {
    assignmentData,
    studentData,
    studentId,
    draftId: buildAssignmentAttemptDraftId(assignmentId, studentId),
  };
}

function sendDraftError(res: ApiResponse, err: unknown) {
  const statusCode =
    err && typeof err === 'object' && 'statusCode' in err ? Number((err as any).statusCode) : 500;
  return res.status(Number.isFinite(statusCode) ? statusCode : 500).json({
    success: false,
    error: err instanceof Error ? err.message : 'Attempt draft request failed',
  });
}

export async function handleAssignmentAttemptDraftGet(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string }
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const assignmentId = typeof req.query.assignmentId === 'string' ? req.query.assignmentId : '';
  if (!assignmentId) return res.status(400).json({ success: false, error: 'Missing assignmentId' });

  try {
    const { draftId } = await loadStudentDraftContext(db, assignmentId, user.uid);
    const draftSnap = await db.collection('assignment_attempt_drafts').doc(draftId).get();
    return res.status(200).json({
      success: true,
      data: draftSnap.exists ? { id: draftSnap.id, ...draftSnap.data() } : null,
    });
  } catch (err) {
    return sendDraftError(res, err);
  }
}

export async function handleAssignmentAttemptDraftSave(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const body = normalizeBody(req.body);
  const assignmentId = getString(body, 'assignmentId');
  if (!assignmentId) return res.status(400).json({ success: false, error: 'Missing assignmentId' });

  try {
    const { assignmentData, studentData, studentId, draftId } = await loadStudentDraftContext(
      db,
      assignmentId,
      user.uid
    );
    const existingSubmissions = await db
      .collection('submissions')
      .where('assignmentId', '==', assignmentId)
      .where('studentId', '==', studentId)
      .get();
    const payload = normalizeAssignmentAttemptDraftPayload({
      assignment: {
        id: assignmentId,
        type: assignmentData.type,
        questions: assignmentData.questions,
        assessment: assignmentData.assessment,
      },
      raw: body,
    });
    const now = new Date().toISOString();
    const ref = db.collection('assignment_attempt_drafts').doc(draftId);
    const existing = await ref.get();
    const draft = {
      id: draftId,
      assignmentId,
      studentId,
      studentName: String(studentData.name || ''),
      classId: String(assignmentData.classId || ''),
      teacherId: String(assignmentData.teacherId || ''),
      ownerUid: user.uid,
      ...payload,
      attemptNumber: resolveNextAttemptNumber(existingSubmissions.docs.map((doc) => doc.data())),
      status: 'in_progress' as const,
      createdAt: existing.exists ? String(existing.data()?.createdAt || now) : now,
      updatedAt: now,
      ...(getString(body, 'clientSavedAt')
        ? { clientSavedAt: getString(body, 'clientSavedAt') }
        : {}),
    };
    await ref.set(draft, { merge: false });
    return res.status(200).json({ success: true, data: draft });
  } catch (err) {
    return sendDraftError(res, err);
  }
}

export async function handleAssignmentAttemptDraftClear(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const body = normalizeBody(req.body);
  const assignmentId = getString(body, 'assignmentId');
  if (!assignmentId) return res.status(400).json({ success: false, error: 'Missing assignmentId' });

  try {
    const { draftId } = await loadStudentDraftContext(db, assignmentId, user.uid);
    await db.collection('assignment_attempt_drafts').doc(draftId).delete();
    return res.status(200).json({ success: true });
  } catch (err) {
    return sendDraftError(res, err);
  }
}
