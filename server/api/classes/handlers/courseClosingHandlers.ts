import { randomUUID } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import {
  COURSE_CLOSING_EVALUATIONS_INCOMPLETE,
  COURSE_CLOSING_NOT_APPROVED,
  COURSE_CLOSING_NO_REQUIRED_STUDENTS,
  COURSE_CLOSING_STUDENT_EXEMPT,
  type CourseClosingState,
} from '../../../../shared/courseClosing.js';
import { normalizeBody, getString, sendApiError, withStatus } from '../../lib/http/helpers.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  computeCourseClosingComputation,
  computeCourseClosingSnapshot,
  CourseClosingError,
} from '../helpers/courseClosing.js';
import { writeClassAudit } from '../helpers/classHelpers.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';

type HandlerUser = { uid: string; email?: string };
type HandlerUserInfo = { role: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function storedCourseClosing(value: unknown): CourseClosingState | undefined {
  return isRecord(value) ? (value as unknown as CourseClosingState) : undefined;
}

function assertStatusReadAccess(
  classData: Record<string, unknown>,
  user: HandlerUser,
  userInfo: HandlerUserInfo
): void {
  if (userInfo.role === 'admin' || userInfo.role === 'office') return;
  if (userInfo.role === 'teacher' && String(classData.teacherId || '') === user.uid) return;
  throw withStatus('You do not have access to this course closing status', 403);
}

export async function handleCourseClosingStatus(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: HandlerUser,
  userInfo: HandlerUserInfo
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const classId = getString(req.query as Record<string, unknown>, 'classId');
    if (!classId) return res.status(400).json({ success: false, error: 'Missing classId' });

    const classSnap = await db.collection('classes').doc(classId).get();
    if (!classSnap.exists) throw withStatus('Class not found', 404);
    assertStatusReadAccess(classSnap.data() || {}, user, userInfo);

    const courseClosing = await computeCourseClosingSnapshot(db, classId);
    return res.status(200).json({ success: true, courseClosing });
  } catch (err) {
    console.error('[Classes/course-closing-status] Error:', err);
    return sendApiError(res, err, 'Failed to read course closing status');
  }
}

