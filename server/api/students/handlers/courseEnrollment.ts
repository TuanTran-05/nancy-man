import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import {
  computeChanges,
  getClientIp,
  writeRequiredAuditLog,
} from '../../lib/logging/auditLog.js';
import { getUserAgent, normalizeBody, sendApiError } from '../../lib/http/helpers.js';
import {
  isOpenStudentCourseEnrollmentStatus,
  type StudentCourseEnrollmentStatus,
} from '../../../../shared/studentCourseEnrollment.js';
import {
  applyManualEnrollmentUpdate,
  prepareManualEnrollmentUpdate,
  type EnrollmentChange,
} from '../../lib/student/courseEnrollmentRepository.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { queueAccountingFinanceOutbox } from '../../lib/accounting/studentFinanceProjectionRepository.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { readCanonicalStudentReadControlInTransaction } from '../../lib/student/canonicalStudentReadControl.js';
import { buildStudentRelationshipUpdateFields } from '../../lib/student/studentRelationshipProjection.js';
import {
  applyStudentLinkedUsersInTransaction,
  readStudentLinkedUsersInTransaction,
} from '../../lib/student/studentProfileSync.js';

const ENROLLMENT_STATUSES: readonly StudentCourseEnrollmentStatus[] = [
  'trial',
  'active',
  'on_leave',
  'completed',
  'transferred',
  'dropped',
];

function getBodyString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value.trim() : '';
}

function getEndedAt(body: Record<string, unknown>): string | null {
  const value = body.endedAt;
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.trim() : null;
}

function buildCurrentStudentProjection(
  student: Record<string, unknown>,
  change: EnrollmentChange,
  remainingOpenEnrollments: EnrollmentChange['after'][]
): Record<string, unknown> | null {
  const currentEnrollmentId =
    typeof student.currentEnrollmentId === 'string' ? student.currentEnrollmentId : '';
  const openAfter = remainingOpenEnrollments.filter((enrollment) =>
    isOpenStudentCourseEnrollmentStatus(enrollment.status)
  );
  const isCurrentEnrollment =
    currentEnrollmentId === change.before.id ||
    change.openEnrollmentBefore?.id === change.before.id ||
    (openAfter.length === 1 && openAfter[0].id === change.after.id);
  if (!isCurrentEnrollment) return null;

  const nextOpen = remainingOpenEnrollments.find((enrollment) =>
    isOpenStudentCourseEnrollmentStatus(enrollment.status)
  );
  if (nextOpen) {
    return {
      classId: nextOpen.classId,
      enrollmentStatus: nextOpen.status === 'trial' ? 'active' : nextOpen.status,
      studentLifecycle: nextOpen.status === 'trial' ? 'trial' : 'enrolled',
      currentEnrollmentId: nextOpen.id,
      updatedAt: FieldValue.serverTimestamp(),
    };
  }
  return {
    enrollmentStatus: change.after.status === 'dropped' ? 'dropped' : change.after.status,
    classId: FieldValue.delete(),
    currentEnrollmentId: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function handleCourseEnrollment(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'admin' && userInfo.role !== 'office') {
    return res.status(403).json({ success: false, error: 'Not authorized for enrollment correction' });
  }

  try {
    const body = normalizeBody(req.body);
    const enrollmentId = getBodyString(body, 'enrollmentId');
    const status = getBodyString(body, 'status') as StudentCourseEnrollmentStatus;
    const joinedAt = getBodyString(body, 'joinedAt');
    const endedAt = getEndedAt(body);
    const statusReason = getBodyString(body, 'statusReason');
    if (
      !enrollmentId ||
      !ENROLLMENT_STATUSES.includes(status) ||
      !joinedAt ||
      !statusReason
    ) {
      return res.status(400).json({ success: false, error: 'Invalid course enrollment payload' });
    }

    let change!: EnrollmentChange;
    await runStudentIdentityMutationTransaction(
      db,
      { actorId: user.uid, operation: 'students:course-enrollment' },
      async (tx) => {
        const readControl = await readCanonicalStudentReadControlInTransaction(tx, db);
        change = await prepareManualEnrollmentUpdate(tx, db, {
          enrollmentId,
          status,
          joinedAt,
          endedAt,
          statusReason,
          actorId: user.uid,
          now: new Date().toISOString(),
        });

        const studentsCollection = db.collection('students');
        const linkedUsers = change.studentBefore
          ? await readStudentLinkedUsersInTransaction(tx, db, change.after.studentId)
          : [];

        // Every DocumentStore read is complete. Writes start with the authoritative
        // enrollment row, followed by its compatibility projections.
        applyManualEnrollmentUpdate(tx, db, change);
        if (change.studentBefore && typeof studentsCollection?.doc === 'function') {
          const studentRef = studentsCollection.doc(change.after.studentId);
          const student = change.studentBefore;
          const projection = buildCurrentStudentProjection(
            student,
            change,
            change.remainingOpenEnrollments
          );
          const relationshipUpdate = buildStudentRelationshipUpdateFields(
            readControl.mode,
            projection ?? {}
          );
          const profileUpdate = projection
            ? { ...projection, ...relationshipUpdate }
            : relationshipUpdate;
          if (Object.keys(profileUpdate).length > 0) {
            const persistedAfter = { ...student, ...profileUpdate };
            if (readControl.mode === 'canonical_required') {
              delete persistedAfter.classId;
              delete persistedAfter.teacherId;
              delete persistedAfter.enrollmentStatus;
            }
            applyStudentLinkedUsersInTransaction(
              tx,
              change.after.studentId,
              { ...persistedAfter, ...relationshipUpdate },
              linkedUsers
            );
            tx.update(studentRef, profileUpdate);
          }
        }
        const outboxCollection = db.collection('accounting_finance_outbox');
        if (
          typeof (tx as unknown as { create?: unknown }).create === 'function' &&
          typeof outboxCollection?.doc === 'function'
        ) {
          queueAccountingFinanceOutbox(tx, db, {
            eventId: `enrollment-correction-${change.after.id}-${change.after.updatedAt}`.replace(
              /[^A-Za-z0-9_-]/g,
              '_'
            ),
            studentId: change.after.studentId,
            reason: 'enrollment_correction',
            occurredAt: change.after.updatedAt,
          });
        }
      }
    );

    await refreshAccountingStudentSummariesAfterCommit(
      db,
      [change.after.studentId],
      'enrollment-correction',
      { actorId: user.uid, operation: 'students:course-enrollment' }
    );

    await writeRequiredAuditLog(
      db,
      {
        userId: user.uid,
        userRole: userInfo.role,
        userName: userInfo.name,
        action: 'enrollment_correction',
        collection: 'student_course_enrollments',
        documentId: change.after.id,
        changes: computeChanges(
          change.before as unknown as Record<string, unknown>,
          change.after as unknown as Record<string, unknown>
        ),
        metadata: {
          reason: change.after.statusReason,
          source: change.after.source,
          confidence: change.after.confidence,
        },
        ip: getClientIp(req),
        userAgent: getUserAgent(req),
      },
      'student_enrollment'
    );

    await Promise.all([
      touchRealtimeEvent('students'),
      touchRealtimeEvent('accounting-students'),
      touchRealtimeEvent('accounting-student-finance'),
    ]);
    return res.status(200).json({ success: true, enrollment: change.after });
  } catch (err) {
    console.error('[Students/course-enrollment] Error:', err);
    return sendApiError(res, err, 'Failed to update course enrollment');
  }
}
