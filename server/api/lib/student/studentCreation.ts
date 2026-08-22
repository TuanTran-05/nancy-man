import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentReference, type DocumentStore } from '@/server/db/documentStore.js';
import { getClientIp, writeAuditLog, writeAuditLogInTransaction } from '../logging/auditLog.js';
import {
  extractPrefixSuffixSequence,
  getNextCounterSequence,
  readNextCounterSequenceInTransaction,
  writeCounterSequenceReservation,
} from '../documentStore/counterSequence.js';
import { runStudentIdentityMutationTransaction } from '../maintenance/studentIdentityMutationTransaction.js';
import {
  assertStudentCreationAllowedInTransaction,
  type StudentCreationCaller,
  type StudentCreationOverride,
} from './studentCreationGuard.js';
import {
  claimStudentCodeInTransaction,
  normalizeStudentCode,
  readStudentCodeClaimInTransaction,
} from './studentCodeRegistry.js';
import { getOptionalString, getString, getUserAgent } from '../http/helpers.js';
import { assertTeacherClassAccess } from '../services/classService.js';
import { isValidVNPhone, normalizePhoneVN } from '../../../../shared/phone.js';
import { deriveStudentLifecycle } from '../../../../shared/studentLifecycle.js';
import { formatStudentDisplayName } from '../../../../shared/studentRecords.js';
import { applyClassStudentCountDeltas } from './studentCounts.js';
import { touchRealtimeEvent } from '../realtime/events.js';
import {
  changedRequiredRosterClassIds,
  invalidateCourseClosingApprovals,
} from '../../classes/helpers/courseClosing.js';
import {
  resolveClassCurrentTerm,
  resolveTermJoinedAt,
  upsertSystemEnrollment,
  type PreloadedStudentEnrollments,
  type SystemEnrollmentInput,
} from './courseEnrollmentRepository.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { isJoinedAtInWindow } from '../../../../shared/classJoinWindow.js';
import { appendCourseJoin } from './enrollmentWindowWrites.js';
import { readCanonicalStudentReadControlInTransaction } from './canonicalStudentReadControl.js';
import { buildStudentRelationshipCreateFields } from './studentRelationshipProjection.js';

export interface StudentMutationUser {
  uid: string;
  email?: string;
}

export interface StudentMutationUserInfo {
  role: string;
  name: string;
}

export interface CreatedStudentResult {
  id: string;
  studentId: string;
  name: string;
}

export interface CreatedGeneratedStudentDocument {
  ref: DocumentReference;
  studentId: string;
  /** Exact profile document persisted under the active projection policy. */
  data: Record<string, unknown>;
  /** Canonical relationship view used only for counters and roster semantics. */
  semanticData: Record<string, unknown>;
}

export type StudentEnrollmentFactory = (
  studentDocId: string,
  data: Record<string, unknown>,
  now: string
) => SystemEnrollmentInput | null;

export function validateContact(contact: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trimmed = contact.trim();
  return emailRegex.test(trimmed) || isValidVNPhone(trimmed);
}

/**
 * @deprecated Read-only compatibility check.
 *
 * A query followed by a write is two operations with a gap, and two concurrent
 * requests can both find a code free and both take it — which is how fifty-nine
 * production codes came to be owned twice. Ownership is now decided by
 * `student_code_registry/{normalizedCode}`, whose document ID makes the race
 * impossible. This remains only for callers that have not yet moved.
 */
export async function ensureUniqueStudentCode(
  db: DocumentStore,
  studentId: string,
  currentDocId?: string
): Promise<void> {
  const duplicateSnap = await db.collection('students').where('studentId', '==', studentId).get();
  const isDuplicate = duplicateSnap.docs.some((docSnap) => docSnap.id !== currentDocId);
  if (isDuplicate) {
    const err = new Error('Duplicate student ID');
    (err as Error & { statusCode?: number }).statusCode = 409;
    throw err;
  }
}