export async function handleApproveCourseClosing(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: HandlerUser,
  userInfo: HandlerUserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'teacher' && userInfo.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Only teachers or admins can approve' });
  }

  const body = normalizeBody(req.body);
  const classId = getString(body, 'classId');
  const reason = getString(body, 'reason').trim();
  if (!classId) return res.status(400).json({ success: false, error: 'Missing classId' });
  if (userInfo.role === 'admin' && !reason) {
    return res.status(400).json({ success: false, error: 'Admin approval reason is required' });
  }

  try {
    const result = await runStudentIdentityMutationTransaction(
      db,
      { actorId: user.uid, operation: 'classes:approve-course-closing' },
      async (transaction) => {
      const classRef = db.collection('classes').doc(classId);
      const classSnap = await transaction.get(classRef);
      if (!classSnap.exists) throw withStatus('Class not found', 404);
      const classData = (classSnap.data() || {}) as Record<string, unknown>;
      if (userInfo.role === 'teacher' && String(classData.teacherId || '') !== user.uid) {
        throw withStatus('Only the assigned teacher can approve course closing', 403);
      }

      const currentCourseId = String(classData.currentCourseId || '');
      const courseId = currentCourseId || randomUUID();
      const computation = await computeCourseClosingComputation(db, classId, {
        transaction,
        courseIdOverride: courseId,
      });
      const { snapshot, fingerprints } = computation;
      if (snapshot.requiredStudentCount === 0) {
        throw new CourseClosingError(
          409,
          COURSE_CLOSING_NO_REQUIRED_STUDENTS,
          'Course closing requires at least one active student',
          snapshot
        );
      }
      if (snapshot.finalEvaluationCount !== snapshot.requiredStudentCount) {
        throw new CourseClosingError(
          409,
          COURSE_CLOSING_EVALUATIONS_INCOMPLETE,
          'Final evaluations are incomplete',
          snapshot
        );
      }

      const currentState = storedCourseClosing(classData.courseClosing);
      const currentApproval = currentState?.approval;
      const idempotent = Boolean(
        snapshot.approvalValid &&
        currentApproval?.status === 'approved' &&
        currentApproval.approvedBy === user.uid &&
        currentApproval.rosterFingerprint === fingerprints.rosterFingerprint &&
        currentApproval.evaluationFingerprint === fingerprints.evaluationFingerprint
      );
      if (idempotent) return { changed: false, courseId, snapshot };

      const nowIso = new Date().toISOString();
      const courseClosing: CourseClosingState = {
        courseId,
        termStart: String(classData.startDate || ''),
        termEnd: String(classData.endDate || ''),
        approval: {
          status: 'approved',
          source: userInfo.role === 'admin' ? 'admin' : 'teacher',
          approvedAt: nowIso,
          approvedBy: user.uid,
          approvedByRole: userInfo.role === 'admin' ? 'admin' : 'teacher',
          ...(userInfo.role === 'admin' ? { adminReason: reason } : {}),
          rosterFingerprint: fingerprints.rosterFingerprint,
          evaluationFingerprint: fingerprints.evaluationFingerprint,
        },
        exemptions:
          currentState?.courseId === courseId && Array.isArray(currentState.exemptions)
            ? currentState.exemptions
            : [],
      };
      transaction.update(classRef, {
        currentCourseId: courseId,
        courseClosing,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { changed: true, courseId, snapshot };
    });

    if (!result.changed) {
      return res.status(200).json({ success: true, courseClosing: result.snapshot });
    }

    const courseClosing = await computeCourseClosingSnapshot(db, classId);
    await writeClassAudit(req, db, user, userInfo, 'update', classId, undefined, {
      event:
        userInfo.role === 'admin' ? 'course_closing_admin_approved' : 'course_closing_approved',
      classId,
      courseId: result.courseId,
      ...(userInfo.role === 'admin' ? { reason } : {}),
    });
    await touchRealtimeEvent('course-closing', { targetId: classId });
    return res.status(200).json({ success: true, courseClosing });
  } catch (err) {
    console.error('[Classes/approve-course-closing] Error:', err);
    return sendApiError(res, err, 'Failed to approve course closing');
  }
}

export async function handleExemptCourseClosingStudent(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: HandlerUser,
  userInfo: HandlerUserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Only admins can exempt students' });
  }

  const body = normalizeBody(req.body);
  const classId = getString(body, 'classId');
  const studentId = getString(body, 'studentId');
  const reason = getString(body, 'reason').trim();
  if (!classId || !studentId || !reason) {
    return res.status(400).json({
      success: false,
      error: 'classId, studentId, and exemption reason are required',
    });
  }

  try {
    const result = await runStudentIdentityMutationTransaction(
      db,
      { actorId: user.uid, operation: 'classes:exempt-course-closing-student' },
      async (transaction) => {
      const classRef = db.collection('classes').doc(classId);
      const classSnap = await transaction.get(classRef);
      if (!classSnap.exists) throw withStatus('Class not found', 404);
      const classData = (classSnap.data() || {}) as Record<string, unknown>;
      const courseId = String(classData.currentCourseId || '');
      const computation = await computeCourseClosingComputation(db, classId, { transaction });
      if (!courseId || !computation.snapshot.approvalValid) {
        throw new CourseClosingError(
          409,
          COURSE_CLOSING_NOT_APPROVED,
          'Course closing approval is missing or stale',
          computation.snapshot
        );
      }
      if (!computation.requiredStudentIds.includes(studentId)) {
        throw new CourseClosingError(
          409,
          COURSE_CLOSING_STUDENT_EXEMPT,
          'Student is not in the current required roster',
          computation.snapshot
        );
      }

      const currentState = storedCourseClosing(classData.courseClosing);
      const exemptions =
        currentState?.courseId === courseId && Array.isArray(currentState.exemptions)
          ? currentState.exemptions
          : [];
      if (exemptions.some((item) => item.studentId === studentId)) {
        throw new CourseClosingError(
          409,
          COURSE_CLOSING_STUDENT_EXEMPT,
          'Student is already exempt for this course',
          computation.snapshot
        );
      }

      const createdAt = new Date().toISOString();
      transaction.update(classRef, {
        courseClosing: {
          ...currentState,
          courseId,
          termStart: String(classData.startDate || ''),
          termEnd: String(classData.endDate || ''),
          exemptions: [...exemptions, { studentId, reason, createdBy: user.uid, createdAt }],
        } satisfies CourseClosingState,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { courseId };
    });

    const courseClosing = await computeCourseClosingSnapshot(db, classId);
    await writeClassAudit(req, db, user, userInfo, 'update', classId, undefined, {
      event: 'course_closing_student_exempted',
      classId,
      courseId: result.courseId,
      studentId,
      reason,
    });
    await touchRealtimeEvent('course-closing', { targetId: classId });
    return res.status(200).json({ success: true, courseClosing });
  } catch (err) {
    console.error('[Classes/exempt-course-closing-student] Error:', err);
    return sendApiError(res, err, 'Failed to exempt course closing student');
  }
}
