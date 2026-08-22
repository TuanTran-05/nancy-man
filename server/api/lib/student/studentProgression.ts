import { FieldValue, type DocumentStore, type Transaction } from '@/server/db/documentStore.js';
import {
  buildCourseLedgerId,
  courseLedgerTupleKey,
  findExistingCourseLedger,
} from '../accounting/courseLedgerIdentity.js';
import { runStudentIdentityMutationTransaction } from '../maintenance/studentIdentityMutationTransaction.js';
import { readCanonicalStudentReadControlInTransaction } from './canonicalStudentReadControl.js';
import {
  preloadStudentEnrollmentsInTransaction,
  upsertSystemEnrollment,
} from './courseEnrollmentRepository.js';
import { resolveCanonicalStudentIdInTransaction } from './studentIdentityResolver.js';
import {
  applyStudentLinkedUsersInTransaction,
  readStudentLinkedUsersInTransaction,
} from './studentProfileSync.js';
import { applyClassStudentCountDeltas } from './studentCounts.js';
import { appendCourseJoin } from './enrollmentWindowWrites.js';
import { buildStudentRelationshipUpdateFields } from './studentRelationshipProjection.js';
import {
  isOpenStudentCourseEnrollmentStatus,
  makeStudentCourseEnrollmentId,
  type StudentCourseEnrollment,
} from '../../../../shared/studentCourseEnrollment.js';

/**
 * Moving a student from one class to the next, on the same profile document.
 *
 * This replaces the clone. The old promotion path created a fresh
 * `students/{autoId}`, copied the fields across, and repointed the linked user
 * documents at the copy — which is why fifty-nine business codes are owned by
 * two documents in production and a student's money is split between them.
 *
 * Three properties make that impossible here:
 *
 * - The profile document is only ever updated, never created or deleted. The
 *   canonical id is resolved through the transaction first, so a request naming
 *   a retired id acts on the surviving profile rather than reviving the corpse.
 * - Class membership is carried by `student_course_enrollments`. The profile's
 *   `classId`/`teacherId`/`enrollmentStatus` are projections written alongside
 *   it; they are what the UI still reads and what Workstream B will retire.
 * - The whole transition is keyed by a deterministic idempotency key. A repeat
 *   returns the original outcome instead of opening a second target enrollment,
 *   which matters because class promotion is a bulk operation that gets retried.
 */

export const STUDENT_PROGRESSION_EVENTS_COLLECTION = 'student_progression_events';

export type StudentProgressionKind = 'course_completion' | 'class_transfer';
export type StudentProgressionMutationOperation =
  | 'students:transfer'
  | 'classes:import-students'
  | 'classes:create';

export type ProgressStudentToClassInput = {
  profileId: string;
  sourceClassId: string;
  targetClassId: string;
  targetTermStart: string;
  requestedJoinedAt: string;
  kind: StudentProgressionKind;
  actorId: string;
  mutationOperation: StudentProgressionMutationOperation;
  now: string;
  /**
   * The grade the target class teaches. Carried here rather than written by the
   * caller afterwards so it lands in the same transaction as the class change —
   * a follow-up write would leave the profile claiming the new class at the old
   * grade whenever it failed.
   */
  targetGrade?: number | null;
};

export type ProgressStudentToClassResult = {
  profileId: string;
  sourceEnrollmentId: string;
  targetEnrollmentId: string;
  targetLedgerId: string;
  sourceStatusBefore: 'trial' | 'active' | 'on_leave' | 'completed';
  sourceStatusAfter: 'completed' | 'transferred';
  rolloverBalance: number;
  targetLedgerCreated: boolean;
  affectedClassIds: string[];
  idempotencyKey: string;
  replayed: boolean;
};

function progressionError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function makeStudentProgressionIdempotencyKey(
  input: Pick<
    ProgressStudentToClassInput,
    'profileId' | 'sourceClassId' | 'targetClassId' | 'targetTermStart'
  >
): string {
  const parts = [
    input.sourceClassId,
    input.targetClassId,
    input.profileId,
    input.targetTermStart,
  ];
  if (parts.some((part) => part.includes('/'))) {
    // The key is a document id. A slash would turn it into a subcollection path
    // and silently split one transition across two documents.
    throw progressionError('STUDENT_PROGRESSION_KEY_INVALID: identifiers may not contain "/"', 400);
  }
  return `promotion:${parts.join(':')}`;
}

/**
 * Which source enrollment this transition is allowed to act on.
 *
 * The rules differ by kind but share one requirement: the student may not have
 * an open enrollment anywhere other than the source. Progression that ignored
 * that would leave the other course open forever, since nothing closes it.
 */
