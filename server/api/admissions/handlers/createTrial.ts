import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore, type Transaction } from '@/server/db/documentStore.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { getClientIp, writeAuditLog } from '../../lib/logging/auditLog.js';
import { assertTeacherClassAccess } from '../../lib/services/classService.js';
import { normalizeBody, withStatus } from '../../lib/http/helpers.js';
import { admissionCreateTrialSchema, validateBody } from '../../lib/validation/validations.js';
import {
  assertSelectedArchivedMatch,
  buildAdmissionSearchFields,
  findAdmissionMatches,
  type AdmissionStudentMatch,
} from '../../lib/admissions/matching.js';
import { appendAdmissionHistory } from '../../lib/admissions/history.js';
import { createStudentWithGeneratedCode } from '../../lib/student/studentCreation.js';
import { formatStudentDisplayName } from '../../../../shared/studentRecords.js';
import { applyClassStudentCountDeltas } from '../../lib/student/studentCounts.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  preloadStudentEnrollmentsInTransaction,
  resolveClassCurrentTerm,
  resolveTermJoinedAt,
  transitionSystemEnrollment,
  upsertSystemEnrollment,
} from '../../lib/student/courseEnrollmentRepository.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { isJoinedAtInWindow } from '../../../../shared/classJoinWindow.js';
import { appendCourseJoin } from '../../lib/student/enrollmentWindowWrites.js';
import {
  resolveCanonicalStudentId,
  resolveCanonicalStudentIdInTransaction,
} from '../../lib/student/studentIdentityResolver.js';
import { readCanonicalStudentReadControlInTransaction } from '../../lib/student/canonicalStudentReadControl.js';
import { buildStudentRelationshipUpdateFields } from '../../lib/student/studentRelationshipProjection.js';
import { isArchivedLifecycle, isCurrentLifecycle } from '../../../../shared/studentLifecycle.js';
import {
  applyStudentLinkedUsersInTransaction,
  readStudentLinkedUsersInTransaction,
} from '../../lib/student/studentProfileSync.js';

type AuthenticatedUser = { uid: string; email?: string };
type UserInfo = { role: string; name: string };
type CreateTrialInput = {
  name: string;
  dob: string;
  contact: string;
  grade: number;
  classId: string;
  selectedHistoricalStudentId?: string;
  note?: string;
  joinedAt?: string;
};
type TrialCreateResult = {
  mode: 'created' | 'reactivated';
  studentDocId: string;
  studentCode: string;
  teacherId: string;
};

type CanonicalAdmissionStudentMatch = AdmissionStudentMatch & {
  historicalIds: string[];
};

function resolveSelectedHistoricalMatch(
  matches: {
    archivedExactMatches: CanonicalAdmissionStudentMatch[];
    possibleMatches: CanonicalAdmissionStudentMatch[];
  },
  selectedHistoricalStudentId?: string
) {
  if (!selectedHistoricalStudentId) return null;
  const selected = [...matches.archivedExactMatches, ...matches.possibleMatches].find(
    (match) => match.historicalIds.includes(selectedHistoricalStudentId)
  );
  if (!selected) throw withStatus('Selected historical student is not a candidate match', 409);
  return assertSelectedArchivedMatch(selected) as CanonicalAdmissionStudentMatch;
}

