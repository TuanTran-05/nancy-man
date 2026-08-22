import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { normalizeBody, getString, sendApiError } from '../../lib/http/helpers.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { writeStudentAudit } from '../../lib/student/studentCreation.js';
import {
  applyStudentLinkedUsersInTransaction,
  readStudentLinkedUsersInTransaction,
} from '../../lib/student/studentProfileSync.js';
import { applyClassStudentCountDeltas } from '../../lib/student/studentCounts.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { closeOpenLeavePeriods } from '../../lib/student/enrollmentWindowWrites.js';
import { readLeavePeriods } from '../../../../shared/studentEnrollmentWindows.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { withStatus } from './utils.js';
import {
  changedRequiredRosterClassIds,
  invalidateCourseClosingApprovals,
} from '../../classes/helpers/courseClosing.js';
import {
  closeOpenEnrollments,
  preloadStudentEnrollmentsInTransaction,
} from '../../lib/student/courseEnrollmentRepository.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { resolveCanonicalStudentId } from '../../lib/student/studentIdentityResolver.js';
import { assertStudentIdentityMutationAllowed } from '../../lib/maintenance/studentIdentityMaintenance.js';
import { readCanonicalStudentReadControlInTransaction } from '../../lib/student/canonicalStudentReadControl.js';
import { buildStudentRelationshipUpdateFields } from '../../lib/student/studentRelationshipProjection.js';

export async function handleDelete(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = normalizeBody(req.body);
    const requestedId =
      getString(body, 'id') || (typeof req.query.id === 'string' ? req.query.id : '');
    if (!requestedId) return res.status(400).json({ success: false, error: 'Missing student id' });

    // Resolved before the profile is read, so a request naming a retired or
    // aliased id archives the surviving profile rather than a stale document.
    const resolution = await resolveCanonicalStudentId(db, requestedId);
    const id = resolution.canonicalProfileId;
    await assertStudentIdentityMutationAllowed(db, {
      actorId: user.uid,
      operation: 'students:delete',
    });

    const studentRef = db.collection('students').doc(id);

    const statusChangedAt = new Date().toISOString();
    const baseUpdateData = {
      enrollmentStatus: 'dropped',
      studentLifecycle: 'archived',
      isRevoked: true,
      archivedAt: statusChangedAt,
      archivedBy: user.uid,
      archiveReason: getString(body, 'reason') || 'Archived by staff',
      // Keep legacy deletion metadata during the transition to the explicit archive contract.
      deletedAt: statusChangedAt,
      deletedBy: user.uid,
      statusNote: getString(body, 'reason') || 'Archived by staff',
      statusChangedAt,
      statusChangedBy: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    let transactionResult!: { before: Record<string, unknown>; after: Record<string, unknown> };
    await runStudentIdentityMutationTransaction(db, { actorId: user.uid, operation: 'students:delete' }, async (tx) => {
      const txStudentSnap = await tx.get(studentRef);
      if (!txStudentSnap.exists) {
        throw withStatus('Student already deleted', 404);
      }
      const txBefore = txStudentSnap.data() || {};
      const readControl = await readCanonicalStudentReadControlInTransaction(tx, db);
      const linkedUsers = await readStudentLinkedUsersInTransaction(tx, db, id);
      const enrollmentCollection = db.collection('student_course_enrollments') as any;
      const enrollmentState =
        typeof enrollmentCollection?.where === 'function'
          ? await preloadStudentEnrollmentsInTransaction(tx, db, id, '')
          : null;
      const openEnrollment = enrollmentState?.open ?? null;
      if (!canManageAcademicRecords(userInfo.role)) {
        if (!openEnrollment) {
          throw withStatus('Not authorized for this student', 403);
        }
        const classSnap = await tx.get(db.collection('classes').doc(openEnrollment.classId));
        if (!classSnap.exists || classSnap.data()?.teacherId !== user.uid) {
          throw withStatus('Not authorized for this student', 403);
        }
      }
      if (typeof enrollmentCollection?.where === 'function') {
        await closeOpenEnrollments(tx, db, {
          studentId: id,
          status: 'dropped',
          endedAt: getVietnamTodayStr(new Date(statusChangedAt)),
          reason: baseUpdateData.archiveReason,
          actorId: user.uid,
          now: statusChangedAt,
        }, enrollmentState ?? undefined);
      }
      // A soft-delete/archive is a terminal transition, same as any other exit
      // from on_leave (status.ts). Skipping this leaves the leave window open
      // forever — the student vanishes from the roster but their eligibility
      // history still claims they are on leave indefinitely.
      const hasOpenLeavePeriod = readLeavePeriods(txBefore.leavePeriods).some(
        (p) => p.until === null
      );
      const lifecycleUpdateData = hasOpenLeavePeriod
        ? {
            ...baseUpdateData,
            leavePeriods: closeOpenLeavePeriods(
              txBefore,
              getVietnamTodayStr(new Date(statusChangedAt))
            ),
          }
        : baseUpdateData;
      const updateData = {
        ...lifecycleUpdateData,
        ...buildStudentRelationshipUpdateFields(readControl.mode, {
          ...txBefore,
          enrollmentStatus: 'dropped',
        }),
      };
      const persistedAfter = { ...txBefore, ...updateData };
      const semanticBefore = openEnrollment
        ? {
            ...txBefore,
            classId: openEnrollment.classId,
            enrollmentStatus:
              openEnrollment.status === 'trial' ? 'active' : openEnrollment.status,
          }
        : txBefore;
      const semanticAfter = {
        ...semanticBefore,
        ...lifecycleUpdateData,
        ...(openEnrollment ? { classId: openEnrollment.classId } : {}),
        enrollmentStatus: 'dropped',
      };
      applyStudentLinkedUsersInTransaction(tx, id, persistedAfter, linkedUsers);
      applyClassStudentCountDeltas(tx, db, [{ before: semanticBefore, after: semanticAfter }]);
      tx.update(studentRef, updateData);
      transactionResult = { before: semanticBefore, after: semanticAfter };
    });
    await refreshAccountingStudentSummariesAfterCommit(db, [id], 'student-archived', {
      actorId: user.uid,
      operation: 'students:delete',
    });
    const affectedClassIds = changedRequiredRosterClassIds(
      transactionResult.before,
      transactionResult.after
    );
    const invalidatedClassIds = await invalidateCourseClosingApprovals(
      db,
      affectedClassIds,
      user.uid,
      'REQUIRED_ROSTER_CHANGED'
    );
    await writeStudentAudit(req, db, user, userInfo, 'delete', id, undefined, {
      studentName: transactionResult.before.name || 'unknown',
      studentCode: transactionResult.before.studentId || '',
      archived: true,
      event: 'course_closing_roster_changed',
      invalidationReason: 'REQUIRED_ROSTER_CHANGED',
      affectedClassIds,
      invalidatedClassIds,
    });
    await Promise.all([
      touchRealtimeEvent('students', { targetId: id }),
      touchRealtimeEvent('admin-summary'),
      ...affectedClassIds.map((classId) =>
        touchRealtimeEvent('course-closing', { targetId: classId })
      ),
    ]);

    return res.status(200).json({ success: true, id, softDeleted: true });
  } catch (err) {
    console.error('[Students/delete] Error:', err);
    return sendApiError(res, err, 'Failed to delete student');
  }
}
