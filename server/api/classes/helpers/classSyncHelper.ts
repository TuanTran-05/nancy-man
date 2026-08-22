import { FieldValue, type DocumentStore, type DocumentReference } from '@/server/db/documentStore.js';
import { applyClassStudentCountDeltas } from '../../lib/student/studentCounts.js';
import { withStatus } from '../../lib/http/helpers.js';
import { readStoredStudentCourseEnrollment } from '../../lib/student/courseEnrollmentRepository.js';
import type { ClassStatus } from './classHelpers.js';
import {
  assertValidStudentCourseEnrollment,
  isOpenStudentCourseEnrollmentStatus,
  makeStudentCourseEnrollmentId,
  type StudentCourseEnrollment,
} from '../../../../shared/studentCourseEnrollment.js';
import { courseTuitionDueDate } from '../../../../shared/tuitionDueDate.js';

const OPEN_ENROLLMENT_STATUSES = ['trial', 'active', 'on_leave'] as const;

/**
 * Class roster membership, read from the enrollment authority rather than the
 * `students.classId` projection.
 *
 * That projection is exactly the field that goes stale: a student who has
 * already progressed to a different class can still carry the old classId on
 * their profile document until the next write touches it, and the old sync
 * logic archived, paused, and reassigned teachers off that stale value. The
 * enrollment record is what `progressStudentToClass` closes the moment a
 * student actually leaves, so it is the only source that is never behind.
 */
async function loadOpenEnrollmentsForClass(db: DocumentStore, classId: string) {
  const snapshot = await db
    .collection('student_course_enrollments')
    .where('classId', '==', classId)
    .where('status', 'in', [...OPEN_ENROLLMENT_STATUSES])
    .get();
  return snapshot.docs.map((doc) => ({
    ref: doc.ref as DocumentReference,
    enrollment: readStoredStudentCourseEnrollment(doc),
  }));
}

export type ClassTermDateChange = {
  beforeStartDate: string;
  beforeEndDate: string | null;
  afterStartDate: string;
  afterEndDate: string | null;
};

type TermEnrollmentPlan = {
  sourceRef: DocumentReference;
  source: StudentCourseEnrollment;
  targetRef: DocumentReference;
  target: StudentCourseEnrollment;
};

function boundedJoinedAt(joinedAt: string, termStart: string, termEnd: string | null): string {
  const aligned = joinedAt < termStart ? termStart : joinedAt;
  if (termEnd && aligned > termEnd) {
    throw withStatus(
      `CLASS_TERM_JOINED_AT_OUT_OF_RANGE: joinedAt ${joinedAt} falls after ${termEnd}`,
      409
    );
  }
  return aligned;
}

function realignCourseJoins(
  value: unknown,
  classId: string,
  change: ClassTermDateChange
): unknown[] | null {
  if (!Array.isArray(value)) return null;
  let changed = false;
  const targetKey = `${classId}|${change.afterStartDate}`;
  const seenTarget = new Set<string>();
  const next: unknown[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') {
      next.push(raw);
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const entryClassId = String(entry.classId || '');
    const entryTermStart = String(entry.termStart || '');
    if (entryClassId !== classId || entryTermStart !== change.beforeStartDate) {
      const key = `${entryClassId}|${entryTermStart}`;
      if (key === targetKey) {
        if (seenTarget.has(key)) {
          changed = true;
          continue;
        }
        seenTarget.add(key);
      }
      next.push(raw);
      continue;
    }

    changed = true;
    if (seenTarget.has(targetKey)) continue;
    const joinedAt = boundedJoinedAt(
      String(entry.joinedAt || change.beforeStartDate),
      change.afterStartDate,
      change.afterEndDate
    );
    next.push({ ...entry, termStart: change.afterStartDate, joinedAt });
    seenTarget.add(targetKey);
  }

  return changed ? next : null;
}

