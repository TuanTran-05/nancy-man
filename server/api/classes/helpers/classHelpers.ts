import type { ApiRequest } from '@/server/api/lib/http/types.js';
import {
  FieldPath,
  FieldValue,
  type DocumentStore,
  type WriteBatch,
  type DocumentReference,
} from '@/server/db/documentStore.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import { getClientIp, writeAuditLog, type AuditAction } from '../../lib/logging/auditLog.js';
import type { StudentCredentialDoc } from '../../lib/student/studentCredentials.js';
import { getString, getNumber, getUserAgent, withStatus } from '../../lib/http/helpers.js';
import { calculateEndDate, getRequiredSessions } from '../../lib/classes/courseDateUtils.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { applyClassStudentCountDeltas } from '../../lib/student/studentCounts.js';
import { readStoredStudentCourseEnrollment } from '../../lib/student/courseEnrollmentRepository.js';
import {
  buildCourseLedgerId,
  courseLedgerTupleKey,
  indexLedgersByTuple,
} from '../../lib/accounting/courseLedgerIdentity.js';
import { planClassLedgers, type ClassLedgerPlan } from '../../lib/accounting/courseLedgerPlanner.js';
import {
  writeCourseFeeLedgers,
  type WriteRequest,
} from '../../lib/accounting/courseLedgerWriter.js';

export { buildCourseLedgerId };

export type ClassStatus = 'active' | 'paused' | 'archived';

export const VALID_STATUSES: ClassStatus[] = ['active', 'paused', 'archived'];
export const STUDENT_AUTH_FLAG_FIELDS = [
  'customLoginPasswordSet',
  'forcePasswordChange',
  'parentPasswordSet',
  'parentForcePasswordChange',
] as const;
export const STUDENT_CREDENTIAL_FIELDS = [
  'loginPasswordSalt',
  'loginPasswordHash',
  'passwordVersion',
  'parentPasswordSalt',
  'parentPasswordHash',
  'parentPasswordVersion',
] as const;
export const CLASS_FIELDS = [
  'name',
  'schedule',
  'daysOfWeek',
  'description',
  'startDate',
  'endDate',
  'startTime',
  'room',
  'teacherId',
  'status',
  'salaryPerSession',
  'tuitionFee',
  'grade',
  'weeklySessions',
];
export const DEFAULT_LEDGER_CLASS_BATCH_SIZE = 20;
export const MAX_LEDGER_CLASS_BATCH_SIZE = 50;
export const STUDENT_PROJECTION_SYNC_BATCH_SIZE = 10;

export function normalizeDaysOfWeek(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
}

type NormalizedWeeklySession = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
};

function normalizeWeeklySessions(value: unknown): NormalizedWeeklySession[] {
  if (!Array.isArray(value)) return [];
  const sessions = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const dayOfWeek = Number(raw.dayOfWeek);
      const startTime = getString(raw, 'startTime');
      const endTime = getString(raw, 'endTime');
      const room = getString(raw, 'room');
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return null;
      if (!startTime || !endTime || endTime <= startTime) return null;
      return {
        dayOfWeek,
        startTime,
        endTime,
        ...(room ? { room } : {}),
      };
    })
    .filter((session): session is NormalizedWeeklySession => Boolean(session))
    .sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startTime.localeCompare(b.startTime);
    });

  const seen = new Set<number>();
  sessions.forEach((session) => {
    if (seen.has(session.dayOfWeek)) throw new Error('Duplicate weekly session weekday');
    seen.add(session.dayOfWeek);
  });
  return sessions;
}

function scheduleFromWeeklySession(session: NormalizedWeeklySession | undefined): string {
  if (!session) return '';
  return `${session.startTime.slice(0, 5)} - ${session.endTime.slice(0, 5)}`;
}

export function parseIsoDateOnly(
  value: string
): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function getIsoDateDayOfWeek(value: string): number | null {
  const parts = parseIsoDateOnly(value);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day).getDay();
}

export function normalizeHolidayDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dates: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const date = item.trim();
    if (!parseIsoDateOnly(date)) continue;
    dates.push(date);
  }
  return [...new Set(dates)].sort();
}

export async function getSystemHolidays(db: DocumentStore): Promise<string[]> {
  const snap = await db.collection('system_settings').doc('holidays').get();
  return normalizeHolidayDates(snap.data()?.dates);
}