export async function getNextStudentCode(db: DocumentStore): Promise<string> {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const prefix = `HS${year}`;
  const seq = await getNextCounterSequence(db, {
    counterId: `students_${year}`,
    collectionName: 'students',
    numberField: 'studentId',
    prefix,
    extractSequence: extractPrefixSuffixSequence,
  });
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function buildStudentPayload(
  body: Record<string, unknown>,
  studentId: string,
  teacherId: string
) {
  const name = formatStudentDisplayName(getString(body, 'name'));
  const dob = getString(body, 'dob');
  const contact = getString(body, 'contact');
  const classId = getString(body, 'classId');

  if (!name || !dob || !contact || !classId) throw new Error('Missing required fields');
  if (!validateContact(contact)) {
    throw new Error('Invalid contact. Phone numbers must start with 0, 84, or +84.');
  }
  const admissionSearchName = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const payload: Record<string, unknown> = {
    name,
    studentId,
    dob,
    contact,
    classId,
    teacherId,
    faceImage: getOptionalString(body, 'faceImage') || '',
    faceImageStoragePath: getOptionalString(body, 'faceImageStoragePath') || '',
    code: getOptionalString(body, 'code') || '',
    admissionSearchName,
    admissionSearchDob: dob,
    admissionSearchContact: normalizePhoneVN(contact).replace(/\s+/g, '').toLowerCase(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const gender = getOptionalString(body, 'gender');
  if (gender) {
    if (!['male', 'female', 'other'].includes(gender)) throw new Error('Invalid gender');
    payload.gender = gender;
  }

  const grade = body.grade;
  if (grade !== undefined && grade !== null && grade !== '') {
    const gradeNumber = Number(grade);
    if (!Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 12) {
      throw new Error('Invalid grade');
    }
    payload.grade = gradeNumber;
  }

  return payload;
}

export type StudentCreationMutationOperation =
  | 'student_create'
  | 'student_import'
  | 'trial_create'
  | 'waitlist_create';

export type CreateGeneratedStudentOptions = {
  actorId: string;
  actorRole: string;
  mutationOperation: StudentCreationMutationOperation;
  distinctPersonOverride?: StudentCreationOverride;
};

const STUDENT_CREATION_MAINTENANCE_OPERATION: Record<
  StudentCreationMutationOperation,
  string
> = {
  student_create: 'students:create',
  student_import: 'students:import',
  trial_create: 'admissions:create-trial',
  waitlist_create: 'admissions:add-to-waitlist',
};

/**
 * The role the duplicate guard judges the caller by.
 *
 * It is derived from the operation, not from the signed-in role, so that bulk
 * import and admissions automation are structurally incapable of carrying an
 * admin override no matter who triggered them. Those are the two paths that
 * produce duplicates by the hundred; an override reachable from either would
 * make the guard advisory.
 */
function toCreationCaller(options: CreateGeneratedStudentOptions): StudentCreationCaller {
  if (options.mutationOperation === 'student_import') {
    return { actorId: options.actorId, role: 'import', override: options.distinctPersonOverride };
  }
  if (
    options.mutationOperation === 'trial_create' ||
    options.mutationOperation === 'waitlist_create'
  ) {
    return {
      actorId: options.actorId,
      role: 'admissions',
      override: options.distinctPersonOverride,
    };
  }
  const role =
    options.actorRole === 'admin'
      ? 'admin'
      : options.actorRole === 'teacher'
        ? 'teacher'
        : 'office';
  return { actorId: options.actorId, role, override: options.distinctPersonOverride };
}

export async function createStudentWithGeneratedCode(
  db: DocumentStore,
  buildData: (studentId: string) => Record<string, unknown>,
  buildEnrollment: StudentEnrollmentFactory | undefined,
  options: CreateGeneratedStudentOptions
): Promise<CreatedGeneratedStudentDocument> {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const prefix = `HS${year}`;
  const studentRef = db.collection('students').doc();
  let created: CreatedGeneratedStudentDocument | null = null;

  // A dry run of buildData, so the identity of the human being created is known
  // before a code is generated for them.
  const tempData = buildData('');
  const classId = tempData.classId;
  const name = tempData.name;
  const dob = tempData.dob;
  const contact = tempData.contact;
  const caller = toCreationCaller(options);

  await runStudentIdentityMutationTransaction(
    db,
    {
      actorId: options.actorId,
      operation: STUDENT_CREATION_MAINTENANCE_OPERATION[options.mutationOperation],
    },
    async (tx) => {
    // Everything that can refuse this creation is read first. A refusal decided
    // after a write is staged would be judging data this transaction never
    // serialized against, which is how two concurrent enrolments of the same
    // child can both conclude there is no conflict.

    // 1. Counter and legacy maximum, without staging the counter write.
    const reservation = await readNextCounterSequenceInTransaction(tx, db, {
      counterId: `students_${year}`,
      collectionName: 'students',
      numberField: 'studentId',
      prefix,
      extractSequence: extractPrefixSuffixSequence,
    });
    const studentId = `${prefix}${String(reservation.nextSeq).padStart(4, '0')}`;

    const readControl = await readCanonicalStudentReadControlInTransaction(tx, db);

    // 2. Identity: does this human already have a profile anywhere in the center?
    let overrideAudit = null as Awaited<
      ReturnType<typeof assertStudentCreationAllowedInTransaction>
    >;
    if (name && dob && contact) {
      overrideAudit = await assertStudentCreationAllowedInTransaction(
        tx,
        db,
        { name: String(name), dob: String(dob), contact: String(contact) },
        caller
      );
    }

    // The narrower legacy check stays: it catches a same-class namesake whose
    // contact differs, which the exact-human guard deliberately leaves alone.
    if (classId && name && dob) {
      const dupSnap = await tx.get(
        db
          .collection('students')
          .where('classId', '==', classId)
          .where('name', '==', name)
          .where('dob', '==', dob)
          .where('enrollmentStatus', 'in', ['active', 'on_leave', 'dropped'])
          .limit(5)
      );
      // A validated override is a human decision about specific profiles, so it
      // clears this check for exactly those profiles and no others. Skipping the
      // check wholesale would let an override for one namesake wave through an
      // unrelated second one; ignoring the override would make the two gates
      // contradict each other and leave the admin no way through.
      const reviewed = new Set(overrideAudit?.candidateProfileIds ?? []);
      const unreviewed = dupSnap.docs.filter((doc) => !reviewed.has(doc.id));
      if (unreviewed.length > 0) {
        const err = new Error(
          `Student "${name}" (${dob}) already exists in this class. Restore the existing record instead of creating a duplicate.`
        );
        (err as Error & { statusCode?: number }).statusCode = 409;
        throw err;
      }
    }

    // 3. Code ownership, registry and legacy owner together.
    const normalizedCode = normalizeStudentCode(studentId);
    const claim = await readStudentCodeClaimInTransaction(tx, db, {
      normalizedCode,
      canonicalProfileId: studentRef.id,
    });

    const candidateData = buildData(studentId);
    const {
      classId: _classId,
      teacherId: _teacherId,
      enrollmentStatus: _enrollmentStatus,
      ...baseData
    } = candidateData;
    const data = {
      ...baseData,
      ...buildStudentRelationshipCreateFields(readControl.mode, candidateData),
    };
    const enrollmentInput = buildEnrollment?.(studentRef.id, data, new Date().toISOString());

    // Writes from here down. Nothing below reads.
    //
    // The registry claim leads, because it is the one step that both validates
    // and writes: it decides a conflict from the preloaded record. Running it
    // after the counter would leave a staged write behind a refusal, which is
    // the ordering this whole function exists to remove — even though DocumentStore
    // would discard it on abort, the invariant is worth keeping literally true.
    claimStudentCodeInTransaction(
      tx,
      db,
      {
        normalizedCode,
        canonicalProfileId: studentRef.id,
        actorId: options.actorId,
        isPrimary: true,
        status: 'active',
      },
      claim
    );
    writeCounterSequenceReservation(tx, reservation);
    let semanticData = data;
    if (enrollmentInput) {
      // A brand-new profile document has no enrollments, so the preload is
      // empty by construction rather than by an unread assumption.
      const emptyPreloaded: PreloadedStudentEnrollments = { existing: null, all: [] };
      const enrollment = await upsertSystemEnrollment(tx, db, enrollmentInput, emptyPreloaded);
      semanticData = {
        ...data,
        classId: enrollment.classId,
        enrollmentStatus: enrollment.status,
      };
    }

    tx.create(studentRef, data);
    applyClassStudentCountDeltas(tx, db, [{ after: semanticData }]);
    if (overrideAudit) {
      writeAuditLogInTransaction(tx, db, {
        userId: overrideAudit.actorId,
        userRole: caller.role,
        action: 'create',
        collection: 'students',
        documentId: studentRef.id,
        metadata: {
          ...overrideAudit,
          event: 'student_identity_override',
          studentCode: studentId,
        },
      });
    }
    created = { ref: studentRef, studentId, data, semanticData };
  });

  if (!created) throw new Error('Student creation transaction did not complete');
  return created;
}

export async function writeStudentAudit(
  req: ApiRequest,
  db: DocumentStore,
  user: StudentMutationUser,
  userInfo: StudentMutationUserInfo,
  action: 'create' | 'update' | 'delete' | 'status_change' | 'import',
  documentId: string,
  changes?: Record<string, { before: unknown; after: unknown }>,
  metadata?: Record<string, unknown>
) {
  await writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action,
    collection: 'students',
    documentId,
    changes,
    metadata,
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
  });
}

export async function createStudentRecord({
  req,
  db,
  user,
  userInfo,
  body,
  classData,
  mutationOperation = 'student_create',
  distinctPersonOverride,
}: {
  req: ApiRequest;
  db: DocumentStore;
  user: StudentMutationUser;
  userInfo: StudentMutationUserInfo;
  body: Record<string, unknown>;
  classData?: Record<string, unknown>;
  mutationOperation?: StudentCreationMutationOperation;
  distinctPersonOverride?: StudentCreationOverride;
}): Promise<CreatedStudentResult> {
  const resolvedClassData =
    classData ||
    (await assertTeacherClassAccess(db, getString(body, 'classId'), user.uid, userInfo.role));
  const baseStudentData = buildStudentPayload(
    body,
    '',
    String(resolvedClassData.teacherId || user.uid)
  );

  const today = getVietnamTodayStr();
  let term: { termStart: string; termEnd: string | null } | null = null;
  try {
    term = resolveClassCurrentTerm(resolvedClassData, today);
  } catch (error) {
    // Legacy classes may predate course date fields. Keep the student creation
    // compatible and let the enrollment backfill manifest surface the gap.
    console.warn('[createStudentRecord] class has no stable course term', {
      classId: getString(body, 'classId'),
      error,
    });
  }
  const requestedJoinedAt = getOptionalString(body, 'joinedAt');
  if (requestedJoinedAt && term && !isJoinedAtInWindow(term, requestedJoinedAt)) {
    const error = new Error(
      `joinedAt must fall between ${term.termStart} and ${term.termEnd || 'the open end of the course'}`
    ) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  const joinedAt = term
    ? requestedJoinedAt || resolveTermJoinedAt(term, today)
    : today;

  const created = await createStudentWithGeneratedCode(db, (studentId) => ({
    ...baseStudentData,
    studentId,
    studentLifecycle: deriveStudentLifecycle({ studentLifecycle: 'enrolled' }),
    enrollmentStatus: 'active',
    enrollmentDate: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    ...(term
      ? {
          courseJoins: appendCourseJoin(
            {},
            { classId: getString(body, 'classId'), termStart: term.termStart, joinedAt }
          ),
        }
      : {}),
  }), (studentDocId, _data, now) =>
    term
      ? {
          studentId: studentDocId,
          classId: getString(body, 'classId'),
          termStart: term.termStart,
          termEnd: term.termEnd,
          status: 'active',
          joinedAt,
          actorId: user.uid,
          now,
        }
      : null,
    {
      actorId: user.uid,
      actorRole: userInfo.role,
      mutationOperation,
      distinctPersonOverride,
    }
  );
  const affectedClassIds = changedRequiredRosterClassIds(undefined, created.semanticData);
  const invalidatedClassIds = await invalidateCourseClosingApprovals(
    db,
    affectedClassIds,
    user.uid,
    'REQUIRED_ROSTER_CHANGED'
  );
  await writeStudentAudit(req, db, user, userInfo, 'create', created.ref.id, undefined, {
    studentName: created.data['name'],
    studentCode: created.studentId,
    event: 'course_closing_roster_changed',
    invalidationReason: 'REQUIRED_ROSTER_CHANGED',
    affectedClassIds,
    invalidatedClassIds,
  });
  await Promise.all(
    affectedClassIds.map((classId) => touchRealtimeEvent('course-closing', { targetId: classId }))
  );

  return { id: created.ref.id, studentId: created.studentId, name: String(created.data['name']) };
}
