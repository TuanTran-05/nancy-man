import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore, type Transaction } from '@/server/db/documentStore.js';
import { canReviewTrial } from '../../lib/auth/permissions.js';
import { getClientIp, writeAuditLog } from '../../lib/logging/auditLog.js';
import { normalizeBody, withStatus } from '../../lib/http/helpers.js';
import { trialDecisionSchema, validateBody } from '../../lib/validation/validations.js';
import { appendAdmissionHistory } from '../../lib/admissions/history.js';
import { applyClassStudentCountDeltas } from '../../lib/student/studentCounts.js';
import { shouldInitializeEnrollmentDate } from '../../lib/student/enrollmentDate.js';
import {
  applyStudentLinkedUsersInTransaction,
  readStudentLinkedUsersInTransaction,
} from '../../lib/student/studentProfileSync.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  changedRequiredRosterClassIds,
  invalidateCourseClosingApprovals,
} from '../../classes/helpers/courseClosing.js';
import {
  closeOpenEnrollments,
  preloadStudentEnrollmentsInTransaction,
  transitionSystemEnrollment,
} from '../../lib/student/courseEnrollmentRepository.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import {
  resolveCanonicalStudentIdInTransaction,
} from '../../lib/student/studentIdentityResolver.js';
import { readCanonicalStudentReadControlInTransaction } from '../../lib/student/canonicalStudentReadControl.js';
import { buildStudentRelationshipUpdateFields } from '../../lib/student/studentRelationshipProjection.js';

type AuthenticatedUser = { uid: string; email?: string };
type UserInfo = { role: string; name: string };

async function countTrialAttendanceInTransaction(
  tx: Transaction,
  db: DocumentStore,
  studentId: string,
  classId: string,
  trialStartedAt?: string
): Promise<number> {
  const query = db
    .collection('attendance')
    .where('studentId', '==', studentId)
    .where('classId', '==', classId);
  const snapshot = await tx.get(query);
  const countedDates = new Set<string>();
  const startMs = trialStartedAt ? new Date(trialStartedAt).getTime() : 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const status = String(data.status || '');
    const date = String(data.date || '');
    if (status !== 'present' && status !== 'late') continue;
    if (startMs && new Date(`${date}T23:59:59`).getTime() < startMs) continue;
    if (date) countedDates.add(date);
  }
  return countedDates.size;
}

function snapshotAfterUpdate(
  before: Record<string, unknown>,
  update: Record<string, unknown>,
  removeRelationships: boolean
): Record<string, unknown> {
  const after = { ...before, ...update };
  if (removeRelationships) {
    delete after.classId;
    delete after.teacherId;
    delete after.enrollmentStatus;
  }
  return after;
}