async function resolveCanonicalAdmissionMatches(
  db: DocumentStore,
  matches: Awaited<ReturnType<typeof findAdmissionMatches>>
) {
  const physicalMatches = [...matches.exactMatches, ...matches.possibleMatches];
  const canonicalById = new Map<string, CanonicalAdmissionStudentMatch>();
  for (const physical of physicalMatches) {
    const resolution = await resolveCanonicalStudentId(db, physical.id);
    const canonicalId = resolution.canonicalProfileId;
    const existing = canonicalById.get(canonicalId);
    if (existing) {
      existing.historicalIds.push(physical.id);
      // Exactness belongs to one physical observation. Complementary evidence
      // from two aliases must not be unioned into a match no stored row made.
      if (physical.reasons.length > existing.reasons.length) {
        existing.reasons = [...physical.reasons];
      }
      continue;
    }
    const ref = db.doc(`students/${canonicalId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw withStatus('Selected historical student was not found', 404);
    canonicalById.set(canonicalId, {
      id: canonicalId,
      ref,
      data: (snapshot.data() || {}) as Record<string, unknown>,
      reasons: [...physical.reasons],
      historicalIds: [physical.id],
    });
  }

  const canonicalMatches = [...canonicalById.values()];
  const exactMatches = canonicalMatches.filter((match) => match.reasons.length === 3);
  return {
    currentExactMatches: exactMatches.filter((match) => isCurrentLifecycle(match.data)),
    archivedExactMatches: exactMatches.filter((match) => isArchivedLifecycle(match.data)),
    possibleMatches: canonicalMatches.filter((match) => match.reasons.length === 2),
  };
}

function applyRelationshipProjectionToSnapshot(
  before: Record<string, unknown>,
  update: Record<string, unknown>,
  canonicalRequired: boolean
): Record<string, unknown> {
  const after = { ...before, ...update };
  if (canonicalRequired) {
    delete after.classId;
    delete after.teacherId;
    delete after.enrollmentStatus;
  }
  return after;
}

type TrialJoin = {
  term: { termStart: string; termEnd: string | null } | null;
  joinedAt: string;
  trialStartedAt: string;
  now: string;
};

function resolveTrialJoin(
  classData: Record<string, unknown>,
  input: { classId: string; joinedAt?: string },
  logLabel: string
): TrialJoin {
  const now = new Date().toISOString();
  const today = getVietnamTodayStr(new Date(now));
  let term: { termStart: string; termEnd: string | null } | null = null;
  try {
    term = resolveClassCurrentTerm(classData, today);
  } catch (error) {
    console.warn(`[admissions/${logLabel}] class has no stable course term`, {
      classId: input.classId,
      error,
    });
  }

  if (input.joinedAt && term && !isJoinedAtInWindow(term, input.joinedAt)) {
    throw withStatus(
      `joinedAt must fall between ${term.termStart} and ${term.termEnd || 'the open end of the course'}`,
      400
    );
  }

  const joinedAt = term
    ? input.joinedAt || resolveTermJoinedAt(term, today)
    : today;
  return {
    term,
    joinedAt,
    now,
    trialStartedAt: term && input.joinedAt ? `${input.joinedAt}T00:00:00.000Z` : now,
  };
}

async function readAuthorizedTrialClassInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: { classId: string; joinedAt?: string },
  user: AuthenticatedUser,
  userInfo: UserInfo,
  logLabel: string
) {
  const classSnap = await tx.get(db.collection('classes').doc(input.classId));
  if (!classSnap.exists) throw withStatus('Class not found', 404);
  const classData = (classSnap.data() || {}) as Record<string, unknown>;
  const teacherId = String(classData.teacherId || '');
  if (!canManageAcademicRecords(userInfo.role) && teacherId !== user.uid) {
    throw withStatus('Not authorized for this class', 403);
  }
  return {
    teacherId,
    join: resolveTrialJoin(classData, input, logLabel),
  };
}

function trialCourseJoinPatch(
  before: Record<string, unknown>,
  classId: string,
  join: TrialJoin
): Record<string, unknown> {
  if (!join.term) return {};
  return {
    courseJoins: appendCourseJoin(before, {
      classId,
      termStart: join.term.termStart,
      joinedAt: join.joinedAt,
    }),
  };
}

async function reactivateTrialStudent({
  db,
  user,
  userInfo,
  input,
  selected,
  selectedHistoricalStudentId,
  selectedFromPossibleMatch,
}: {
  db: DocumentStore;
  user: AuthenticatedUser;
  userInfo: UserInfo;
  input: CreateTrialInput;
  selected: CanonicalAdmissionStudentMatch;
  selectedHistoricalStudentId: string;
  selectedFromPossibleMatch: boolean;
}): Promise<TrialCreateResult> {
  const result = await runStudentIdentityMutationTransaction(
    db,
    { actorId: user.uid, operation: 'admissions:create-trial' },
    async (tx): Promise<TrialCreateResult> => {
      const resolution = await resolveCanonicalStudentIdInTransaction(
        tx,
        db,
        selectedHistoricalStudentId
      );
      const studentId = resolution.canonicalProfileId;
      const studentRef = db.doc(`students/${studentId}`);
      const studentSnap = await tx.get(studentRef);
      if (!studentSnap.exists) throw withStatus('Selected historical student was not found', 404);
      const freshStudent = (studentSnap.data() || {}) as Record<string, unknown>;
      if (!isArchivedLifecycle(freshStudent)) {
        throw withStatus('Selected student is no longer archived', 409);
      }
      const { teacherId, join } = await readAuthorizedTrialClassInTransaction(
        tx,
        db,
        input,
        user,
        userInfo,
        'reactivate-trial'
      );
      const { term, trialStartedAt } = join;
      if (!term) {
        throw withStatus('Class has no stable course term start date', 409);
      }
      const control = await readCanonicalStudentReadControlInTransaction(tx, db);
      const linkedUsers = await readStudentLinkedUsersInTransaction(tx, db, studentId);
      const enrollmentId = makeStudentCourseEnrollmentId(studentId, input.classId, term.termStart);
      const enrollmentState = await preloadStudentEnrollmentsInTransaction(
        tx,
        db,
        studentId,
        enrollmentId
      );
      if (enrollmentState.open) {
        throw withStatus('Archived student still has an open course enrollment', 409);
      }
      const previousEnrollment = enrollmentState.all[0] ?? null;

      const baseUpdate = {
        ...buildAdmissionSearchFields(input),
        name: formatStudentDisplayName(input.name),
        dob: input.dob,
        contact: input.contact.trim(),
        grade: input.grade,
        trialClassId: input.classId,
        trialTeacherId: teacherId,
        studentLifecycle: 'trial',
        admissionStatus: 'trial',
        trialReviewStatus: 'pending_sessions',
        trialSessionCount: 0,
        trialRequiredSessions: 2,
        trialStartedAt,
        ...trialCourseJoinPatch(freshStudent, input.classId, join),
        admittedAt: join.now,
        admittedBy: user.uid,
        currentEnrollmentId: enrollmentId,
        isRevoked: false,
        updatedAt: FieldValue.serverTimestamp(),
      };
      const updateData = {
        ...baseUpdate,
        ...buildStudentRelationshipUpdateFields(control.mode, {
          classId: input.classId,
          teacherId,
          enrollmentStatus: 'active',
        }),
      };
      const after = applyRelationshipProjectionToSnapshot(
        freshStudent,
        updateData,
        control.mode === 'canonical_required'
      );

      const targetEnrollment = enrollmentState.existing
        ? await transitionSystemEnrollment(
            tx,
            db,
            {
              studentId,
              classId: input.classId,
              termStart: term.termStart,
              termEnd: term.termEnd,
              status: 'trial',
              joinedAt: join.joinedAt,
              actorId: user.uid,
              now: join.now,
              expectedStatuses: ['completed', 'transferred', 'dropped'],
              statusReason: 'trial_reactivated',
            },
            enrollmentState
          )
        : await upsertSystemEnrollment(
            tx,
            db,
            {
              studentId,
              classId: input.classId,
              termStart: term.termStart,
              termEnd: term.termEnd,
              status: 'trial',
              joinedAt: join.joinedAt,
              actorId: user.uid,
              now: join.now,
            },
            enrollmentState
          );
      if (targetEnrollment.id !== enrollmentId || targetEnrollment.status !== 'trial') {
        throw withStatus('Canonical course enrollment did not become trial', 409);
      }
      const logicalBefore = previousEnrollment
        ? {
            ...freshStudent,
            classId: previousEnrollment.classId,
            enrollmentStatus: previousEnrollment.status,
          }
        : freshStudent;
      const logicalAfter = {
        ...after,
        classId: input.classId,
        enrollmentStatus: targetEnrollment.status,
      };
      applyClassStudentCountDeltas(tx, db, [{ before: logicalBefore, after: logicalAfter }]);
      applyStudentLinkedUsersInTransaction(tx, studentId, { ...after, ...updateData }, linkedUsers);
      tx.update(studentRef, updateData);
      return {
        mode: 'reactivated',
        studentDocId: studentId,
        studentCode: String(freshStudent.studentId || ''),
        teacherId,
      };
    }
  );
  if (selectedFromPossibleMatch) {
    try {
      await appendAdmissionHistory(db, {
        studentId: result.studentDocId,
        action: 'possible_match_selected',
        actorId: user.uid,
        actorRole: userInfo.role,
        classId: input.classId,
        teacherId: result.teacherId,
        metadata: { reasons: selected.reasons },
      });
    } catch (historyErr) {
      console.error(
        '[admissions/create-trial] Failed to write possible_match_selected history:',
        historyErr
      );
    }
  }
  try {
    await appendAdmissionHistory(db, {
      studentId: result.studentDocId,
      action: 'reactivated_trial',
      actorId: user.uid,
      actorRole: userInfo.role,
      classId: input.classId,
      teacherId: result.teacherId,
      note: input.note,
    });
  } catch (historyErr) {
    console.error(
      '[admissions/create-trial] Failed to write reactivated_trial history:',
      historyErr
    );
  }
  return result;
}

async function createTrialStudent({
  db,
  user,
  userInfo,
  input,
  classData,
}: {
  db: DocumentStore;
  user: AuthenticatedUser;
  userInfo: UserInfo;
  input: CreateTrialInput;
  classData: Record<string, unknown>;
}): Promise<TrialCreateResult> {
  const teacherId = String(classData.teacherId || '');
  const join = resolveTrialJoin(classData, input, 'create-trial');
  const { term, trialStartedAt, joinedAt } = join;
  const created = await createStudentWithGeneratedCode(db, (studentCode) => ({
    ...buildAdmissionSearchFields(input),
    name: formatStudentDisplayName(input.name),
    dob: input.dob,
    contact: input.contact.trim(),
    grade: input.grade,
    classId: input.classId,
    teacherId,
    trialClassId: input.classId,
    trialTeacherId: teacherId,
    studentId: studentCode,
    studentLifecycle: 'trial',
    admissionStatus: 'trial',
    trialReviewStatus: 'pending_sessions',
    ...trialCourseJoinPatch({}, input.classId, join),
    trialSessionCount: 0,
    trialRequiredSessions: 2,
    trialStartedAt,
    admittedAt: join.now,
    admittedBy: user.uid,
    enrollmentStatus: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }), (studentDocId, _data, now) =>
    term
      ? {
          studentId: studentDocId,
          classId: input.classId,
          termStart: term.termStart,
          termEnd: term.termEnd,
          status: 'trial',
          joinedAt,
          actorId: user.uid,
          now,
        }
      : null,
    {
      actorId: user.uid,
      actorRole: userInfo.role,
      mutationOperation: 'trial_create',
    }
  );
  try {
    await appendAdmissionHistory(db, {
      studentId: created.ref.id,
      action: 'created_trial',
      actorId: user.uid,
      actorRole: userInfo.role,
      classId: input.classId,
      teacherId,
      note: input.note,
    });
  } catch (historyErr) {
    console.error('[admissions/create-trial] Failed to write created_trial history:', historyErr);
  }
  return {
    mode: 'created' as const,
    studentDocId: created.ref.id,
    studentCode: created.studentId,
    teacherId,
  };
}

async function promotePendingToTrial({
  db,
  user,
  userInfo,
  input,
  pendingStudentId,
}: {
  db: DocumentStore;
  user: AuthenticatedUser;
  userInfo: UserInfo;
  input: any;
  pendingStudentId: string;
}): Promise<TrialCreateResult> {
  const result = await runStudentIdentityMutationTransaction(
    db,
    { actorId: user.uid, operation: 'admissions:create-trial' },
    async (tx): Promise<TrialCreateResult> => {
      const resolution = await resolveCanonicalStudentIdInTransaction(tx, db, pendingStudentId);
      const studentId = resolution.canonicalProfileId;
      const studentRef = db.doc(`students/${studentId}`);
      const studentSnap = await tx.get(studentRef);
      if (!studentSnap.exists) throw withStatus('Pending student not found', 404);
      const freshStudent = (studentSnap.data() || {}) as Record<string, any>;
      if (freshStudent.studentLifecycle !== 'pending') {
        throw withStatus('Student is no longer in pending state', 409);
      }
      const { teacherId, join } = await readAuthorizedTrialClassInTransaction(
        tx,
        db,
        input,
        user,
        userInfo,
        'promote-pending-trial'
      );
      const trialStartedAt = join.trialStartedAt;
      const updatedFields = {
        name: formatStudentDisplayName(input.name || freshStudent.name),
        dob: input.dob || String(freshStudent.dob || ''),
        contact: input.contact?.trim() || String(freshStudent.contact || ''),
        grade: input.grade !== undefined ? input.grade : Number(freshStudent.grade || 0),
      };
      if (!updatedFields.name) throw withStatus('Student name is required', 400);
      if (!updatedFields.dob) throw withStatus('Date of birth is required', 400);
      if (!updatedFields.contact) throw withStatus('Contact is required', 400);

      const control = await readCanonicalStudentReadControlInTransaction(tx, db);
      const linkedUsers = await readStudentLinkedUsersInTransaction(tx, db, studentId);
      const baseUpdate = {
        ...buildAdmissionSearchFields(updatedFields),
        ...updatedFields,
        trialClassId: input.classId,
        trialTeacherId: teacherId,
        studentLifecycle: 'trial',
        admissionStatus: 'trial',
        trialReviewStatus: 'pending_sessions',
        trialSessionCount: 0,
        trialRequiredSessions: 2,
        trialStartedAt,
        ...trialCourseJoinPatch(freshStudent, input.classId, join),
        admittedAt: join.now,
        admittedBy: user.uid,
        note: FieldValue.delete(),
        isRevoked: false,
        updatedAt: FieldValue.serverTimestamp(),
      };
      const updateData = {
        ...baseUpdate,
        ...buildStudentRelationshipUpdateFields(control.mode, {
          classId: input.classId,
          teacherId,
          enrollmentStatus: 'active',
        }),
      };
      const after = applyRelationshipProjectionToSnapshot(
        freshStudent,
        updateData,
        control.mode === 'canonical_required'
      );

      if (join.term) {
        await upsertSystemEnrollment(tx, db, {
          studentId,
          classId: input.classId,
          termStart: join.term.termStart,
          termEnd: join.term.termEnd,
          status: 'trial',
          joinedAt: join.joinedAt,
          actorId: user.uid,
          now: join.now,
        });
      }
      const logicalAfter = {
        ...after,
        classId: input.classId,
        enrollmentStatus: 'active',
      };
      applyClassStudentCountDeltas(tx, db, [{ before: freshStudent, after: logicalAfter }]);
      applyStudentLinkedUsersInTransaction(tx, studentId, { ...after, ...updateData }, linkedUsers);
      tx.update(studentRef, updateData);
      return {
        mode: 'created',
        studentDocId: studentId,
        studentCode: String(freshStudent.studentId || ''),
        teacherId,
      };
    }
  );

  try {
    await appendAdmissionHistory(db, {
      studentId: result.studentDocId,
      action: 'created_trial',
      actorId: user.uid,
      actorRole: userInfo.role,
      classId: input.classId,
      teacherId: result.teacherId,
      note: input.note,
    });
  } catch (historyErr) {
    console.error(
      '[admissions/create-trial] Failed to promote pending student history:',
      historyErr
    );
  }

  return result;
}

export async function handleCreateTrial(
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
    throw withStatus('Not authorized to create trial admissions', 403);
  }
  const body = normalizeBody(req.body);
  const validation = validateBody(admissionCreateTrialSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const input = validation.data;

  if (input.pendingStudentId) {
    const preliminaryResolution = await resolveCanonicalStudentId(db, input.pendingStudentId);
    const studentRef = db.doc(`students/${preliminaryResolution.canonicalProfileId}`);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) {
      throw withStatus('Pending student not found', 404);
    }
    const pendingData = studentSnap.data() || {};
    if (pendingData.studentLifecycle !== 'pending') {
      throw withStatus('Student is not in pending state', 409);
    }

    const updatedFields = {
      name: formatStudentDisplayName(input.name || pendingData.name),
      dob: input.dob || String(pendingData.dob || ''),
      contact: input.contact?.trim() || String(pendingData.contact || ''),
      grade: input.grade !== undefined ? input.grade : Number(pendingData.grade || 0),
    };

    if (!updatedFields.name) throw withStatus('Student name is required', 400);
    if (!updatedFields.dob) throw withStatus('Date of birth is required', 400);
    if (!updatedFields.contact) throw withStatus('Contact is required', 400);

    await assertTeacherClassAccess(db, input.classId, user.uid, userInfo.role);

    const result = await promotePendingToTrial({
      db,
      user,
      userInfo,
      input,
      pendingStudentId: input.pendingStudentId,
    });
    await refreshAccountingStudentSummariesAfterCommit(
      db,
      [result.studentDocId],
      'trial-created-from-pending',
      { actorId: user.uid, operation: 'admissions:create-trial' }
    );

    await writeAuditLog(db, {
      userId: user.uid,
      userRole: userInfo.role,
      userName: userInfo.name,
      action: 'update',
      collection: 'students',
      documentId: result.studentDocId,
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
      metadata: {
        action: 'create-trial',
        admissionMode: 'promoted_pending',
        pendingStudentId: input.pendingStudentId,
        trialClassId: input.classId,
        trialTeacherId: result.teacherId,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        mode: result.mode,
        studentId: result.studentDocId,
        studentCode: result.studentCode,
        trialReviewStatus: 'pending_sessions',
      },
    });
  }

  const classData = await assertTeacherClassAccess(db, input.classId, user.uid, userInfo.role);
  const physicalMatches = await findAdmissionMatches(db, input as any);
  const matches = await resolveCanonicalAdmissionMatches(db, physicalMatches);
  if (matches.currentExactMatches.length > 0) {
    throw withStatus('Student already has a current enrollment', 409);
  }
  if (matches.archivedExactMatches.length > 1) {
    throw withStatus('Multiple historical matches require cleanup before admission', 409);
  }

  const selected =
    resolveSelectedHistoricalMatch(matches, input.selectedHistoricalStudentId) ||
    (matches.archivedExactMatches.length === 1 ? matches.archivedExactMatches[0] : null);

  const result = selected
    ? await reactivateTrialStudent({
        db,
        user,
        userInfo,
        input: input as any,
        selected,
        selectedHistoricalStudentId:
          input.selectedHistoricalStudentId || selected.historicalIds[0],
        selectedFromPossibleMatch:
          Boolean(input.selectedHistoricalStudentId) && selected.reasons.length === 2,
      })
    : await createTrialStudent({ db, user, userInfo, input: input as any, classData });

  await refreshAccountingStudentSummariesAfterCommit(db, [result.studentDocId], 'trial-created', {
    actorId: user.uid,
    operation: 'admissions:create-trial',
  });

  await writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'create',
    collection: 'students',
    documentId: result.studentDocId,
    metadata: {
      action: 'create-trial',
      admissionMode: result.mode,
      ...(result.mode === 'reactivated' ? { matchedStudentId: result.studentDocId } : {}),
      ...(input.selectedHistoricalStudentId
        ? { selectedHistoricalStudentId: input.selectedHistoricalStudentId }
        : {}),
      trialClassId: input.classId,
      trialTeacherId: result.teacherId,
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  await Promise.all([
    touchRealtimeEvent('admissions'),
    touchRealtimeEvent('students'),
    touchRealtimeEvent('admin-summary'),
  ]);

  return res.status(result.mode === 'created' ? 201 : 200).json({
    success: true,
    data: {
      mode: result.mode,
      studentId: result.studentDocId,
      studentCode: result.studentCode,
      trialReviewStatus: 'pending_sessions',
    },
  });
}
