import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { writeStudentAudit } from '../../lib/student/studentCreation.js';
import { normalizeBody, getString, sendApiError } from '../../lib/http/helpers.js';
import { assertTeacherClassAccess } from '../../lib/services/classService.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { isJoinedAtInWindow } from '../../../../shared/classJoinWindow.js';
import {
  getStudentEnrollments,
  requireSingleOpenStudentEnrollment,
  tryResolveClassCurrentTerm,
} from '../../lib/student/courseEnrollmentRepository.js';
import { progressStudentToClass } from '../../lib/student/studentProgression.js';
import { resolveCanonicalStudentId } from '../../lib/student/studentIdentityResolver.js';
import { invalidateCourseClosingApprovals } from '../../classes/helpers/courseClosing.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';

/**
 * A transfer is a same-profile class change, so it delegates entirely to
 * `progressStudentToClass` (`kind: 'class_transfer'`) rather than
 * re-implementing enrollment, ledger, and linked-user updates here.
 *
 * The two implementations used to be independent: this handler ran its own
 * transaction closing the source enrollment, rolling the ledger, and
 * repointing linked users, while `progressStudentToClass` did the same thing
 * for class-to-class promotion. Any fix to one silently missed the other,
 * which is exactly the kind of drift that produced inconsistent student state
 * in production. There is now one implementation of "move a student between
 * classes on the same profile," and transfer is one of its two callers.
 */
export async function handleTransfer(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = normalizeBody(req.body);
    const requestedId = getString(body, 'id');
    const targetClassId = getString(body, 'targetClassId');
    const requestedJoinedAt = getString(body, 'joinedAt');
    if (!requestedId || !targetClassId) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing student id or target class id' });
    }

    if (!canManageAcademicRecords(userInfo.role)) {
      return res.status(403).json({ success: false, error: 'Not authorized for this student' });
    }

    // Resolved before the profile is read, so a request naming a retired or
    // aliased id acts on the surviving profile rather than a stale document.
    const resolution = await resolveCanonicalStudentId(db, requestedId);
    const id = resolution.canonicalProfileId;

    const studentRef = db.collection('students').doc(id);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const before = studentSnap.data() || {};
    const enrollments = await getStudentEnrollments(db, id);
    const sourceEnrollment = requireSingleOpenStudentEnrollment(enrollments);
    const sourceClassId = sourceEnrollment.classId;
    if (sourceClassId === targetClassId) {
      return res
        .status(400)
        .json({ success: false, error: 'Student is already in the target class' });
    }

    const classData = await assertTeacherClassAccess(db, targetClassId, user.uid, userInfo.role);
    if (classData.status === 'archived') {
      return res
        .status(400)
        .json({ success: false, error: 'Cannot transfer to an archived class' });
    }

    const now = new Date().toISOString();
    const today = getVietnamTodayStr(new Date(now));
    const term = tryResolveClassCurrentTerm(classData, today);
    const targetTermStart = term?.termStart || String(classData.startDate || '');
    const targetTermEnd = term?.termEnd || String(classData.endDate || '') || null;
    if (
      requestedJoinedAt &&
      targetTermStart &&
      !isJoinedAtInWindow({ termStart: targetTermStart, termEnd: targetTermEnd }, requestedJoinedAt)
    ) {
      return res.status(400).json({
        success: false,
        error: `joinedAt must fall between ${targetTermStart} and ${targetTermEnd || 'the open end of the course'}`,
      });
    }
    if (!targetTermStart) {
      return res
        .status(409)
        .json({ success: false, error: 'Target class has no stable course term start date' });
    }

    const result = await progressStudentToClass(db, {
      profileId: id,
      sourceClassId,
      targetClassId,
      targetTermStart,
      requestedJoinedAt: requestedJoinedAt || targetTermStart,
      kind: 'class_transfer',
      actorId: user.uid,
      mutationOperation: 'students:transfer',
      now,
    });

    await refreshAccountingStudentSummariesAfterCommit(db, [result.profileId], 'student-transferred', {
      actorId: user.uid,
      operation: 'students:transfer',
    });
    const invalidatedClassIds = await invalidateCourseClosingApprovals(
      db,
      result.affectedClassIds,
      user.uid,
      'REQUIRED_ROSTER_CHANGED'
    );

    await writeStudentAudit(req, db, user, userInfo, 'update', result.profileId, undefined, {
      studentName: before.name || 'unknown',
      action: 'transfer',
      sourceClassId,
      targetClassId,
      rolloverBalance: result.rolloverBalance,
      replayed: result.replayed,
      event: 'course_closing_roster_changed',
      invalidationReason: 'REQUIRED_ROSTER_CHANGED',
      affectedClassIds: result.affectedClassIds,
      invalidatedClassIds,
    });
    await Promise.all([
      touchRealtimeEvent('students', { targetId: result.profileId }),
      touchRealtimeEvent('admin-summary'),
      touchRealtimeEvent('accounting-students'),
      touchRealtimeEvent('accounting-student-finance'),
      touchRealtimeEvent('finance-ledger'),
      ...result.affectedClassIds.map((classId) =>
        touchRealtimeEvent('course-closing', { targetId: classId })
      ),
    ]);

    return res.status(200).json({
      success: true,
      id: result.profileId,
      sourceClassId,
      targetClassId,
      rolloverBalance: result.rolloverBalance,
      newLedgerCreated: result.targetLedgerCreated,
    });
  } catch (err) {
    console.error('[Students/transfer] Error:', err);
    return sendApiError(res, err, 'Failed to transfer student');
  }
}
