import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { normalizeBody, getString, sendApiError } from '../../lib/http/helpers.js';
import { validateBody, studentStatusSchema } from '../../lib/validation/validations.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { writeStudentAudit } from '../../lib/student/studentCreation.js';
import {
  applyStudentLinkedUsersInTransaction,
  readStudentLinkedUsersInTransaction,
} from '../../lib/student/studentProfileSync.js';
import { applyClassStudentCountDeltas } from '../../lib/student/studentCounts.js';
import { shouldInitializeEnrollmentDate } from '../../lib/student/enrollmentDate.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  openLeavePeriod,
  closeOpenLeavePeriods,
} from '../../lib/student/enrollmentWindowWrites.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { VALID_STATUSES, isArchivedStudentRecord, withStatus } from './utils.js';
import {
  changedRequiredRosterClassIds,
  invalidateCourseClosingApprovals,
} from '../../classes/helpers/courseClosing.js';
import {
  closeOpenEnrollments,
  preloadStudentEnrollmentsInTransaction,
  updateManualEnrollment,
} from '../../lib/student/courseEnrollmentRepository.js';
import { resolveCanonicalStudentId } from '../../lib/student/studentIdentityResolver.js';
import { assertStudentIdentityMutationAllowed } from '../../lib/maintenance/studentIdentityMaintenance.js';
import { readCanonicalStudentReadControlInTransaction } from '../../lib/student/canonicalStudentReadControl.js';
import { buildStudentRelationshipUpdateFields } from '../../lib/student/studentRelationshipProjection.js';

function buildLeavePeriodUpdate(
  enrollmentStatus: string,
  statusChangedAt: string,
  statusNote: string,
  before: Record<string, unknown>
): Record<string, unknown> {
  // statusChangedAt is a UTC instant (new Date().toISOString()). Slicing it
  // directly is the WRONG calendar day for roughly a third of the day: from
  // 00:00-06:59 Vietnam time, UTC is still the previous day, so the leave
  // period would open/close one day early relative to the office's clock.
  const today = getVietnamTodayStr(new Date(statusChangedAt));
  const wasOnLeave = before.enrollmentStatus === 'on_leave';

  if (enrollmentStatus === 'on_leave' && !wasOnLeave) {
    const plannedUntil =
      typeof before.leaveUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(before.leaveUntil)
        ? before.leaveUntil
        : null;
    return {
      leavePeriods: openLeavePeriod(before, {
        from: today,
        // ALWAYS null here. The student has not returned yet; `until` is written
        // once, on the way back out. The office's planned date rides alongside.
        until: null,
        classId: typeof before.classId === 'string' ? before.classId : '',
        ...(plannedUntil ? { plannedUntil } : {}),
        ...(statusNote ? { note: statusNote } : {}),
      }),
    };
  }

  // Returning to class, or leaving entirely, closes the window at today.
  if (wasOnLeave && enrollmentStatus !== 'on_leave') {
    return { leavePeriods: closeOpenLeavePeriods(before, today) };
  }

  return {};
}

function buildStudentStatusUpdateData(
  enrollmentStatus: string,
  statusNote: string,
  statusChangedAt: string,
  userId: string,
  before: Record<string, unknown>
): Record<string, unknown> {
  const base = {
    enrollmentStatus,
    statusNote,
    statusChangedAt,
    statusChangedBy: userId,
    updatedAt: FieldValue.serverTimestamp(),
    ...(enrollmentStatus === 'active' && shouldInitializeEnrollmentDate(before)
      ? { enrollmentDate: FieldValue.serverTimestamp() }
      : {}),
    ...buildLeavePeriodUpdate(enrollmentStatus, statusChangedAt, statusNote, before),
  };

  if (
    enrollmentStatus === 'active' ||
    enrollmentStatus === 'on_leave' ||
    enrollmentStatus === 'dropped' ||
    enrollmentStatus === 'promoted'
  ) {
    return {
      ...base,
      studentLifecycle: 'enrolled',
      isRevoked: false,
      deletedAt: FieldValue.delete(),
      archivedAt: FieldValue.delete(),
      archivedBy: FieldValue.delete(),
      archiveReason: FieldValue.delete(),
      deletedBy: FieldValue.delete(),
    };
  }

  return base;
}

function isRestoringArchivedRecord(
  before: Record<string, unknown>,
  nextEnrollmentStatus: string
): boolean {
  return (
    isArchivedStudentRecord(before) &&
    ['active', 'on_leave'].includes(nextEnrollmentStatus)
  );
}

function assertCanRestoreArchivedStudent(
  before: Record<string, unknown>,
  role: string,
  hasCanonicalPlacement = false
) {
  if (!isArchivedStudentRecord(before)) return;
  if (role !== 'admin' && role !== 'office') {
    throw withStatus('Only admin or office can restore archived students', 403);
  }
  if (!hasCanonicalPlacement && (!before.classId || !before.teacherId)) {
    throw withStatus('Admissions reactivation is required for archived historical students', 409);
  }
}

