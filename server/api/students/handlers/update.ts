import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { computeChanges } from '../../lib/logging/auditLog.js';
import { isValidStudentId } from '../../lib/ids/idGenerator.js';
import { normalizeBody, getString, sendApiError } from '../../lib/http/helpers.js';
import { validateBody, updateStudentSchema } from '../../lib/validation/validations.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { assertTeacherClassAccess } from '../../lib/services/classService.js';
import { buildStudentPayload, writeStudentAudit } from '../../lib/student/studentCreation.js';
import {
  assertStudentIdentityMutationAllowed,
  } from '../../lib/maintenance/studentIdentityMaintenance.js';
import {
  claimStudentCodeInTransaction,
  demoteStudentCodePrimaryInTransaction,
  normalizeStudentCode,
  readStudentCodeClaimInTransaction,
  STUDENT_CODE_REGISTRY_COLLECTION,
  type StudentCodeRegistryRecord,
} from '../../lib/student/studentCodeRegistry.js';
import {
  applyStudentLinkedUsersInTransaction,
  readStudentLinkedUsersInTransaction,
} from '../../lib/student/studentProfileSync.js';
import { applyClassStudentCountDeltas } from '../../lib/student/studentCounts.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { STUDENT_FIELDS, withStatus } from './utils.js';
import {
  changedRequiredRosterClassIds,
  invalidateCourseClosingApprovals,
} from '../../classes/helpers/courseClosing.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';

/**
 * Fields a generic update may never carry.
 *
 * All three are service-managed projections of the canonical enrollment. The
 * handler used to drop them silently, which reads as success to a caller that
 * believes it changed something — and would read as success to a UI that then
 * displays a class the student has no enrollment in.
 */
const SERVICE_MANAGED_RELATIONSHIP_FIELDS = [
  'teacherId',
  'currentEnrollmentId',
  'enrollmentStatus',
] as const;

