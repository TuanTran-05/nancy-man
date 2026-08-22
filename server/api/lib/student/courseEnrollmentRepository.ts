import {
  FieldValue,
  type DocumentReference,
  type DocumentStore,
  type QueryDocumentSnapshot,
  type Transaction,
} from '@/server/db/documentStore.js';
import {
  assertValidStudentCourseEnrollment,
  isOpenStudentCourseEnrollmentStatus,
  makeStudentCourseEnrollmentId,
  type StudentCourseEnrollment,
  type StudentCourseEnrollmentConfidence,
  type StudentCourseEnrollmentSource,
  type StudentCourseEnrollmentStatus,
} from '../../../../shared/studentCourseEnrollment.js';
import {
  resolveClassTermRange,
  resolveTermJoinedAt,
  type ClassTermRange,
} from '../../../../shared/classJoinWindow.js';

export const STUDENT_COURSE_ENROLLMENTS_COLLECTION = 'student_course_enrollments';

export type SystemEnrollmentInput = {
  studentId: string;
  classId: string;
  termStart: string;
  termEnd: string | null;
  status: Extract<StudentCourseEnrollmentStatus, 'trial' | 'active' | 'on_leave'>;
  joinedAt: string;
  actorId: string;
  now: string;
};

export type SystemEnrollmentTransitionInput = SystemEnrollmentInput & {
  expectedStatuses: readonly StudentCourseEnrollmentStatus[];
  statusReason: string;
};

export type PreloadedStudentEnrollments = {
  existing: StudentCourseEnrollment | null;
  all: StudentCourseEnrollment[];
  /**
   * The one open enrollment, if there is one. Progression eligibility depends
   * on what is open *anywhere*, not only in the source class, so this is part
   * of the preload rather than something a caller derives later — deriving it
   * later is what puts a read after a write.
   */
  open?: StudentCourseEnrollment | null;
};

export type CloseOpenEnrollmentsInput = {
  studentId: string;
  exceptEnrollmentId?: string;
  status: Extract<StudentCourseEnrollmentStatus, 'completed' | 'transferred' | 'dropped'>;
  endedAt: string;
  reason: string;
  actorId: string;
  now: string;
};

export type ManualEnrollmentInput = {
  enrollmentId: string;
  status: StudentCourseEnrollmentStatus;
  joinedAt: string;
  endedAt: string | null;
  statusReason: string;
  actorId: string;
  now: string;
};

export type EnrollmentChange = {
  before: StudentCourseEnrollment;
  after: StudentCourseEnrollment;
  openEnrollmentBefore: StudentCourseEnrollment | null;
  remainingOpenEnrollments: StudentCourseEnrollment[];
  studentBefore?: Record<string, unknown> | null;
};

function enrollmentRef(db: DocumentStore, enrollmentId: string): DocumentReference {
  return db.collection(STUDENT_COURSE_ENROLLMENTS_COLLECTION).doc(enrollmentId);
}

function enrollmentQuery(db: DocumentStore, studentId: string) {
  return db
    .collection(STUDENT_COURSE_ENROLLMENTS_COLLECTION)
    .where('studentId', '==', studentId)
    .orderBy('termStart', 'desc');
}

function isTimestampLike(value: unknown): value is { toDate: () => Date } {
  return !!value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function';
}