export async function handleStatus(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = normalizeBody(req.body);
    const validation = validateBody(studentStatusSchema, body);
    if (validation.success === false) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    const requestedId = getString(body, 'id');
    const enrollmentStatus = getString(body, 'enrollmentStatus');
    const statusNote = getString(body, 'statusNote');
    if (!requestedId || !VALID_STATUSES.includes(enrollmentStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid status payload' });
    }

    // Resolved before the profile is read, so a request naming a retired or
    // aliased id acts on the surviving profile rather than a stale document.
    const resolution = await resolveCanonicalStudentId(db, requestedId);
    const id = resolution.canonicalProfileId;
    await assertStudentIdentityMutationAllowed(db, {
      actorId: user.uid,
      operation: 'students:status',
    });

    const studentRef = db.collection('students').doc(id);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const before = studentSnap.data() || {};

    if (isArchivedStudentRecord(before) && enrollmentStatus === 'promoted') {
      return res
        .status(400)
        .json({ success: false, error: 'Cannot transition directly from archived to promoted' });
    }

    const statusChangedAt = new Date().toISOString();
    const today = getVietnamTodayStr(new Date(statusChangedAt));
    let transactionResult!: {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

    await runStudentIdentityMutationTransaction(db, { actorId: user.uid, operation: 'students:status' }, async (tx) => {
      const txStudentSnap = await tx.get(studentRef);
      if (!txStudentSnap.exists) {
        throw withStatus('Student not found', 404);
      }
      const txBefore = txStudentSnap.data() || {};
      if (isArchivedStudentRecord(txBefore) && enrollmentStatus === 'promoted') {
        throw withStatus('Cannot transition directly from archived to promoted', 400);
      }
      if (isArchivedStudentRecord(txBefore) && enrollmentStatus === 'dropped') {
        throw withStatus('Archived students cannot transition to dropped', 400);
      }
      const readControl = await readCanonicalStudentReadControlInTransaction(tx, db);
      const linkedUsers = await readStudentLinkedUsersInTransaction(tx, db, id);
      const enrollmentCollection = db.collection('student_course_enrollments');
      const canWriteEnrollments = typeof enrollmentCollection?.where === 'function';
      const enrollmentState = canWriteEnrollments
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
      if (isRestoringArchivedRecord(txBefore, enrollmentStatus)) {
        assertCanRestoreArchivedStudent(txBefore, userInfo.role, Boolean(openEnrollment));
      }
      if (enrollmentStatus === 'dropped' && canWriteEnrollments) {
        await closeOpenEnrollments(tx, db, {
          studentId: id,
          status: 'dropped',
          endedAt: today,
          reason: statusNote || 'student_status_dropped',
          actorId: user.uid,
          now: statusChangedAt,
        }, enrollmentState ?? undefined);
      } else if (canWriteEnrollments && openEnrollment) {
        await updateManualEnrollment(tx, db, {
          enrollmentId: openEnrollment.id,
          status: enrollmentStatus === 'on_leave' ? 'on_leave' : 'active',
          joinedAt: openEnrollment.joinedAt,
          endedAt: null,
          statusReason: statusNote || `student_status_${enrollmentStatus}`,
          actorId: user.uid,
          now: statusChangedAt,
        });
      }
      const placementBefore = openEnrollment
        ? {
            ...txBefore,
            classId: openEnrollment.classId,
            enrollmentStatus:
              openEnrollment.status === 'trial' ? 'active' : openEnrollment.status,
          }
        : txBefore;
      const statusUpdateData = buildStudentStatusUpdateData(
        enrollmentStatus,
        statusNote,
        statusChangedAt,
        user.uid,
        placementBefore
      );
      const txUpdateData = {
        ...statusUpdateData,
        ...buildStudentRelationshipUpdateFields(readControl.mode, {
          ...txBefore,
          enrollmentStatus,
        }),
      };
      const persistedAfter = { ...txBefore, ...txUpdateData };
      const semanticAfter = {
        ...placementBefore,
        ...statusUpdateData,
        ...(openEnrollment ? { classId: openEnrollment.classId } : {}),
        enrollmentStatus,
      };
      applyStudentLinkedUsersInTransaction(tx, id, persistedAfter, linkedUsers);
      applyClassStudentCountDeltas(tx, db, [
        { before: placementBefore, after: semanticAfter },
      ]);
      tx.update(studentRef, txUpdateData);
      transactionResult = { before: placementBefore, after: semanticAfter };
    });
    await refreshAccountingStudentSummariesAfterCommit(db, [id], 'student-status-changed', {
      actorId: user.uid,
      operation: 'students:status',
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

    await writeStudentAudit(
      req,
      db,
      user,
      userInfo,
      'status_change',
      id,
      {
        enrollmentStatus: {
          before: transactionResult.before.enrollmentStatus,
          after: enrollmentStatus,
        },
      },
      {
        studentName: transactionResult.before.name || 'unknown',
        statusNote,
        ...(affectedClassIds.length > 0
          ? {
              event: 'course_closing_roster_changed',
              invalidationReason: 'REQUIRED_ROSTER_CHANGED',
              affectedClassIds,
              invalidatedClassIds,
            }
          : {}),
      }
    );
    await Promise.all([
      touchRealtimeEvent('students', { targetId: id }),
      touchRealtimeEvent('admin-summary'),
      ...affectedClassIds.map((classId) =>
        touchRealtimeEvent('course-closing', { targetId: classId })
      ),
    ]);

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('[Students/status] Error:', err);
    return sendApiError(res, err, 'Failed to update student status');
  }
}