const PROGRESSION_REQUIRED =
  'STUDENT_CLASS_CHANGE_REQUIRES_PROGRESSION: class membership is changed by the ' +
  'transfer/progression API, which closes the source enrollment, opens the target, ' +
  'and rolls the ledger. A profile-field write would leave all of that behind.';

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
    const validation = validateBody(updateStudentSchema, body);
    if (validation.success === false) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    const id = getString(body, 'id');
    if (!id) return res.status(400).json({ success: false, error: 'Missing student id' });

    const carried = SERVICE_MANAGED_RELATIONSHIP_FIELDS.filter(
      (field) => body[field] !== undefined && body[field] !== ''
    );
    if (carried.length > 0) {
      throw withStatus(`${PROGRESSION_REQUIRED} Remove: ${carried.join(', ')}.`, 409);
    }

    await assertStudentIdentityMutationAllowed(db, {
      actorId: user.uid,
      operation: 'students:update',
    });

    const studentRef = db.collection('students').doc(id);

    let classData: Record<string, unknown> | null = null;
    const requestedClassId = getString(body, 'classId');
    if (requestedClassId) {
      classData = await assertTeacherClassAccess(db, requestedClassId, user.uid, userInfo.role);
    }

    const requestedStudentId = getString(body, 'studentId');
    if (requestedStudentId && !isValidStudentId(requestedStudentId)) {
      throw new Error('Invalid student ID');
    }
    // Uniqueness is no longer a query: it is decided by the registry document
    // whose ID is the code, inside the same transaction as the profile write.
    const previousCodePolicy =
      getString(body, 'previousCodePolicy') === 'retired' ? 'retired' : 'alias';

    let transactionResult!: {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      updateData: Record<string, unknown>;
    };
    await runStudentIdentityMutationTransaction(db, { actorId: user.uid, operation: 'students:update' }, async (tx) => {
      // Reads first, and all of them. Every refusal below — maintenance, class
      // change, code ownership — has to be decided from data this transaction
      // serialized against, not from a snapshot taken beside it.
      const txStudentSnap = await tx.get(studentRef);
      if (!txStudentSnap.exists) {
        throw withStatus('Student not found', 404);
      }
      const txBefore = txStudentSnap.data() || {};
      if (!canManageAcademicRecords(userInfo.role) && txBefore.teacherId !== user.uid) {
        throw withStatus('Not authorized for this student', 403);
      }

      const storedClassId = String(txBefore.classId || '');
      if (requestedClassId && requestedClassId !== storedClassId) {
        throw withStatus(PROGRESSION_REQUIRED, 409);
      }
      const txClassId = storedClassId || requestedClassId;
      const resolvedClassData =
        classData || (await assertTeacherClassAccess(db, txClassId, user.uid, userInfo.role));

      const txRequestedStudentId = requestedStudentId || String(txBefore.studentId || '');
      const txTeacherId = String(txBefore.teacherId || resolvedClassData.teacherId || user.uid);
      const linkedUsers = await readStudentLinkedUsersInTransaction(tx, db, id);

      const storedCode = String(txBefore.studentId || '');
      const storedNormalized = storedCode ? normalizeStudentCode(storedCode) : '';
      const requestedNormalized = requestedStudentId ? normalizeStudentCode(requestedStudentId) : '';
      const codeChanged = requestedNormalized !== '' && requestedNormalized !== storedNormalized;

      let newCodeClaim: Awaited<ReturnType<typeof readStudentCodeClaimInTransaction>> | null = null;
      let previousRegistry: StudentCodeRegistryRecord | null = null;
      if (codeChanged) {
        newCodeClaim = await readStudentCodeClaimInTransaction(tx, db, {
          normalizedCode: requestedNormalized,
          canonicalProfileId: id,
        });
        if (storedNormalized) {
          const previousSnap = await tx.get(
            db.doc(`${STUDENT_CODE_REGISTRY_COLLECTION}/${storedNormalized}`)
          );
          previousRegistry = previousSnap.exists
            ? (previousSnap.data() as StudentCodeRegistryRecord)
            : null;
        }
      }

      const txUpdateData = buildStudentPayload(
        { ...txBefore, ...body, classId: txClassId },
        txRequestedStudentId,
        txTeacherId
      );
      const after = { ...txBefore, ...txUpdateData };

      // Writes from here down. The registry claim leads because it is the one
      // that can still refuse: a code owned by another profile must not leave a
      // staged profile write behind it.
      if (codeChanged && newCodeClaim) {
        claimStudentCodeInTransaction(
          tx,
          db,
          {
            normalizedCode: requestedNormalized,
            canonicalProfileId: id,
            actorId: user.uid,
            isPrimary: true,
            status: 'active',
          },
          newCodeClaim
        );
        if (previousRegistry) {
          demoteStudentCodePrimaryInTransaction(
            tx,
            db,
            {
              normalizedCode: storedNormalized,
              canonicalProfileId: id,
              actorId: user.uid,
              status: previousCodePolicy,
            },
            { registry: previousRegistry }
          );
        }
      }

      applyStudentLinkedUsersInTransaction(tx, id, after, linkedUsers);
      applyClassStudentCountDeltas(tx, db, [{ before: txBefore, after }]);
      tx.update(studentRef, txUpdateData);
      transactionResult = { before: txBefore, after, updateData: txUpdateData };
    });
    await refreshAccountingStudentSummariesAfterCommit(db, [id], 'student-updated', {
      actorId: user.uid,
      operation: 'students:update',
    });

    const after = { ...transactionResult.after, updatedAt: undefined };
    const affectedClassIds = changedRequiredRosterClassIds(transactionResult.before, after);
    const invalidatedClassIds = await invalidateCourseClosingApprovals(
      db,
      affectedClassIds,
      user.uid,
      'REQUIRED_ROSTER_CHANGED'
    );
    const changes = computeChanges(transactionResult.before, after, STUDENT_FIELDS);
    await writeStudentAudit(req, db, user, userInfo, 'update', id, changes, {
      studentName: transactionResult.updateData.name,
      ...(affectedClassIds.length > 0
        ? {
            event: 'course_closing_roster_changed',
            invalidationReason: 'REQUIRED_ROSTER_CHANGED',
            affectedClassIds,
            invalidatedClassIds,
          }
        : {}),
    });
    await Promise.all([
      touchRealtimeEvent('students', { targetId: id }),
      touchRealtimeEvent('admin-summary'),
      ...affectedClassIds.map((classId) =>
        touchRealtimeEvent('course-closing', { targetId: classId })
      ),
    ]);

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('[Students/update] Error:', err);
    return sendApiError(res, err, 'Failed to update student');
  }
}