export function buildHolidayClassUpdate(
  classData: Record<string, unknown>,
  holidays: string[],
  systemHolidays: string[]
) {
  const updateData: Record<string, unknown> = {
    holidays,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const startDate = typeof classData.startDate === 'string' ? classData.startDate : '';
  const daysOfWeek = normalizeDaysOfWeek(classData.daysOfWeek);
  if (!startDate || !parseIsoDateOnly(startDate) || daysOfWeek.length === 0) {
    return updateData;
  }

  const gradeValue = Number(classData.grade);
  const grade = Number.isInteger(gradeValue) ? gradeValue : undefined;
  updateData.endDate = calculateEndDate(startDate, getRequiredSessions(grade), daysOfWeek, [
    ...new Set([...holidays, ...systemHolidays]),
  ]);
  return updateData;
}

export function getVietnamTodayStr() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isActiveOngoingClass(classData: Record<string, unknown>, today: string) {
  const status = typeof classData.status === 'string' ? classData.status : 'active';
  const endDate = typeof classData.endDate === 'string' ? classData.endDate : '';
  return status === 'active' && Boolean(parseIsoDateOnly(endDate)) && endDate >= today;
}

export function hasHolidayOnClassDay(classData: Record<string, unknown>, holidays: string[]) {
  const daysOfWeek = normalizeDaysOfWeek(classData.daysOfWeek);
  if (daysOfWeek.length === 0) return false;
  return holidays.some((holiday) => {
    const day = getIsoDateDayOfWeek(holiday);
    return day !== null && daysOfWeek.includes(day);
  });
}

export async function extendActiveClassesForSystemHolidaysDetailed(
  db: DocumentStore,
  systemHolidays: string[]
) {
  const classesSnap = await db.collection('classes').get();
  const batch = db.batch();
  const today = getVietnamTodayStr();
  let affectedClassCount = 0;
  const affectedClassIds: string[] = [];

  for (const classDoc of classesSnap.docs) {
    const classData = classDoc.data();
    if (!isActiveOngoingClass(classData, today)) continue;
    if (!hasHolidayOnClassDay(classData, systemHolidays)) continue;

    const classHolidays = normalizeHolidayDates(classData.holidays);
    const updateData = buildHolidayClassUpdate(classData, classHolidays, systemHolidays);
    if (typeof updateData.endDate !== 'string' || updateData.endDate === classData.endDate) {
      continue;
    }

    batch.update(classDoc.ref, {
      endDate: updateData.endDate,
      updatedAt: updateData.updatedAt,
    });
    affectedClassCount++;
    affectedClassIds.push(classDoc.id);
  }

  if (affectedClassCount > 0) {
    await batch.commit();
  }

  return { affectedClassCount, affectedClassIds };
}

export async function extendActiveClassesForSystemHolidays(
  db: DocumentStore,
  systemHolidays: string[]
) {
  return (await extendActiveClassesForSystemHolidaysDetailed(db, systemHolidays))
    .affectedClassCount;
}

export function getStatus(value: unknown): ClassStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as ClassStatus)
    ? (value as ClassStatus)
    : 'active';
}

export function requireStatus(value: unknown): ClassStatus {
  if (typeof value !== 'string' || !VALID_STATUSES.includes(value as ClassStatus)) {
    throw withStatus('Invalid or missing status value', 400);
  }
  return value as ClassStatus;
}

export function hasCredentials(credentials: StudentCredentialDoc) {
  return STUDENT_CREDENTIAL_FIELDS.some((field) => credentials[field] !== undefined);
}

// `copyStudentAuthFlags` and `copyStudentCredentialsInBatch` were deleted with
// the clone-based promotion path. They existed to duplicate a student's login
// onto a second profile document, which is how one family ended up able to sign
// in to two records holding different halves of their money. Progression keeps
// the same profile, so there is nothing left to copy — and leaving the helpers
// behind would mean one import statement could bring the behaviour back.