function isoTimestamp(value: unknown, fallback: string | null = null): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (isTimestampLike(value)) return value.toDate().toISOString();
  if (value && typeof value === 'object') {
    const seconds = Number(
      (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
        (value as { _seconds?: unknown })._seconds
    );
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return fallback;
}

export function readStoredStudentCourseEnrollment(
  snapshot: QueryDocumentSnapshot | { id: string; data: () => unknown }
): StudentCourseEnrollment {
  const raw = (snapshot.data() || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  return assertValidStudentCourseEnrollment({
    id: snapshot.id,
    ...raw,
    termEnd: raw.termEnd ?? null,
    endedAt: raw.endedAt ?? null,
    statusReason: raw.statusReason ?? null,
    source: raw.source || 'backfill',
    confidence: raw.confidence || 'inferred',
    statusChangedAt: isoTimestamp(raw.statusChangedAt, now),
    statusChangedBy: String(raw.statusChangedBy || 'migration'),
    confirmedAt: isoTimestamp(raw.confirmedAt),
    confirmedBy: raw.confirmedBy ? String(raw.confirmedBy) : null,
    createdAt: isoTimestamp(raw.createdAt, now),
    updatedAt: isoTimestamp(raw.updatedAt, now),
  });
}

function serializeEnrollment(enrollment: StudentCourseEnrollment): Record<string, unknown> {
  return {
    ...enrollment,
    updatedAt: enrollment.updatedAt,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  };
}

function protectedFromInference(enrollment: StudentCourseEnrollment): boolean {
  return enrollment.source === 'manual' || enrollment.confidence === 'confirmed';
}

function assertOpenEnrollmentUniqueness(
  enrollments: StudentCourseEnrollment[],
  exceptEnrollmentId?: string
): void {
  const open = enrollments.filter(
    (enrollment) =>
      isOpenStudentCourseEnrollmentStatus(enrollment.status) && enrollment.id !== exceptEnrollmentId
  );
  if (open.length > 0) {
    throw Object.assign(new Error('Student already has another open course enrollment'), {
      statusCode: 409,
    });
  }
}

async function readStudentEnrollmentsInTransaction(
  tx: Transaction,
  db: DocumentStore,
  studentId: string
): Promise<StudentCourseEnrollment[]> {
  const snapshot = await tx.get(enrollmentQuery(db, studentId));
  return snapshot.docs.map((doc) => readStoredStudentCourseEnrollment(doc));
}

/**
 * One read of the whole enrollment picture for a profile, plus the target
 * tuple, with no writes.
 *
 * Two simultaneously open enrollments is a data fault rather than a state a
 * caller should get to pick from: returning one of them would let progression
 * close the wrong course and leave the other silently open forever.
 */
export async function preloadStudentEnrollmentsInTransaction(
  tx: Transaction,
  db: DocumentStore,
  studentId: string,
  targetEnrollmentId: string
): Promise<Required<PreloadedStudentEnrollments>> {
  const all = await readStudentEnrollmentsInTransaction(tx, db, studentId);
  const open = all.filter((enrollment) => isOpenStudentCourseEnrollmentStatus(enrollment.status));
  if (open.length > 1) {
    throw Object.assign(
      new Error(
        `Student has ${open.length} open course enrollments: ${open.map((e) => e.id).join(', ')}`
      ),
      { statusCode: 409 }
    );
  }
  return {
    all,
    existing: all.find((enrollment) => enrollment.id === targetEnrollmentId) ?? null,
    open: open[0] ?? null,
  };
}

export async function getStudentEnrollments(
  db: DocumentStore,
  studentId: string
): Promise<StudentCourseEnrollment[]> {
  const snapshot = await enrollmentQuery(db, studentId).get();
  return snapshot.docs.map((doc) => readStoredStudentCourseEnrollment(doc));
}

/**
 * A transfer has exactly one authoritative source: the canonical profile's
 * single open course enrollment. Choosing a row when the data is ambiguous,
 * or falling back to the legacy profile projection when it is absent, would
 * move the student from the wrong class.
 */
export function requireSingleOpenStudentEnrollment(
  enrollments: StudentCourseEnrollment[]
): StudentCourseEnrollment {
  const open = enrollments.filter((enrollment) =>
    isOpenStudentCourseEnrollmentStatus(enrollment.status)
  );
  if (open.length === 1) return open[0];
  if (open.length === 0) {
    throw Object.assign(
      new Error('STUDENT_PROGRESSION_SOURCE_INELIGIBLE: a transfer needs an open enrollment'),
      { statusCode: 409 }
    );
  }
  throw Object.assign(
    new Error('STUDENT_PROGRESSION_SOURCE_INELIGIBLE: multiple open enrollments'),
    { statusCode: 409 }
  );
}

export async function closeOpenEnrollments(
  tx: Transaction,
  db: DocumentStore,
  input: CloseOpenEnrollmentsInput,
  preloaded?: PreloadedStudentEnrollments
): Promise<StudentCourseEnrollment[]> {
  const enrollments =
    preloaded?.all ?? (await readStudentEnrollmentsInTransaction(tx, db, input.studentId));
  const closed: StudentCourseEnrollment[] = [];
  for (const current of enrollments) {
    if (!isOpenStudentCourseEnrollmentStatus(current.status)) continue;
    if (current.id === input.exceptEnrollmentId) continue;
    const after = assertValidStudentCourseEnrollment({
      ...current,
      status: input.status,
      endedAt: input.endedAt,
      statusReason: input.reason,
      statusChangedAt: input.now,
      statusChangedBy: input.actorId,
      updatedAt: input.now,
    });
    tx.update(enrollmentRef(db, current.id), serializeEnrollment(after));
    closed.push(after);
  }
  return closed;
}

export async function upsertSystemEnrollment(
  tx: Transaction,
  db: DocumentStore,
  input: SystemEnrollmentInput,
  preloaded?: PreloadedStudentEnrollments
): Promise<StudentCourseEnrollment> {
  const id = makeStudentCourseEnrollmentId(input.studentId, input.classId, input.termStart);
  const ref = enrollmentRef(db, id);
  let existing: StudentCourseEnrollment | null;
  let allEnrollments: StudentCourseEnrollment[];
  let existingSnapshot: { exists: boolean } = { exists: Boolean(preloaded?.existing) };
  if (preloaded) {
    existing = preloaded.existing;
    allEnrollments = preloaded.all;
  } else {
    const [snapshot, records] = await Promise.all([
      tx.get(ref),
      readStudentEnrollmentsInTransaction(tx, db, input.studentId),
    ]);
    existingSnapshot = snapshot;
    existing = snapshot.exists
      ? readStoredStudentCourseEnrollment(snapshot as QueryDocumentSnapshot)
      : null;
    allEnrollments = records;
  }
  const otherOpen = allEnrollments.filter(
    (enrollment) =>
      enrollment.id !== id && isOpenStudentCourseEnrollmentStatus(enrollment.status)
  );
  // Decide the closures before staging any of them, then check the projected
  // result. The check reads as a tautology against today's loop, and that is
  // the point: it fails loudly the moment someone adds a rule that skips a
  // record here, instead of leaving a second course quietly open forever.
  const closures = otherOpen.map((open) =>
    assertValidStudentCourseEnrollment({
      ...open,
      status: 'transferred',
      endedAt: open.joinedAt > input.joinedAt ? open.joinedAt : input.joinedAt,
      statusReason: 'replaced_by_new_course_enrollment',
      statusChangedAt: input.now,
      statusChangedBy: input.actorId,
      updatedAt: input.now,
    })
  );
  const closedIds = new Set(closures.map((closed) => closed.id));
  assertOpenEnrollmentUniqueness(
    allEnrollments.filter((enrollment) => !closedIds.has(enrollment.id)),
    id
  );

  for (const closed of closures) {
    tx.update(enrollmentRef(db, closed.id), serializeEnrollment(closed));
  }

  if (existing && protectedFromInference(existing)) return existing;

  const enrollment = assertValidStudentCourseEnrollment({
    ...(existing || {
      id,
      studentId: input.studentId,
      classId: input.classId,
      termStart: input.termStart,
      createdAt: input.now,
    }),
    id,
    studentId: input.studentId,
    classId: input.classId,
    termStart: input.termStart,
    termEnd: input.termEnd,
    status: input.status,
    joinedAt: existing?.joinedAt ?? input.joinedAt,
    endedAt: null,
    statusReason: existing?.statusReason ?? null,
    source: 'system' as StudentCourseEnrollmentSource,
    confidence: 'confirmed' as StudentCourseEnrollmentConfidence,
    statusChangedAt: input.now,
    statusChangedBy: input.actorId,
    confirmedAt: existing?.confirmedAt ?? input.now,
    confirmedBy: existing?.confirmedBy ?? input.actorId,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  });
  if (existingSnapshot.exists) tx.update(ref, serializeEnrollment(enrollment));
  else tx.create(ref, serializeEnrollment(enrollment));
  return enrollment;
}

/**
 * Performs a caller-declared lifecycle transition on an existing system row.
 *
 * Trial admission flows are allowed to change confirmed system rows because
 * those rows are the canonical state being decided. They must never reinterpret
 * a manual or backfill row as system-owned, and they must name the exact source
 * statuses they expect so a stale retry cannot overwrite a newer decision.
 * The caller preloads the enrollment picture to keep every DocumentStore read ahead
 * of the staged update.
 */
export async function transitionSystemEnrollment(
  tx: Transaction,
  db: DocumentStore,
  input: SystemEnrollmentTransitionInput,
  preloaded: Required<PreloadedStudentEnrollments>
): Promise<StudentCourseEnrollment> {
  const id = makeStudentCourseEnrollmentId(input.studentId, input.classId, input.termStart);
  const existing = preloaded.existing;
  if (!existing || existing.id !== id) {
    throw Object.assign(new Error('Expected system course enrollment was not found'), {
      statusCode: 409,
    });
  }
  if (existing.source !== 'system') {
    throw Object.assign(new Error('Protected course enrollment requires manual correction'), {
      statusCode: 409,
    });
  }
  if (!input.expectedStatuses.includes(existing.status)) {
    throw Object.assign(
      new Error(
        `Course enrollment state conflict: expected ${input.expectedStatuses.join(' or ')}, found ${existing.status}`
      ),
      { statusCode: 409 }
    );
  }
  assertOpenEnrollmentUniqueness(preloaded.all, existing.id);

  const after = assertValidStudentCourseEnrollment({
    ...existing,
    termEnd: input.termEnd,
    status: input.status,
    joinedAt: existing.joinedAt || input.joinedAt,
    endedAt: null,
    statusReason: input.statusReason,
    source: 'system' as StudentCourseEnrollmentSource,
    confidence: 'confirmed' as StudentCourseEnrollmentConfidence,
    statusChangedAt: input.now,
    statusChangedBy: input.actorId,
    confirmedAt: existing.confirmedAt ?? input.now,
    confirmedBy: existing.confirmedBy ?? input.actorId,
    updatedAt: input.now,
  });
  tx.update(enrollmentRef(db, existing.id), serializeEnrollment(after));
  return after;
}

export async function prepareManualEnrollmentUpdate(
  tx: Transaction,
  db: DocumentStore,
  input: ManualEnrollmentInput
): Promise<EnrollmentChange> {
  const ref = enrollmentRef(db, input.enrollmentId);
  const snapshot = await tx.get(ref);
  if (!snapshot.exists) {
    throw Object.assign(new Error('Course enrollment not found'), { statusCode: 404 });
  }
  const before = readStoredStudentCourseEnrollment(snapshot as QueryDocumentSnapshot);
  const enrollments = await readStudentEnrollmentsInTransaction(tx, db, before.studentId);
  const openBefore = enrollments.filter((enrollment) =>
    isOpenStudentCourseEnrollmentStatus(enrollment.status)
  );
  if (openBefore.length > 1) {
    throw Object.assign(new Error('Student has multiple open course enrollments'), {
      statusCode: 409,
    });
  }
  if (isOpenStudentCourseEnrollmentStatus(input.status)) {
    assertOpenEnrollmentUniqueness(enrollments, before.id);
  }
  let studentBefore: Record<string, unknown> | null | undefined;
  const studentsCollection = db.collection('students');
  if (typeof studentsCollection?.doc === 'function') {
    const studentSnapshot = await tx.get(studentsCollection.doc(before.studentId));
    studentBefore = studentSnapshot.exists ? ((studentSnapshot.data() || {}) as Record<string, unknown>) : null;
  }
  const after = assertValidStudentCourseEnrollment({
    ...before,
    status: input.status,
    joinedAt: input.joinedAt,
    endedAt: input.endedAt,
    statusReason: input.statusReason,
    source: 'manual' as StudentCourseEnrollmentSource,
    confidence: 'confirmed' as StudentCourseEnrollmentConfidence,
    statusChangedAt: input.now,
    statusChangedBy: input.actorId,
    confirmedAt: input.now,
    confirmedBy: input.actorId,
    updatedAt: input.now,
  });
  const remainingOpenEnrollments = enrollments
    .filter((enrollment) => enrollment.id !== before.id)
    .filter((enrollment) => isOpenStudentCourseEnrollmentStatus(enrollment.status));
  if (isOpenStudentCourseEnrollmentStatus(after.status)) {
    remainingOpenEnrollments.push(after);
  }
  return {
    before,
    after,
    openEnrollmentBefore: openBefore[0] ?? null,
    remainingOpenEnrollments,
    studentBefore,
  };
}

export function applyManualEnrollmentUpdate(
  tx: Transaction,
  db: DocumentStore,
  change: EnrollmentChange
): void {
  tx.update(enrollmentRef(db, change.after.id), serializeEnrollment(change.after));
}

export async function updateManualEnrollment(
  tx: Transaction,
  db: DocumentStore,
  input: ManualEnrollmentInput
): Promise<EnrollmentChange> {
  const change = await prepareManualEnrollmentUpdate(tx, db, input);
  applyManualEnrollmentUpdate(tx, db, change);
  return change;
}

export function resolveClassCurrentTerm(
  classData: Record<string, unknown>,
  today: string
): ClassTermRange {
  const range = resolveClassTermRange(classData, today);
  if (range) return range;
  throw Object.assign(new Error('Class has no stable course term start date'), { statusCode: 409 });
}

export function tryResolveClassCurrentTerm(
  classData: Record<string, unknown>,
  today: string
): { termStart: string; termEnd: string | null } | null {
  try {
    return resolveClassCurrentTerm(classData, today);
  } catch {
    return null;
  }
}

export { resolveTermJoinedAt };