export async function executeClassUpdateAndSyncAtomic(
  db: DocumentStore,
  classId: string,
  classUpdateData: Record<string, unknown>,
  options: {
    status?: ClassStatus;
    prevStatus?: ClassStatus;
    teacherId?: string;
    prevTeacherId?: string;
    newEndDate?: string;
    actorId?: string;
    termDateChange?: ClassTermDateChange;
  }
) {
  type PendingWrite =
    | { ref: DocumentReference; data: Record<string, unknown>; op: 'update' | 'set' | 'create' }
    | { ref: DocumentReference; op: 'delete' };
  const writes: PendingWrite[] = [];
  const classRef = db.collection('classes').doc(classId);
  if (Object.keys(classUpdateData).length > 0) {
    writes.push({ ref: classRef, data: classUpdateData, op: 'update' });
  }

  const statusChanging = Boolean(options.status && options.status !== options.prevStatus);
  const teacherChanging = Boolean(options.teacherId && options.teacherId !== options.prevTeacherId);
  const termDateChange = options.termDateChange;
  const termDateChanging = Boolean(
    termDateChange &&
    (termDateChange.beforeStartDate !== termDateChange.afterStartDate ||
      termDateChange.beforeEndDate !== termDateChange.afterEndDate)
  );

  const openEnrollmentEntries =
    statusChanging || teacherChanging || termDateChanging
      ? await loadOpenEnrollmentsForClass(db, classId)
      : [];
  const openEnrollments = openEnrollmentEntries.map((entry) => entry.enrollment);
  const openEnrollmentRefById = new Map(
    openEnrollmentEntries.map((entry) => [entry.enrollment.id, entry.ref])
  );

  if (statusChanging && options.status === 'archived' && openEnrollments.length > 0) {
    // Archiving never closes an enrollment on the caller's behalf: the correct
    // way to finish a course is progressStudentToClass, which closes the
    // source, rolls the ledger, and opens a target. A blanket `promoted` stamp
    // here is the exact behavior that produced fifty-nine duplicate profiles.
    throw withStatus(
      `CLASS_HAS_OPEN_ENROLLMENTS: ${openEnrollments.length} student(s) still have an open ` +
        `enrollment in this class. Transfer or complete them before archiving.`,
      409
    );
  }

  // Archiving is never an enrollment-status source: by the time it is allowed
  // (no open enrollments remain), there is nothing left to project.
  let targetEnrollmentStatus: 'active' | 'on_leave' | null = null;
  if (statusChanging) {
    if (options.status === 'paused') targetEnrollmentStatus = 'on_leave';
    if (options.status === 'active') targetEnrollmentStatus = 'active';
  }

  // Trial enrollments are excluded from pause/resume. They carry their own
  // admissions review state; folding them into on_leave would corrupt it for
  // no benefit, since a paused class does not need trial students specifically
  // marked as on_leave to keep the roster honest.
  const affectedEnrollments = openEnrollments.filter((enrollment) => {
    if (targetEnrollmentStatus && enrollment.status === 'trial') return false;
    if (targetEnrollmentStatus) return enrollment.status !== targetEnrollmentStatus;
    return teacherChanging;
  });

  const affectedStudentIds = new Set(affectedEnrollments.map((enrollment) => enrollment.studentId));
  const now = new Date().toISOString();
  const termPlans: TermEnrollmentPlan[] = [];
  if (termDateChanging && termDateChange) {
    for (const source of openEnrollments) {
      if (source.termStart !== termDateChange.beforeStartDate) {
        throw withStatus(
          `CLASS_TERM_ENROLLMENT_MISMATCH: enrollment ${source.id} starts ${source.termStart}, ` +
            `class starts ${termDateChange.beforeStartDate}`,
          409
        );
      }
      const targetId = makeStudentCourseEnrollmentId(
        source.studentId,
        classId,
        termDateChange.afterStartDate
      );
      const nextStatus =
        targetEnrollmentStatus && source.status !== 'trial'
          ? targetEnrollmentStatus
          : source.status;
      const statusChanged = nextStatus !== source.status;
      const target = assertValidStudentCourseEnrollment({
        ...source,
        id: targetId,
        termStart: termDateChange.afterStartDate,
        termEnd: termDateChange.afterEndDate,
        joinedAt: boundedJoinedAt(
          source.joinedAt,
          termDateChange.afterStartDate,
          termDateChange.afterEndDate
        ),
        status: nextStatus,
        endedAt: null,
        statusChangedAt: statusChanged ? now : source.statusChangedAt,
        statusChangedBy: statusChanged ? options.actorId || 'system' : source.statusChangedBy,
        updatedAt: now,
      });
      termPlans.push({
        sourceRef: openEnrollmentRefById.get(source.id)!,
        source,
        targetRef: db.collection('student_course_enrollments').doc(targetId),
        target,
      });
    }

    const collisionChecks = termPlans.filter((plan) => plan.target.id !== plan.source.id);
    const collisionSnapshots = await Promise.all(
      collisionChecks.map((plan) => plan.targetRef.get())
    );
    const collisions = collisionSnapshots.filter((snapshot) => snapshot.exists);
    if (collisions.length > 0) {
      throw withStatus(
        `CLASS_TERM_ENROLLMENT_COLLISION: ${collisions.map((snapshot) => snapshot.id).join(', ')}`,
        409
      );
    }
  }

  const termPlanBySourceId = new Map(termPlans.map((plan) => [plan.source.id, plan]));
  for (const plan of termPlans) {
    const data = {
      ...plan.target,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (plan.target.id === plan.source.id) {
      writes.push({ ref: plan.sourceRef, data, op: 'update' });
    } else {
      writes.push({ ref: plan.targetRef, data, op: 'create' });
      writes.push({ ref: plan.sourceRef, op: 'delete' });
    }
  }

  const studentPatch: Record<string, unknown> = {};
  if (targetEnrollmentStatus) studentPatch.enrollmentStatus = targetEnrollmentStatus;
  if (teacherChanging) studentPatch.teacherId = options.teacherId;

  const userPatch: Record<string, unknown> = {};
  if (targetEnrollmentStatus) userPatch.enrollmentStatus = targetEnrollmentStatus;
  if (teacherChanging) userPatch.teacherId = options.teacherId;

  let evalsSnap: AppDocumentStore.QuerySnapshot | null = null;
  if (options.newEndDate) {
    evalsSnap = await db.collection('evaluations').where('classId', '==', classId).get();
  }

  let ledgersSnap: AppDocumentStore.QuerySnapshot | null = null;
  if (termDateChanging) {
    ledgersSnap = await db.collection('course_fee_ledgers').where('classId', '==', classId).get();
  }

  const studentIdsToRead = [
    ...new Set([
      ...affectedEnrollments.map((enrollment) => enrollment.studentId),
      ...termPlans.map((plan) => plan.source.studentId),
    ]),
  ];
  const studentDocs = studentIdsToRead.length
    ? await Promise.all(
        studentIdsToRead.map((studentId) => db.collection('students').doc(studentId).get())
      )
    : [];
  const studentDocById = new Map(
    studentIdsToRead.map((studentId, index) => [studentId, studentDocs[index]])
  );
  const userDocs = affectedEnrollments.length
    ? await Promise.all(
        affectedEnrollments.map((enrollment) =>
          db.collection('users').doc(`student:${enrollment.studentId}`).get()
        )
      )
    : [];

  const profilePatchByStudent = new Map<string, Record<string, unknown>>();
  const mergeProfilePatch = (studentId: string, patch: Record<string, unknown>) => {
    profilePatchByStudent.set(studentId, {
      ...(profilePatchByStudent.get(studentId) || {}),
      ...patch,
    });
  };

  affectedEnrollments.forEach((enrollment, index) => {
    if (targetEnrollmentStatus && !termPlanBySourceId.has(enrollment.id)) {
      writes.push({
        ref: openEnrollmentRefById.get(enrollment.id)!,
        data: {
          status: targetEnrollmentStatus,
          statusChangedAt: FieldValue.serverTimestamp(),
          statusChangedBy: options.actorId || 'system',
          updatedAt: FieldValue.serverTimestamp(),
        },
        op: 'update',
      });
    }
    mergeProfilePatch(enrollment.studentId, studentPatch);

    const userSnap = userDocs[index];
    if (userSnap?.exists) {
      writes.push({
        ref: db.collection('users').doc(`student:${enrollment.studentId}`) as DocumentReference,
        data: { ...userPatch, updatedAt: FieldValue.serverTimestamp() },
        op: 'update',
      });
    }
  });

  const termStudentIds = new Set<string>();
  for (const plan of termPlans) {
    const studentId = plan.source.studentId;
    const studentSnap = studentDocById.get(studentId);
    if (!studentSnap?.exists) {
      throw withStatus(`CLASS_TERM_STUDENT_MISSING: ${studentId}`, 409);
    }
    const student = (studentSnap.data() || {}) as Record<string, unknown>;
    const currentEnrollmentId = String(student.currentEnrollmentId || '');
    if (
      currentEnrollmentId &&
      currentEnrollmentId !== plan.source.id &&
      currentEnrollmentId !== plan.target.id
    ) {
      throw withStatus(
        `CLASS_TERM_CURRENT_ENROLLMENT_CONFLICT: ${studentId} points to ${currentEnrollmentId}`,
        409
      );
    }
    const patch: Record<string, unknown> = { currentEnrollmentId: plan.target.id };
    if (termDateChange && termDateChange.beforeStartDate !== termDateChange.afterStartDate) {
      const courseJoins = realignCourseJoins(student.courseJoins, classId, termDateChange);
      if (courseJoins) patch.courseJoins = courseJoins;
    }
    mergeProfilePatch(studentId, patch);
    termStudentIds.add(studentId);
  }

  const transitions: Array<{ before?: Record<string, unknown>; after?: Record<string, unknown> }> =
    [];
  for (const [studentId, patch] of profilePatchByStudent) {
    const studentSnap = studentDocById.get(studentId);
    if (!studentSnap?.exists) continue;
    const before = (studentSnap.data() || {}) as Record<string, unknown>;
    const after = { ...before, ...patch };
    if (affectedStudentIds.has(studentId)) {
      transitions.push({ before, after });
    }
    writes.push({
      ref: db.collection('students').doc(studentId) as DocumentReference,
      data: { ...patch, updatedAt: FieldValue.serverTimestamp() },
      op: 'update',
    });
  }

  let updatedLedgers = 0;
  if (ledgersSnap && termDateChange) {
    const sourceIdToTargetId = new Map(termPlans.map((plan) => [plan.source.id, plan.target.id]));
    const targetIdByStudent = new Map(
      termPlans.map((plan) => [plan.source.studentId, plan.target.id])
    );
    const relevantLedgers = ledgersSnap.docs.filter((doc) => {
      const data = (doc.data() || {}) as Record<string, unknown>;
      const enrollmentId = String(data.enrollmentId || '');
      const studentId = String(data.studentId || '');
      return (
        sourceIdToTargetId.has(enrollmentId) ||
        (String(data.termStart || '') === termDateChange.beforeStartDate &&
          targetIdByStudent.has(studentId))
      );
    });
    const relevantIds = new Set(relevantLedgers.map((doc) => doc.id));
    const relevantLedgerIdsByStudent = new Map<string, string[]>();
    for (const ledger of relevantLedgers) {
      const studentId = String((ledger.data() || {}).studentId || '');
      const bucket = relevantLedgerIdsByStudent.get(studentId) || [];
      bucket.push(ledger.id);
      relevantLedgerIdsByStudent.set(studentId, bucket);
    }
    const duplicates = [...relevantLedgerIdsByStudent.entries()].filter(
      ([, ledgerIds]) => ledgerIds.length > 1
    );
    if (duplicates.length > 0) {
      throw withStatus(
        `CLASS_TERM_LEDGER_DUPLICATE: ${duplicates
          .map(([studentId, ledgerIds]) => `${studentId}=${ledgerIds.join(',')}`)
          .join('; ')}`,
        409
      );
    }
    if (termDateChange.beforeStartDate !== termDateChange.afterStartDate) {
      const collisions = ledgersSnap.docs.filter((doc) => {
        if (relevantIds.has(doc.id)) return false;
        const data = (doc.data() || {}) as Record<string, unknown>;
        return (
          String(data.termStart || '') === termDateChange.afterStartDate &&
          targetIdByStudent.has(String(data.studentId || ''))
        );
      });
      if (collisions.length > 0) {
        throw withStatus(
          `CLASS_TERM_LEDGER_COLLISION: ${collisions.map((doc) => doc.id).join(', ')}`,
          409
        );
      }
    }
    for (const ledger of relevantLedgers) {
      const data = (ledger.data() || {}) as Record<string, unknown>;
      const studentId = String(data.studentId || '');
      const targetEnrollmentId =
        sourceIdToTargetId.get(String(data.enrollmentId || '')) || targetIdByStudent.get(studentId);
      if (!targetEnrollmentId) continue;
      writes.push({
        ref: ledger.ref,
        data: {
          enrollmentId: targetEnrollmentId,
          termStart: termDateChange.afterStartDate,
          termEnd: termDateChange.afterEndDate,
          ...(termDateChange.beforeStartDate !== termDateChange.afterStartDate
            ? { dueDate: courseTuitionDueDate(termDateChange.afterStartDate) }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        op: 'update',
      });
    }
    updatedLedgers = relevantLedgers.length;
  }

  if (evalsSnap && (evalsSnap.size ?? evalsSnap.docs.length) > 0 && options.newEndDate) {
    evalsSnap.docs.forEach((doc) => {
      writes.push({
        ref: doc.ref,
        data: { date: options.newEndDate, updatedAt: FieldValue.serverTimestamp() },
        op: 'update',
      });
    });
  }

  const collectedDeltas: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];
  const mockWriter = {
    update(ref: DocumentReference, data: Record<string, unknown>) {
      collectedDeltas.push({ ref, data });
    },
  };

  if (transitions.length > 0) {
    applyClassStudentCountDeltas(mockWriter, db, transitions);
    collectedDeltas.forEach(({ ref, data }) => {
      writes.push({ ref, data, op: 'update' });
    });
  }

  if (writes.length > 400) {
    throw withStatus(
      `Class update requires ${writes.length} writes which exceeds the 400-write atomic limit. Please reduce the class size or contact support.`,
      400
    );
  }

  if (writes.length > 0) {
    const batch = db.batch();
    writes.forEach((item) => {
      if (item.op === 'update') {
        batch.update(item.ref, item.data);
      } else if (item.op === 'set') {
        batch.set(item.ref, item.data);
      } else if (item.op === 'create') {
        batch.create(item.ref, item.data);
      } else if (item.op === 'delete') {
        batch.delete(item.ref);
      }
    });
    await batch.commit();
  }

  return {
    updatedStudents: transitions.length,
    updatedUsers: userDocs.filter((snap) => snap?.exists).length,
    updatedEvaluations: evalsSnap ? (evalsSnap.size ?? evalsSnap.docs.length) : 0,
    updatedEnrollments: targetEnrollmentStatus ? affectedEnrollments.length : 0,
    alignedEnrollments: termPlans.length,
    movedEnrollmentDocuments: termPlans.filter((plan) => plan.source.id !== plan.target.id).length,
    updatedLedgers,
    termDateStudentIds: [...termStudentIds],
  };
}

export async function syncClassStatusToStudents(
  db: DocumentStore,
  classId: string,
  newStatus: ClassStatus,
  prevStatus?: ClassStatus,
  actorId?: string
) {
  const res = await executeClassUpdateAndSyncAtomic(
    db,
    classId,
    {},
    {
      status: newStatus,
      prevStatus,
      actorId,
    }
  );
  return { updatedStudents: res.updatedStudents };
}

export async function syncClassTeacherToStudents(
  db: DocumentStore,
  classId: string,
  teacherId: string,
  prevTeacherId?: string
) {
  const res = await executeClassUpdateAndSyncAtomic(
    db,
    classId,
    {},
    {
      teacherId,
      prevTeacherId,
    }
  );
  return { updatedStudents: res.updatedStudents };
}