export function buildClassPayload(body: Record<string, unknown>, teacherId: string) {
  const name = getString(body, 'name');
  if (!name) throw new Error('Missing class name');
  if (!teacherId) throw new Error('Missing teacherId');

  const daysOfWeekRaw = body.daysOfWeek;
  const daysOfWeek = Array.isArray(daysOfWeekRaw)
    ? daysOfWeekRaw.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];

  const weeklySessions = normalizeWeeklySessions(body.weeklySessions);
  const derivedDaysOfWeek =
    weeklySessions.length > 0 ? weeklySessions.map((session) => session.dayOfWeek) : daysOfWeek;
  const firstWeeklySession = weeklySessions[0];

  const payload: Record<string, unknown> = {
    name,
    schedule: firstWeeklySession
      ? scheduleFromWeeklySession(firstWeeklySession)
      : getString(body, 'schedule'),
    daysOfWeek: derivedDaysOfWeek,
    description: getString(body, 'description'),
    startDate: getString(body, 'startDate'),
    endDate: getString(body, 'endDate'),
    startTime: firstWeeklySession ? firstWeeklySession.startTime : getString(body, 'startTime'),
    room: getString(body, 'room'),
    teacherId,
    status: getStatus(body.status),
    salaryPerSession: getNumber(body, 'salaryPerSession'),
    tuitionFee: getNumber(body, 'tuitionFee'),
    updatedAt: FieldValue.serverTimestamp(),
    ...(weeklySessions.length > 0 ? { weeklySessions } : {}),
  };

  if (body.grade !== undefined && body.grade !== null && body.grade !== '') {
    const grade = Number(body.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 12) throw new Error('Invalid grade');
    payload.grade = grade;
  }

  return payload;
}

export function getLedgerClassBatchSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LEDGER_CLASS_BATCH_SIZE;
  const integer = Math.trunc(parsed);
  if (integer < 1) return DEFAULT_LEDGER_CLASS_BATCH_SIZE;
  return Math.min(integer, MAX_LEDGER_CLASS_BATCH_SIZE);
}

export async function ensureUniqueClassName(db: DocumentStore, name: string, currentClassId?: string) {
  const snap = await db.collection('classes').where('name', '==', name).get();
  const isDuplicate = snap.docs.some((docSnap) => docSnap.id !== currentClassId);
  if (isDuplicate) throw withStatus('Class already exists', 409);
}

export async function assertClassWriteAccess(
  classData: Record<string, unknown>,
  userId: string,
  userRole: string
) {
  if (!canManageAcademicRecords(userRole) && classData.teacherId !== userId) {
    throw withStatus('Not authorized for this class', 403);
  }
}

export async function syncEvaluationDates(db: DocumentStore, classId: string, newEndDate: string) {
  const evalsSnap = await db.collection('evaluations').where('classId', '==', classId).get();
  if (evalsSnap.empty) return 0;

  const batch = db.batch();
  evalsSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { date: newEndDate, updatedAt: FieldValue.serverTimestamp() });
  });
  await batch.commit();
  return evalsSnap.size ?? evalsSnap.docs.length;
}

function getIsoDateText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = value.trim().slice(0, 10);
  return parseIsoDateOnly(date) ? date : '';
}

function isCurrentCourseEvaluation(
  evaluation: Record<string, unknown>,
  classData: Record<string, unknown>
) {
  const termId = getString(evaluation, 'termId');
  if (termId && termId !== 'current') return false;
  if (termId === 'current') return true;

  const classStart = getString(classData, 'startDate');
  const classEnd = getString(classData, 'endDate');
  const termStart = getString(evaluation, 'termStart');
  const termEnd = getString(evaluation, 'termEnd');
  if (termStart || termEnd) return termStart === classStart && (!classEnd || termEnd === classEnd);

  const existingTerms = Array.isArray(classData.terms) ? classData.terms : [];
  if (existingTerms.length === 0) return true;

  const evaluationDate =
    getIsoDateText(evaluation.date) ||
    getIsoDateText(evaluation.createdAt) ||
    getIsoDateText(evaluation.updatedAt);
  return Boolean(classStart && evaluationDate && evaluationDate >= classStart);
}