function selectSourceEnrollment(
  input: ProgressStudentToClassInput,
  all: StudentCourseEnrollment[],
  open: StudentCourseEnrollment | null
): { source: StudentCourseEnrollment; closeAs: 'completed' | 'transferred' | null } {
  if (open) {
    if (open.classId !== input.sourceClassId) {
      throw progressionError(
        `STUDENT_PROGRESSION_SOURCE_INELIGIBLE: the open enrollment belongs to ${open.classId}, not ${input.sourceClassId}`,
        409
      );
    }
    return { source: open, closeAs: input.kind === 'class_transfer' ? 'transferred' : 'completed' };
  }

  if (input.kind === 'class_transfer') {
    throw progressionError(
      'STUDENT_PROGRESSION_SOURCE_INELIGIBLE: a transfer needs an open source enrollment',
      409
    );
  }

  // Course completion after the class has already closed. The source must be
  // the student's latest record: anything later means they moved on afterwards,
  // and opening the target from here would rewind their history.
  const latest = [...all].sort((a, b) =>
    a.termStart === b.termStart ? a.id.localeCompare(b.id) : a.termStart < b.termStart ? -1 : 1
  ).at(-1);
  if (!latest || latest.classId !== input.sourceClassId || latest.status !== 'completed') {
    throw progressionError(
      'STUDENT_PROGRESSION_SOURCE_INELIGIBLE: no completed source enrollment is the latest record',
      409
    );
  }
  return { source: latest, closeAs: null };
}

function readStoredResult(
  event: Record<string, unknown>,
  idempotencyKey: string
): ProgressStudentToClassResult {
  return {
    profileId: String(event.profileId || ''),
    sourceEnrollmentId: String(event.sourceEnrollmentId || ''),
    targetEnrollmentId: String(event.targetEnrollmentId || ''),
    targetLedgerId: String(event.targetLedgerId || ''),
    sourceStatusBefore: event.sourceStatusBefore as ProgressStudentToClassResult['sourceStatusBefore'],
    sourceStatusAfter: event.sourceStatusAfter as ProgressStudentToClassResult['sourceStatusAfter'],
    rolloverBalance: Number(event.rolloverBalance || 0),
    targetLedgerCreated: Boolean(event.targetLedgerCreated),
    affectedClassIds: Array.isArray(event.affectedClassIds)
      ? (event.affectedClassIds as string[])
      : [],
    idempotencyKey,
    replayed: true,
  };
}

/**
 * Net position on the source course: positive means the family is in credit and
 * the balance becomes a discount on the new course; negative means debt, which
 * is added to the new amount rather than discounted away. Integers throughout —
 * money is stored in whole dong and a fractional rollover would be a real loss.
 */
function sourceBalanceOf(docs: Array<{ id: string; data: () => Record<string, unknown> }>): {
  balance: number;
  ledgerId: string;
} {
  let balance = 0;
  let ledgerId = '';
  for (const doc of docs) {
    const row = doc.data() || {};
    if (!ledgerId) ledgerId = doc.id;
    const amount = Math.trunc(Number(row.amount || 0));
    const paidTotal = Math.trunc(Number(row.paidTotal || 0));
    const discountTotal = Math.trunc(Number(row.discountTotal || 0));
    balance += paidTotal - (amount - discountTotal);
  }
  return { balance: Math.trunc(balance), ledgerId };
}

