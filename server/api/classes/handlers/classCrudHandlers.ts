import { randomUUID } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import {
  canManageAcademicRecords,
  canManageClassFinanceFields,
} from '../../lib/auth/permissions.js';
import {
  validateBody,
  createClassSchema,
  updateClassSchema,
} from '../../lib/validation/validations.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { normalizeBody, getString, sendApiError } from '../../lib/http/helpers.js';
import { computeChanges } from '../../lib/logging/auditLog.js';
import {
  buildClassPayload,
  ensureUniqueClassName,
  writeClassAudit,
  assertClassWriteAccess,
  getStatus,
  requireStatus,
  CLASS_FIELDS,
  type ClassStatus,
} from '../helpers/classHelpers.js';
import { importStudentsFromClass } from '../helpers/studentImportHelper.js';
import { assertStudentIdentityMutationAllowed } from '../../lib/maintenance/studentIdentityMaintenance.js';
import { executeClassUpdateAndSyncAtomic } from '../helpers/classSyncHelper.js';
import { invalidateCourseClosingApprovals } from '../helpers/courseClosing.js';
import { invalidateAdminClassTuitionSnapshotHealth } from '../../lib/services/adminClassTuitionSnapshotInvalidation.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';

export async function handleCreate(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Only admins can create classes' });
  }

  try {
    const body = normalizeBody(req.body);
    const validation = validateBody(createClassSchema, body);
    if (validation.success === false) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    const teacherId = getString(body, 'teacherId');
    const importSourceClassId = getString(body, 'importSourceClassId');
    const data: Record<string, unknown> = {
      ...buildClassPayload(body, teacherId),
      currentCourseId: randomUUID(),
      createdAt: FieldValue.serverTimestamp(),
      // Record where a promoted cohort came from: payroll for the source class must
      // stop once its students move here, and that link is otherwise unrecoverable.
      ...(importSourceClassId
        ? { importSourceClassId, promotedAt: FieldValue.serverTimestamp() }
        : {}),
    };
    if (!canManageClassFinanceFields(userInfo.role)) {
      data.salaryPerSession = 0;
      data.tuitionFee = 0;
    }
    await ensureUniqueClassName(db, String(data['name']));

    if (importSourceClassId) {
      await assertStudentIdentityMutationAllowed(db, {
        actorId: user.uid,
        operation: 'classes:create',
      });
    }
    const classRef = await db.collection('classes').add(data);
    const importResult = await importStudentsFromClass(db, {
      sourceClassId: importSourceClassId,
      targetClassId: classRef.id,
      teacherId,
      targetGrade: typeof data['grade'] === 'number' ? data['grade'] : null,
      actorId: user.uid,
      mutationOperation: 'classes:create',
      // Creating the next class for a cohort: the source course is finishing.
      kind: 'course_completion',
    });

    await writeClassAudit(req, db, user, userInfo, 'create', classRef.id, undefined, {
      className: data['name'],
      teacherId,
      grade: data['grade'],
      ...(importSourceClassId ? { importSourceClassId } : {}),
      importedCount: importResult.importedCount,
      skippedDuplicates: importResult.skippedDuplicates,
      replayedCount: importResult.replayedCount,
      failures: importResult.failures,
    });

    await Promise.all([
      invalidateAdminClassTuitionSnapshotHealth(db, 'class:create'),
      touchRealtimeEvent('admin-summary'),
      touchRealtimeEvent('office-schedule-changed', { targetId: classRef.id }),
      touchRealtimeEvent('office-academic-changed', { targetId: classRef.id }),
      touchRealtimeEvent('students'),
      touchRealtimeEvent('payroll'),
      // A promoted cohort arrives owing tuition. The Students page caches
      // ledgers for 15 minutes and only refreshes them on this channel, so
      // without the bump the debt column sits stale while the roster updates.
      ...(importResult.createdLedgerCount > 0 ? [touchRealtimeEvent('finance-ledger')] : []),
    ]);

    return res.status(201).json({ success: true, id: classRef.id, ...importResult });
  } catch (err) {
    console.error('[Classes/create] Error:', err);
    return sendApiError(res, err, 'Failed to create class');
  }
}