export async function archiveCurrentCourseEvaluations(
  db: DocumentStore,
  classId: string,
  classData: Record<string, unknown>,
  archivedTerm: { id: string; startDate: string; endDate: string }
) {
  const evalsSnap = await db.collection('evaluations').where('classId', '==', classId).get();
  if (evalsSnap.empty) return 0;

  const docsToArchive = evalsSnap.docs.filter((doc) => {
    const data = doc.data() || {};
    // Already archived by this same operation: skip so a retry is idempotent.
    if (data.termId === archivedTerm.id) return false;
    // Never re-home an evaluation that belongs to some other archived term.
    // "current" is the placeholder for the not-yet-archived active term, not a
    // real term id, so it must not be treated as "already archived elsewhere".
    if (data.termId && data.termId !== 'current') return false;
    return isCurrentCourseEvaluation(data, classData);
  });
  if (docsToArchive.length === 0) return 0;

  for (let index = 0; index < docsToArchive.length; index += 450) {
    const batch = db.batch();
    docsToArchive.slice(index, index + 450).forEach((doc) => {
      const updateData: Record<string, unknown> = {
        termId: archivedTerm.id,
        termStart: archivedTerm.startDate,
        termEnd: archivedTerm.endDate,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (archivedTerm.endDate) updateData.date = archivedTerm.endDate;
      batch.update(doc.ref, updateData);
    });
    await batch.commit();
  }

  return docsToArchive.length;
}

export async function updateStudentsAndLinkedUsers(
  db: DocumentStore,
  studentDocs: Array<AppDocumentStore.QueryDocumentSnapshot>,
  studentPatch: Record<string, unknown>,
  userPatch: Record<string, unknown>
) {
  for (let index = 0; index < studentDocs.length; index += STUDENT_PROJECTION_SYNC_BATCH_SIZE) {
    const chunk = studentDocs.slice(index, index + STUDENT_PROJECTION_SYNC_BATCH_SIZE);
    const studentDocIds = chunk.map((docSnap) => docSnap.id);
    const usersSnap = await db.collection('users').where('studentId', 'in', studentDocIds).get();
    const batch = db.batch();

    chunk.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        ...studentPatch,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    usersSnap.docs.forEach((userDoc) => {
      batch.update(userDoc.ref, {
        ...userPatch,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    applyClassStudentCountDeltas(
      batch,
      db,
      chunk.map((docSnap) => ({
        before: docSnap.data(),
        after: { ...docSnap.data(), ...studentPatch },
      }))
    );
    await batch.commit();
  }
  return { updatedStudents: studentDocs.length };
}

export type ClassPageOptions = {
  classIds?: string[];
  enrollmentIds?: string[];
  cursor?: string;
  batchSize?: number;
  mode?: 'preview' | 'apply';
};

export async function loadClassPage(
  db: DocumentStore,
  options: ClassPageOptions
): Promise<{
  classSnaps: Array<AppDocumentStore.DocumentSnapshot>;
  processedClasses: number;
  cursor: string | null;
  hasMore: boolean;
  batchSize: number;
}> {
  const batchSize = getLedgerClassBatchSize(options.batchSize);
  const requestedClassIds = options.classIds?.filter(Boolean) || [];

  if (requestedClassIds.length > 0) {
    const startIndex = options.cursor ? requestedClassIds.indexOf(options.cursor) + 1 : 0;
    const safeStartIndex = Math.max(0, startIndex);
    const pageClassIds = requestedClassIds.slice(safeStartIndex, safeStartIndex + batchSize);
    const classSnaps = await Promise.all(
      pageClassIds.map((classId) => db.collection('classes').doc(classId).get())
    );
    return {
      classSnaps,
      processedClasses: pageClassIds.length,
      cursor: pageClassIds.length ? pageClassIds[pageClassIds.length - 1] : null,
      hasMore: safeStartIndex + batchSize < requestedClassIds.length,
      batchSize,
    };
  }

  let classesQuery = db.collection('classes').orderBy(FieldPath.documentId());
  if (options.cursor) classesQuery = classesQuery.startAfter(options.cursor);
  const classesSnap = await classesQuery.limit(batchSize + 1).get();
  const classSnaps = classesSnap.docs.slice(0, batchSize);
  return {
    classSnaps,
    processedClasses: classSnaps.length,
    cursor: classSnaps.length ? classSnaps[classSnaps.length - 1].id : null,
    hasMore: classesSnap.docs.length > batchSize,
    batchSize,
  };
}

export async function generateCourseFeeLedgers(db: DocumentStore, input?: string[] | ClassPageOptions) {
  const options: ClassPageOptions = Array.isArray(input) ? { classIds: input } : input || {};
  if (options.enrollmentIds) {
    if (options.enrollmentIds.length === 0 || options.enrollmentIds.length > 100) {
      throw withStatus('enrollmentIds must contain between 1 and 100 ids', 400);
    }
    if (options.classIds?.length) throw withStatus('classIds and enrollmentIds are mutually exclusive', 400);

    // This branch writes as it walks and has no planning stage. Accepting a
    // preview flag here would write for real while the handler skips the audit,
    // the summary rebuild and the realtime event.
    if (options.mode === 'preview') {
      throw withStatus('preview mode is not supported with enrollmentIds', 400);
    }

    const pendingWrites: WriteRequest[] = [];
    const skipped: Array<{ enrollmentId: string; reason: string }> = [];

    for (const enrollmentId of [...new Set(options.enrollmentIds)]) {
      const enrollmentSnap = await db
        .collection('student_course_enrollments')
        .doc(enrollmentId)
        .get();
      if (!enrollmentSnap.exists) {
        skipped.push({ enrollmentId, reason: 'enrollment_not_found' });
        continue;
      }
      let enrollment;
      try {
        enrollment = readStoredStudentCourseEnrollment(enrollmentSnap as never);
      } catch {
        skipped.push({ enrollmentId, reason: 'enrollment_invalid' });
        continue;
      }
      const [studentSnap, classSnap] = await Promise.all([
        db.collection('students').doc(enrollment.studentId).get(),
        db.collection('classes').doc(enrollment.classId).get(),
      ]);
      if (!studentSnap.exists) {
        skipped.push({ enrollmentId, reason: 'student_not_found' });
        continue;
      }
      if (!classSnap.exists) {
        skipped.push({ enrollmentId, reason: 'class_not_found' });
        continue;
      }

      // Reuse the same planner the whole-center branch uses, on a single
      // enrollment, so the tuple rule cannot drift between the two paths.
      const classPlan = planClassLedgers({
        classId: enrollment.classId,
        classData: (classSnap.data() || {}) as Record<string, unknown>,
        enrollments: [enrollment],
        ledgers: (
          await db
            .collection('course_fee_ledgers')
            .where('classId', '==', enrollment.classId)
            .get()
        ).docs.map((docSnap) => ({
          id: docSnap.id,
          studentId: docSnap.data()?.studentId,
          termStart: docSnap.data()?.termStart,
        })),
      });

      if (classPlan.skipReason) {
        skipped.push({
          enrollmentId,
          reason: classPlan.skipReason === 'tuition_not_configured'
            ? 'tuition_not_configured'
            : classPlan.skipReason,
        });
        continue;
      }
      if (classPlan.creates.length === 0) {
        // No summary rebuild here: this student's ledgers did not change.
        skipped.push({ enrollmentId, reason: 'ledger_exists' });
        continue;
      }
      pendingWrites.push({ classId: enrollment.classId, ledger: classPlan.creates[0] });
    }

    const written = await writeCourseFeeLedgers(db, pendingWrites);

    return {
      mode: 'apply' as const,
      createdCount: written.createdCount,
      skippedDuplicates: skipped.filter((item) => item.reason === 'ledger_exists').length,
      skippedClasses: 0,
      totalAmount: written.createdAmount,
      plan: [] as ClassLedgerPlan[],
      duplicateLedgers: [] as Array<{
        classId: string;
        studentId: string;
        termStart: string;
        ledgerIds: string[];
      }>,
      errors: written.errors,
      skipped,
      affectedStudentIds: written.affectedStudentIds,
      processedClasses: 0,
      cursor: null,
      hasMore: false,
      batchSize: options.batchSize || 100,
    };
  }

  const mode = options.mode === 'preview' ? 'preview' : 'apply';
  const classPage = await loadClassPage(db, options);

  let skippedDuplicates = 0;
  let skippedClasses = 0;
  let plannedAmount = 0;
  const plan: ClassLedgerPlan[] = [];
  const duplicateLedgers: Array<{
    classId: string;
    studentId: string;
    termStart: string;
    ledgerIds: string[];
  }> = [];
  const errors: Array<{ classId: string; message: string }> = [];
  const pendingWrites: WriteRequest[] = [];

  // Read and decide for the whole page first; writing happens afterwards so a
  // failed commit cannot be mistaken for created work.
  for (const classSnap of classPage.classSnaps) {
    const classId = classSnap.id;
    try {
      const classData = classSnap.exists
        ? ((classSnap.data() || {}) as Record<string, unknown>)
        : null;

      // Students come from enrollments, never from `students.classId`: that
      // field is duplicated for promoted students and drifts after transfers.
      const [enrollmentsSnap, ledgersSnap] = await Promise.all([
        db.collection('student_course_enrollments').where('classId', '==', classId).get(),
        db.collection('course_fee_ledgers').where('classId', '==', classId).get(),
      ]);

      const enrollments = enrollmentsSnap.docs.flatMap((docSnap) => {
        try {
          return [readStoredStudentCourseEnrollment(docSnap)];
        } catch {
          errors.push({ classId, message: `invalid enrollment ${docSnap.id}` });
          return [];
        }
      });

      const classPlan = planClassLedgers({
        classId,
        classData,
        enrollments,
        ledgers: ledgersSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          studentId: docSnap.data()?.studentId,
          termStart: docSnap.data()?.termStart,
        })),
      });

      plan.push(classPlan);
      skippedDuplicates += classPlan.alreadyExists;
      if (classPlan.skipReason) skippedClasses += 1;
      for (const duplicate of classPlan.duplicates) {
        duplicateLedgers.push({ classId, ...duplicate });
      }
      for (const create of classPlan.creates) {
        plannedAmount += create.amount;
        pendingWrites.push({ classId, ledger: create });
      }
    } catch (error) {
      errors.push({ classId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  // createdCount and totalAmount must describe the same set. On apply that is
  // whatever committed; on preview it is the whole plan.
  const written =
    mode === 'apply'
      ? await writeCourseFeeLedgers(db, pendingWrites)
      : {
          createdCount: pendingWrites.length,
          createdAmount: plannedAmount,
          affectedStudentIds: [],
          errors: [],
        };
  errors.push(...written.errors);

  return {
    mode,
    createdCount: written.createdCount,
    skippedDuplicates,
    skippedClasses,
    totalAmount: written.createdAmount,
    plan,
    duplicateLedgers,
    errors,
    processedClasses: classPage.processedClasses,
    cursor: classPage.cursor,
    hasMore: classPage.hasMore,
    batchSize: classPage.batchSize,
    affectedStudentIds: written.affectedStudentIds,
  };
}

export type StudentCountSummary = {
  total: number;
  active: number;
  trial: number;
  onLeave: number;
  dropped: number;
  promoted: number;
};

export function summarizeStudentCounts(
  studentDocs: Array<AppDocumentStore.QueryDocumentSnapshot>
): StudentCountSummary {
  const summary: StudentCountSummary = {
    total: studentDocs.length,
    active: 0,
    trial: 0,
    onLeave: 0,
    dropped: 0,
    promoted: 0,
  };
  for (const studentDoc of studentDocs) {
    const student = studentDoc.data();
    if (student.studentLifecycle === 'trial') {
      summary.trial++;
    }
    if (student.enrollmentStatus === 'on_leave') {
      summary.onLeave++;
    } else if (student.enrollmentStatus === 'dropped') {
      summary.dropped++;
    } else if (student.enrollmentStatus === 'promoted') {
      summary.promoted++;
    } else {
      summary.active++;
    }
  }
  return summary;
}

export async function rebuildStudentCounts(db: DocumentStore, options: ClassPageOptions) {
  const classPage = await loadClassPage(db, options);
  const batch = db.batch();
  let updatedClasses = 0;

  for (const classSnap of classPage.classSnaps) {
    if (!classSnap.exists) continue;
    const studentsSnap = await db.collection('students').where('classId', '==', classSnap.id).get();
    batch.update(classSnap.ref, {
      studentCounts: summarizeStudentCounts(studentsSnap.docs),
      updatedAt: FieldValue.serverTimestamp(),
    });
    updatedClasses++;
  }

  if (updatedClasses > 0) await batch.commit();
  return {
    updatedClasses,
    processedClasses: classPage.processedClasses,
    cursor: classPage.cursor,
    hasMore: classPage.hasMore,
    batchSize: classPage.batchSize,
  };
}

export async function writeClassAudit(
  req: ApiRequest,
  db: DocumentStore,
  user: { uid: string },
  userInfo: { role: string; name: string },
  action: AuditAction,
  documentId: string,
  changes?: Record<string, { before: unknown; after: unknown }>,
  metadata?: Record<string, unknown>
) {
  await writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action,
    collection: 'classes',
    documentId,
    changes,
    metadata,
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
  });
}