export async function progressStudentToClass(
  db: DocumentStore,
  input: ProgressStudentToClassInput
): Promise<ProgressStudentToClassResult> {
  if (input.sourceClassId === input.targetClassId) {
    throw progressionError(
      'STUDENT_PROGRESSION_SAME_CLASS: the source and target class are the same',
      400
    );
  }

  let result!: ProgressStudentToClassResult;
  await runStudentIdentityMutationTransaction(
    db,
    { actorId: input.actorId, operation: input.mutationOperation },
    async (tx: Transaction) => {
    // ---- Reads. Everything that can refuse this transition, before any write.

    // Through the transaction, never the database-only resolver: a request
    // naming a retired id must act on the surviving profile, decided against
    // the same snapshot everything else here is decided against.
    const resolution = await resolveCanonicalStudentIdInTransaction(tx, db, input.profileId);
    const profileId = resolution.canonicalProfileId;
    const keyed = { ...input, profileId };
    const idempotencyKey = makeStudentProgressionIdempotencyKey(keyed);

    const eventRef = db.collection(STUDENT_PROGRESSION_EVENTS_COLLECTION).doc(idempotencyKey);
    const eventSnap = await tx.get(eventRef);
    if ((eventSnap as unknown as { exists: boolean }).exists) {
      // Replay wins over every later check. A retry of a promotion that already
      // happened must not fail because the student has since been marked
      // dropped — the caller is asking what happened, not asking to redo it.
      result = readStoredResult(
        ((eventSnap as unknown as { data: () => unknown }).data() || {}) as Record<string, unknown>,
        idempotencyKey
      );
      return;
    }

    const readControl = await readCanonicalStudentReadControlInTransaction(tx, db);

    const profileRef = db.collection('students').doc(profileId);
    const [profileSnap, targetClassSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(db.collection('classes').doc(input.targetClassId)),
    ]);
    // No existence check on the profile: `resolveCanonicalStudentIdInTransaction`
    // already read the canonical target on every path it can return, and it is
    // the single boundary for "which profile is this". A second check here
    // would be unreachable, and unreachable guards rot into false confidence.
    if (!(targetClassSnap as unknown as { exists: boolean }).exists) {
      throw progressionError(
        `STUDENT_PROGRESSION_TARGET_CLASS_NOT_FOUND: ${input.targetClassId}`,
        404
      );
    }
    const profile = ((profileSnap.data() || {}) as Record<string, unknown>);
    const targetClass = ((targetClassSnap.data() || {}) as Record<string, unknown>);
    if (targetClass.status === 'archived') {
      throw progressionError(
        `STUDENT_PROGRESSION_TARGET_ARCHIVED: ${input.targetClassId} is archived`,
        400
      );
    }

    const targetTermEnd = typeof targetClass.endDate === 'string' ? targetClass.endDate : '';
    const targetEnrollmentId = makeStudentCourseEnrollmentId(
      profileId,
      input.targetClassId,
      input.targetTermStart
    );
    const enrollments = await preloadStudentEnrollmentsInTransaction(
      tx,
      db,
      profileId,
      targetEnrollmentId
    );
    const linkedUsers = await readStudentLinkedUsersInTransaction(tx, db, profileId);

    const targetLedgerId = buildCourseLedgerId(
      profileId,
      input.targetClassId,
      input.targetTermStart,
      targetTermEnd
    );
    const [sourceLedgersSnap, targetLedgersSnap, pendingPaymentsSnap] = await Promise.all([
      tx.get(
        db
          .collection('course_fee_ledgers')
          .where('studentId', '==', profileId)
          .where('classId', '==', input.sourceClassId) as never
      ),
      tx.get(
        db
          .collection('course_fee_ledgers')
          .where('studentId', '==', profileId)
          .where('classId', '==', input.targetClassId) as never
      ),
      tx.get(
        db
          .collection('payment_requests')
          .where('studentId', '==', profileId)
          .where('classId', '==', input.sourceClassId)
          .where('status', '==', 'pending') as never
      ),
    ]);

    const { source, closeAs } = selectSourceEnrollment(
      keyed,
      enrollments.all,
      enrollments.open
    );

    // ---- Writes. Nothing below reads.

    if (closeAs) {
      const endedAt =
        source.joinedAt > input.requestedJoinedAt ? source.joinedAt : input.requestedJoinedAt;
      tx.update(db.collection('student_course_enrollments').doc(source.id), {
        status: closeAs,
        endedAt,
        statusReason:
          closeAs === 'completed' ? 'course_completed' : 'transferred_to_next_course',
        statusChangedAt: input.now,
        statusChangedBy: input.actorId,
        updatedAt: input.now,
        serverUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    // The source is excluded from the preload handed to the upsert: this call
    // must open the target, not re-close a record the branch above already
    // staged a close for.
    const remaining = enrollments.all.filter(
      (enrollment) => enrollment.id !== source.id || !closeAs
    ).map((enrollment) =>
      enrollment.id === source.id && closeAs
        ? { ...enrollment, status: closeAs }
        : enrollment
    );
    const targetEnrollment = await upsertSystemEnrollment(
      tx,
      db,
      {
        studentId: profileId,
        classId: input.targetClassId,
        termStart: input.targetTermStart,
        termEnd: targetTermEnd || null,
        status: 'active',
        joinedAt: input.requestedJoinedAt,
        actorId: input.actorId,
        now: input.now,
      },
      { existing: enrollments.existing, all: remaining }
    );

    const targetTeacherId = String(targetClass.teacherId || '');
    // classId/teacherId/enrollmentStatus are compatibility projections of the
    // enrollment, kept while the UI, the DocumentStore rules, and the reports still
    // read them. In canonical_required the enrollment is the only answer, so
    // writing them again would recreate the drift this program removes.
    // currentEnrollmentId is not in that group: it is a service-managed pointer
    // at the canonical record rather than a competing source of truth.
    const relationshipUpdate = buildStudentRelationshipUpdateFields(readControl.mode, {
      classId: targetEnrollment.classId,
      teacherId: targetTeacherId,
      enrollmentStatus: targetEnrollment.status,
    });
    const profilePatch: Record<string, unknown> = {
      ...relationshipUpdate,
      currentEnrollmentId: targetEnrollment.id,
      statusChangedAt: input.now,
      statusChangedBy: input.actorId,
      statusNote: `Progressed from ${input.sourceClassId} to ${input.targetClassId}`,
      updatedAt: FieldValue.serverTimestamp(),
      courseJoins: appendCourseJoin(profile, {
        classId: input.targetClassId,
        termStart: input.targetTermStart,
        joinedAt: input.requestedJoinedAt,
      }),
      ...(typeof input.targetGrade === 'number' ? { grade: input.targetGrade } : {}),
    };
    const persistedAfter = { ...profile, ...profilePatch };
    if (readControl.mode === 'canonical_required') {
      delete persistedAfter.classId;
      delete persistedAfter.teacherId;
      delete persistedAfter.enrollmentStatus;
    }
    const semanticBefore = {
      ...profile,
      classId: source.classId,
      enrollmentStatus: source.status,
    };
    const semanticAfter = {
      ...persistedAfter,
      classId: targetEnrollment.classId,
      teacherId: targetTeacherId,
      enrollmentStatus: targetEnrollment.status,
    };
    tx.update(profileRef, profilePatch);
    applyStudentLinkedUsersInTransaction(
      tx,
      profileId,
      { ...persistedAfter, ...relationshipUpdate },
      linkedUsers
    );
    applyClassStudentCountDeltas(tx, db, [{ before: semanticBefore, after: semanticAfter }]);

    for (const doc of (pendingPaymentsSnap as unknown as { docs: Array<{ ref: never }> }).docs) {
      tx.update(doc.ref, {
        status: 'void',
        updatedAt: FieldValue.serverTimestamp(),
        statusNote: 'Cancelled by class progression',
      });
    }

    const { balance: rolloverBalance, ledgerId: sourceLedgerId } = sourceBalanceOf(
      (sourceLedgersSnap as unknown as { docs: Array<{ id: string; data: () => Record<string, unknown> }> })
        .docs
    );
    const targetExists = findExistingCourseLedger(
      (
        targetLedgersSnap as unknown as {
          docs: Array<{ id: string; data: () => Record<string, unknown> }>;
        }
      ).docs,
      courseLedgerTupleKey(profileId, input.targetClassId, input.targetTermStart),
      input.targetClassId
    );

    const tuitionFee = Math.trunc(Number(targetClass.tuitionFee || 0));
    let targetLedgerCreated = false;
    if (!targetExists && tuitionFee > 0) {
      const discountTotal = rolloverBalance > 0 ? Math.min(tuitionFee, rolloverBalance) : 0;
      const amount = rolloverBalance < 0 ? tuitionFee + Math.abs(rolloverBalance) : tuitionFee;
      tx.set(db.collection('course_fee_ledgers').doc(targetLedgerId), {
        studentId: profileId,
        classId: input.targetClassId,
        amount,
        paidTotal: 0,
        discountTotal,
        status: discountTotal >= amount ? 'paid' : 'unpaid',
        termStart: input.targetTermStart,
        termEnd: targetTermEnd,
        source: 'course',
        periodType: 'course',
        createdAt: FieldValue.serverTimestamp(),
        rolloverFromLedgerId: sourceLedgerId || null,
        rolloverBalance,
      });
      targetLedgerCreated = true;
    }

    const affectedClassIds = [...new Set([input.sourceClassId, input.targetClassId])].sort();
    result = {
      profileId,
      sourceEnrollmentId: source.id,
      targetEnrollmentId: targetEnrollment.id,
      targetLedgerId,
      sourceStatusBefore: source.status as ProgressStudentToClassResult['sourceStatusBefore'],
      sourceStatusAfter: closeAs ?? 'completed',
      rolloverBalance,
      targetLedgerCreated,
      affectedClassIds,
      idempotencyKey,
      replayed: false,
    };

    tx.create(eventRef, {
      ...result,
      kind: input.kind,
      sourceClassId: input.sourceClassId,
      targetClassId: input.targetClassId,
      targetTermStart: input.targetTermStart,
      requestedJoinedAt: input.requestedJoinedAt,
      actorId: input.actorId,
      occurredAt: input.now,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return result;
}

/** Exported for the class-close path, which needs the same open-status rule. */
export { isOpenStudentCourseEnrollmentStatus };