export async function handleUpdate(
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
    const validation = validateBody(updateClassSchema, body);
    if (validation.success === false) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    const id = getString(body, 'id');
    if (!id) return res.status(400).json({ success: false, error: 'Missing class id' });

    const classRef = db.collection('classes').doc(id);
    const classSnap = await classRef.get();
    if (!classSnap.exists)
      return res.status(404).json({ success: false, error: 'Class not found' });

    const before = classSnap.data() || {};
    await assertClassWriteAccess(before, user.uid, userInfo.role);

    let updateData: Record<string, unknown>;
    if (!canManageAcademicRecords(userInfo.role)) {
      updateData = {
        status: getStatus(body.status),
        updatedAt: FieldValue.serverTimestamp(),
      };
    } else {
      updateData = buildClassPayload(
        body,
        getString(body, 'teacherId') || String(before.teacherId || '')
      );
      if (!canManageClassFinanceFields(userInfo.role)) {
        updateData.salaryPerSession = before.salaryPerSession ?? 0;
        updateData.tuitionFee = before.tuitionFee ?? 0;
      }
      await ensureUniqueClassName(db, String(updateData.name), id);
    }

    const newEndDate = updateData.endDate as string | undefined;
    const isEndDateChanged =
      canManageAcademicRecords(userInfo.role) &&
      newEndDate &&
      newEndDate !== String(before.endDate || '');

    const beforeDates = {
      startDate: String(before.startDate || ''),
      endDate: String(before.endDate || ''),
    };
    const afterDates = {
      startDate: String(updateData.startDate ?? before.startDate ?? ''),
      endDate: String(updateData.endDate ?? before.endDate ?? ''),
    };
    const courseDatesChanged =
      beforeDates.startDate !== afterDates.startDate || beforeDates.endDate !== afterDates.endDate;

    if (courseDatesChanged) {
      await assertStudentIdentityMutationAllowed(db, {
        actorId: user.uid,
        operation: 'classes:update-term-dates',
      });
    }

    const syncResult = await executeClassUpdateAndSyncAtomic(db, id, updateData, {
      status: updateData.status as ClassStatus,
      prevStatus: before.status as ClassStatus | undefined,
      teacherId:
        canManageAcademicRecords(userInfo.role) && updateData.teacherId !== before.teacherId
          ? String(updateData.teacherId || '')
          : undefined,
      prevTeacherId: before.teacherId as string | undefined,
      newEndDate: isEndDateChanged ? newEndDate : undefined,
      actorId: user.uid,
      termDateChange: courseDatesChanged
        ? {
            beforeStartDate: beforeDates.startDate,
            beforeEndDate: beforeDates.endDate || null,
            afterStartDate: afterDates.startDate,
            afterEndDate: afterDates.endDate || null,
          }
        : undefined,
    });

    if (syncResult.termDateStudentIds.length > 0) {
      await refreshAccountingStudentSummariesAfterCommit(
        db,
        syncResult.termDateStudentIds,
        'class-term-dates-corrected',
        { actorId: user.uid, operation: 'classes:update' }
      );
    }

    const statusSync = { updatedStudents: syncResult.updatedStudents };
    const teacherSync = { updatedStudents: syncResult.updatedStudents };
    const syncedEvaluations = syncResult.updatedEvaluations;
    const invalidatedClassIds = courseDatesChanged
      ? await invalidateCourseClosingApprovals(db, [id], user.uid, 'COURSE_DATES_CHANGED')
      : [];

    const changes = computeChanges(before, { ...before, ...updateData }, CLASS_FIELDS);
    await writeClassAudit(req, db, user, userInfo, 'update', id, changes, {
      className: updateData.name || before.name,
      statusUpdatedStudents: statusSync.updatedStudents,
      teacherUpdatedStudents: teacherSync.updatedStudents,
      syncedEvaluations,
      ...(courseDatesChanged
        ? {
            event: 'course_closing_invalidated',
            invalidationReason: 'COURSE_DATES_CHANGED',
            beforeDates,
            afterDates,
            invalidatedClassIds,
            alignedEnrollments: syncResult.alignedEnrollments,
            movedEnrollmentDocuments: syncResult.movedEnrollmentDocuments,
            updatedCourseFeeLedgers: syncResult.updatedLedgers,
          }
        : {}),
    });

    await Promise.all([
      invalidateAdminClassTuitionSnapshotHealth(db, 'class:update'),
      touchRealtimeEvent('admin-summary'),
      touchRealtimeEvent('office-schedule-changed', { targetId: id }),
      touchRealtimeEvent('office-academic-changed', { targetId: id }),
      touchRealtimeEvent('payroll'),
      ...(courseDatesChanged
        ? [
            touchRealtimeEvent('course-closing', { targetId: id }),
            touchRealtimeEvent('students'),
            touchRealtimeEvent('finance-ledger'),
          ]
        : []),
    ]);

    return res.status(200).json({ success: true, id, statusSync, teacherSync, syncedEvaluations });
  } catch (err) {
    console.error('[Classes/update] Error:', err);
    return sendApiError(res, err, 'Failed to update class');
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
    const id = getString(body, 'id');
    const status = requireStatus(body.status);
    if (!id) return res.status(400).json({ success: false, error: 'Missing class id' });

    const classRef = db.collection('classes').doc(id);
    const classSnap = await classRef.get();
    if (!classSnap.exists)
      return res.status(404).json({ success: false, error: 'Class not found' });

    const before = classSnap.data() || {};
    await assertClassWriteAccess(before, user.uid, userInfo.role);

    const statusUpdateData = {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(status === 'archived'
        ? {}
        : {
            archivedAt: FieldValue.delete(),
            archivedBy: FieldValue.delete(),
            archiveReason: FieldValue.delete(),
          }),
    };
    const syncResult = await executeClassUpdateAndSyncAtomic(db, id, statusUpdateData, {
      status,
      prevStatus: before.status as ClassStatus | undefined,
      actorId: user.uid,
    });
    const statusSync = { updatedStudents: syncResult.updatedStudents };

    await writeClassAudit(
      req,
      db,
      user,
      userInfo,
      'status_change',
      id,
      { status: { before: before.status, after: status } },
      { className: before.name, updatedStudents: statusSync.updatedStudents }
    );

    await Promise.all([
      invalidateAdminClassTuitionSnapshotHealth(db, 'class:status'),
      touchRealtimeEvent('admin-summary'),
      touchRealtimeEvent('office-schedule-changed', { targetId: id }),
      touchRealtimeEvent('office-academic-changed', { targetId: id }),
      touchRealtimeEvent('students'),
      touchRealtimeEvent('payroll'),
    ]);

    return res.status(200).json({ success: true, id, statusSync });
  } catch (err) {
    console.error('[Classes/status] Error:', err);
    return sendApiError(res, err, 'Failed to update class status');
  }
}

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
  if (!canManageAcademicRecords(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Only admins can delete classes' });
  }

  try {
    const body = normalizeBody(req.body);
    const id = getString(body, 'id') || (typeof req.query.id === 'string' ? req.query.id : '');
    if (!id) return res.status(400).json({ success: false, error: 'Missing class id' });

    const classRef = db.collection('classes').doc(id);
    const classSnap = await classRef.get();
    if (!classSnap.exists) {
      return res.status(404).json({ success: false, error: 'Class already deleted' });
    }

    const classData = classSnap.data() || {};
    const syncResult = await executeClassUpdateAndSyncAtomic(
      db,
      id,
      {
        status: 'archived',
        archivedAt: FieldValue.serverTimestamp(),
        archivedBy: user.uid,
        archiveReason: getString(body, 'reason') || 'Archived by staff',
        deletedAt: FieldValue.serverTimestamp(),
        deletedBy: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {
        status: 'archived',
        prevStatus: classData.status as ClassStatus | undefined,
        actorId: user.uid,
      }
    );
    const statusSync = { updatedStudents: syncResult.updatedStudents };
    await writeClassAudit(req, db, user, userInfo, 'delete', id, undefined, {
      className: classData.name || 'unknown',
      teacherId: classData.teacherId,
      archived: true,
      statusSync,
    });

    await Promise.all([
      invalidateAdminClassTuitionSnapshotHealth(db, 'class:delete'),
      touchRealtimeEvent('admin-summary'),
      touchRealtimeEvent('office-schedule-changed', { targetId: id }),
      touchRealtimeEvent('office-academic-changed', { targetId: id }),
      touchRealtimeEvent('students'),
      touchRealtimeEvent('payroll'),
    ]);

    return res.status(200).json({ success: true, id, softDeleted: true, statusSync });
  } catch (err) {
    console.error('[Classes/delete] Error:', err);
    return sendApiError(res, err, 'Failed to delete class');
  }
}