export async function handleTrialDecision(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: AuthenticatedUser,
  userInfo: UserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canReviewTrial(userInfo.role)) {
    throw withStatus('Not authorized to review trial students', 403);
  }
  const body = normalizeBody(req.body);
  const validation = validateBody(trialDecisionSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const { studentId: requestedStudentId, decision, note } = validation.data;

  const transactionResult = await runStudentIdentityMutationTransaction(
    db,
    { actorId: user.uid, operation: 'admissions:trial-decision' },
    async (tx) => {
      const freshResolution = await resolveCanonicalStudentIdInTransaction(
        tx,
        db,
        requestedStudentId
      );
      const studentId = freshResolution.canonicalProfileId;
      const canonicalRef = db.doc(`students/${studentId}`);
      const canonicalSnap = await tx.get(canonicalRef);
      if (!canonicalSnap.exists) throw withStatus('Student not found', 404);
      const freshStudent = (canonicalSnap.data() || {}) as Record<string, unknown>;
      if (freshStudent.studentLifecycle !== 'trial') {
        throw withStatus('Student is not awaiting a trial decision', 409);
      }

      const enrollmentState = await preloadStudentEnrollmentsInTransaction(tx, db, studentId, '');
      const trialEnrollment = enrollmentState.open;
      if (!trialEnrollment || trialEnrollment.status !== 'trial') {
        throw withStatus('Student does not have a canonical trial enrollment', 409);
      }
      const freshClassId = trialEnrollment.classId;
      const classSnap = await tx.get(db.collection('classes').doc(freshClassId));
      if (!classSnap.exists) throw withStatus('Trial class not found', 404);
      const freshAssignedTeacher = String(classSnap.data()?.teacherId || '');
      if (userInfo.role === 'teacher' && freshAssignedTeacher !== user.uid) {
        throw withStatus('Not authorized for this trial student', 403);
      }
      const freshTrialSessionCount = await countTrialAttendanceInTransaction(
        tx,
        db,
        studentId,
        freshClassId,
        typeof freshStudent.trialStartedAt === 'string'
          ? freshStudent.trialStartedAt
          : undefined
      );
      const freshRequiredSessions = Number(freshStudent.trialRequiredSessions || 2);
      if (freshTrialSessionCount < freshRequiredSessions) {
        throw withStatus('Trial student does not have enough attended sessions', 409);
      }

      const now = new Date().toISOString();
      const today = getVietnamTodayStr(new Date(now));
      const control = await readCanonicalStudentReadControlInTransaction(tx, db);
      const linkedUsers = await readStudentLinkedUsersInTransaction(tx, db, studentId);
      const decisionNotePatch = note !== undefined ? { trialDecisionNote: note } : {};
      const relationshipUpdate = buildStudentRelationshipUpdateFields(
        control.mode,
        decision === 'accepted'
          ? { enrollmentStatus: 'active' }
          : {
              classId: FieldValue.delete(),
              teacherId: FieldValue.delete(),
              enrollmentStatus: FieldValue.delete(),
            }
      );
      const baseUpdate =
        decision === 'accepted'
          ? {
              studentLifecycle: 'enrolled',
              currentEnrollmentId: trialEnrollment.id,
              admissionStatus: 'accepted',
              trialReviewStatus: 'accepted',
              trialSessionCount: freshTrialSessionCount,
              ...(shouldInitializeEnrollmentDate(freshStudent)
                ? { enrollmentDate: FieldValue.serverTimestamp() }
                : {}),
              trialDecisionAt: now,
              trialDecisionBy: user.uid,
              ...decisionNotePatch,
              updatedAt: FieldValue.serverTimestamp(),
            }
          : {
              studentLifecycle: 'archived',
              currentEnrollmentId: FieldValue.delete(),
              admissionStatus: 'rejected',
              trialReviewStatus: 'rejected',
              archiveReason: 'trial_rejected',
              isRevoked: true,
              trialDecisionAt: now,
              trialDecisionBy: user.uid,
              ...decisionNotePatch,
              updatedAt: FieldValue.serverTimestamp(),
      };
      const updateData = { ...baseUpdate, ...relationshipUpdate };
      const after = snapshotAfterUpdate(
        freshStudent,
        updateData,
        decision === 'rejected' || control.mode === 'canonical_required'
      );

      if (decision === 'accepted') {
        const transitioned = await transitionSystemEnrollment(
          tx,
          db,
          {
            studentId,
            classId: freshClassId,
            termStart: trialEnrollment.termStart,
            termEnd: trialEnrollment.termEnd,
            status: 'active',
            joinedAt: trialEnrollment.joinedAt,
            actorId: user.uid,
            now,
            expectedStatuses: ['trial'],
            statusReason: 'trial_accepted',
          },
          {
            ...enrollmentState,
            existing: trialEnrollment,
          }
        );
        if (transitioned.status !== 'active') {
          throw withStatus('Canonical trial enrollment did not become active', 409);
        }
      } else {
        await closeOpenEnrollments(
          tx,
          db,
          {
            studentId,
            status: 'dropped',
            endedAt: today,
            reason: note || 'trial_rejected',
            actorId: user.uid,
            now,
          },
          enrollmentState
        );
      }
      applyStudentLinkedUsersInTransaction(
        tx,
        studentId,
        { ...after, ...relationshipUpdate },
        linkedUsers
      );
      const logicalBefore = {
        ...freshStudent,
        classId: freshClassId,
        enrollmentStatus: trialEnrollment.status,
      };
      const logicalAfter =
        decision === 'accepted'
          ? { ...after, classId: freshClassId, enrollmentStatus: 'active' }
          : after;
      applyClassStudentCountDeltas(tx, db, [{ before: logicalBefore, after: logicalAfter }]);
      tx.update(canonicalRef, updateData);
      return {
        studentId,
        student: freshStudent,
        after,
        classId: freshClassId,
        assignedTeacher: freshAssignedTeacher,
        trialSessionCount: freshTrialSessionCount,
      };
    }
  );
  const {
    studentId,
    student: freshStudent,
    after,
    classId: freshClassId,
    assignedTeacher: freshAssignedTeacher,
    trialSessionCount: freshTrialSessionCount,
  } = transactionResult;
  await refreshAccountingStudentSummariesAfterCommit(
    db,
    [studentId],
    `trial-decision-${decision}`,
    { actorId: user.uid, operation: 'admissions:trial-decision' }
  );
  const affectedClassIds = changedRequiredRosterClassIds(
    { ...freshStudent, ...(freshClassId ? { classId: freshClassId } : {}) },
    decision === 'accepted'
      ? { ...after, classId: freshClassId, enrollmentStatus: 'active' }
      : after
  );
  const invalidatedClassIds = await invalidateCourseClosingApprovals(
    db,
    affectedClassIds,
    user.uid,
    'REQUIRED_ROSTER_CHANGED'
  );

  try {
    await appendAdmissionHistory(db, {
      studentId,
      action: decision === 'accepted' ? 'teacher_accepted' : 'teacher_rejected',
      actorId: user.uid,
      actorRole: userInfo.role,
      classId: freshClassId,
      teacherId: freshAssignedTeacher,
      trialSessionCount: freshTrialSessionCount,
      ...(affectedClassIds.length > 0
        ? {
            event: 'course_closing_roster_changed',
            invalidationReason: 'REQUIRED_ROSTER_CHANGED',
            affectedClassIds,
            invalidatedClassIds,
          }
        : {}),
      note,
    });
  } catch (historyErr) {
    console.error('[admissions/trial-decision] Failed to write history:', historyErr);
  }
  await writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'update',
    collection: 'students',
    documentId: studentId,
    metadata: {
      action: 'trial-decision',
      decision,
      trialClassId: freshClassId,
      trialTeacherId: freshAssignedTeacher,
      trialSessionCount: freshTrialSessionCount,
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  await Promise.all([
    touchRealtimeEvent('admissions'),
    touchRealtimeEvent('students'),
    touchRealtimeEvent('admin-summary'),
    ...affectedClassIds.map((affectedClassId) =>
      touchRealtimeEvent('course-closing', { targetId: affectedClassId })
    ),
  ]);

  return res.status(200).json({ success: true, data: { studentId, decision } });
}
