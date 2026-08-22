import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { runStudentIdentityMutationTransaction } from '../lib/maintenance/studentIdentityMutationTransaction.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { getDb, verifyAuthContext } from '../lib/auth/verifyAuth.js';
import { enforceRateLimit } from '../lib/auth/rateLimit.js';
import { writeRequiredAuditLog, getClientIp } from '../lib/logging/auditLog.js';
import { assertStudentInClass } from '../lib/auth/authz.js';
import {
  validateBody,
  attendanceToggleSchema,
  attendanceCycleSchema,
  attendanceBulkToggleSchema,
} from '../lib/validation/validations.js';
import { normalizeBody, getString, getStatusCode } from '../lib/http/helpers.js';
import { assertTeacherClassAccess } from '../lib/services/classService.js';
import { commitWriteOperationsInChunks } from '../lib/documentStore/batchWrites.js';
import { refreshTrialReviewStatus } from '../lib/admissions/trial.js';
import { touchRealtimeEvent } from '../lib/realtime/events.js';
import { isFutureVietnamDate, isScheduledClassDate } from '../../../shared/classSchedule.js';
import {
  getEffectiveTeacherIdForSession,
  type TeacherAttendanceStatus,
} from '../../../shared/teacherAttendance.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';
import {
  resolveAttendanceEligibilityBatch,
  AttendanceEligibilityError,
} from '../lib/attendance/sessionEligibility.js';
import { buildClassTerms } from '../../../shared/studentEnrollmentTimeline.js';

type AttendanceStatus = 'present' | 'absent' | 'late';

function getBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  return typeof value === 'boolean' ? value : undefined;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function getVietnamTodayStr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function attendanceValidationError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertAttendanceDateNotFuture(date: string) {
  if (!isIsoDate(date)) throw attendanceValidationError('Invalid attendance date');
  if (date > getVietnamTodayStr()) {
    throw attendanceValidationError('Cannot write attendance for a future date');
  }
}

function assertAttendanceDateWithinClassRange(
  classId: string,
  date: string,
  classData: AppDocumentStore.DocumentData
) {
  const terms = buildClassTerms({ id: classId, ...classData });
  if (
    terms.some(
      (term) => date >= term.startDate && (!term.endDate || date <= term.endDate)
    )
  ) {
    return;
  }
  if (terms.length > 0) {
    throw attendanceValidationError('Attendance date is outside the class course terms');
  }

  // Legacy classes without a buildable term retain the original range guard.
  const startDate = String(classData.startDate || classData.courseStartDate || '');
  const endDate = String(classData.endDate || classData.courseEndDate || '');
  if (startDate && isIsoDate(startDate) && date < startDate) {
    throw attendanceValidationError('Attendance date is before the class start date');
  }
  if (endDate && isIsoDate(endDate) && date > endDate) {
    throw attendanceValidationError('Attendance date is after the class end date');
  }
}

function teacherAttendanceApiError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertTeacherAttendanceMarkRole(role: string) {
  if (role !== 'admin' && role !== 'office') {
    throw teacherAttendanceApiError('Only admin or office can mark teacher attendance', 403);
  }
}

async function resolveSubstituteTeacherId(
  db: DocumentStore,
  classId: string,
  date: string
): Promise<string> {
  const snap = await db
    .collection('substitute_requests')
    .where('classId', '==', classId)
    .where('date', '==', date)
    .where('status', '==', 'accepted')
    .limit(1)
    .get();
  return snap.empty ? '' : String(snap.docs[0].data().substituteTeacherId || '');
}

function getClassScheduleInput(classData: Record<string, unknown>) {
  return {
    startDate: String(classData.startDate || ''),
    endDate: String(classData.endDate || ''),
    daysOfWeek: Array.isArray(classData.daysOfWeek)
      ? classData.daysOfWeek.filter((day): day is number => Number.isInteger(day))
      : [],
  };
}

async function handleTeacherAttendanceMark(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  assertTeacherAttendanceMarkRole(role);

  const body = normalizeBody(req.body);
  const classId = getString(body, 'classId');
  const date = getString(body, 'date');
  const status = getString(body, 'status') as TeacherAttendanceStatus;
  const note = getString(body, 'note');

  if (!classId || !isIsoDate(date) || !['present', 'absent'].includes(status)) {
    throw teacherAttendanceApiError('Invalid teacher attendance payload');
  }
  if (isFutureVietnamDate(date)) {
    throw teacherAttendanceApiError('Cannot mark teacher attendance for a future date');
  }

  const classRef = db.collection('classes').doc(classId);
  const sessionRef = db.collection('class_sessions').doc(`${classId}_${date}`);
  const substituteTeacherId = await resolveSubstituteTeacherId(db, classId, date);

  let responseStatus = 200;
  let auditMetadata: Record<string, unknown> = {};

  await db.runTransaction(async (tx) => {
    const [classSnap, sessionSnap] = await Promise.all([tx.get(classRef), tx.get(sessionRef)]);
    if (!classSnap.exists) throw teacherAttendanceApiError('Class not found', 404);

    const classData = classSnap.data() || {};
    const sessionData = sessionSnap.exists ? sessionSnap.data() || {} : {};
    const sessionStatus = String(sessionData.status || 'taught');

    if (sessionStatus === 'cancelled') {
      throw teacherAttendanceApiError('Cannot mark teacher attendance for a cancelled session');
    }
    const isScheduledDate = isScheduledClassDate(getClassScheduleInput(classData), date);
    if (!sessionSnap.exists && !isScheduledDate) {
      throw teacherAttendanceApiError('Teacher attendance date is not a scheduled class date');
    }
    if (sessionSnap.exists && sessionStatus !== 'makeup' && !isScheduledDate) {
      throw teacherAttendanceApiError('Teacher attendance date is not a scheduled class date');
    }

    const teacherId = getEffectiveTeacherIdForSession({
      acceptedSubstituteTeacherId: substituteTeacherId,
      sessionTeacherId: sessionData.teacherId,
      classTeacherId: classData.teacherId,
    });
    if (!teacherId) {
      throw teacherAttendanceApiError('Class has no teacher assigned');
    }
    const now = new Date().toISOString();
    const teacherAttendanceUpdate = {
      teacherId,
      teacherAttendanceStatus: status,
      teacherAttendanceMarkedBy: uid,
      teacherAttendanceMarkedByRole: role,
      teacherAttendanceMarkedAt: now,
      teacherAttendanceNote: note || '',
      teacherAttendanceSource: 'office_admin',
      updatedAt: now,
    };

    auditMetadata = {
      classId,
      teacherId,
      date,
      previousTeacherAttendanceStatus: sessionData.teacherAttendanceStatus || null,
      teacherAttendanceStatus: status,
      notePresent: Boolean(note),
    };

    if (sessionSnap.exists) {
      tx.update(sessionRef, teacherAttendanceUpdate);
      responseStatus = 200;
      return;
    }

    tx.set(
      sessionRef,
      {
        classId,
        teacherId,
        date,
        status: 'taught',
        salaryPerSession: Number(classData.salaryPerSession || 0),
        createdAt: now,
        ...teacherAttendanceUpdate,
      },
      { merge: true }
    );
    responseStatus = 201;
  });

  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: responseStatus === 201 ? 'create' : 'update',
      collection: 'class_sessions',
      documentId: `${classId}_${date}`,
      metadata: auditMetadata,
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );
  await Promise.all([
    touchRealtimeEvent('teacher-attendance'),
    touchRealtimeEvent('payroll'),
  ]);

  return res.status(responseStatus).json({ success: true, id: `${classId}_${date}`, status });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = String(req.query.action || '');
    const resource = String(req.query.resource || '');

    // See `students/[action].ts`: early refusal only, the transactions still
    // re-read maintenance before writing.
    if (
      await guardStudentIdentityRouteMutation(getDb, res, {
        surface: 'attendance',
        resource: resource ? resource : undefined,
        action,
        req,
      })
    )
      return;

    if (resource === 'teacher-attendance') {
      const verified = await verifyAuthContext(req, res, ['admin', 'office']);
      if (!verified) return;
      const db = getDb();
      const { uid } = verified.context;
      const role = verified.context.role;

      if (action === 'mark') return await handleTeacherAttendanceMark(req, res, db, uid, role);
      return res.status(404).json({ success: false, error: 'Unknown teacher attendance action' });
    }

    // Office is an academic-records manager (canManageAcademicRecords) and the UI
    // renders the attendance tab interactively for it, so it must clear this gate
    // to mark student attendance — assertTeacherClassAccess then authorizes the class.
    const verified = await verifyAuthContext(req, res, ['admin', 'teacher', 'office']);
    if (!verified) return;

    const db = getDb();
    const { uid } = verified.context;
    const role = verified.context.role;
    if (
      req.method !== 'GET' &&
      !(await enforceRateLimit(db, req, res, {
        scope: 'attendance_mutation',
        uid,
        action,
        maxAttempts: 240,
        windowMs: 60 * 1000,
        message: 'Too many attendance requests',
      }))
    ) {
      return;
    }

    switch (action) {
      case 'toggle':
        return await handleToggle(req, res, db, uid, role);
      case 'bulk-toggle':
        return await handleBulkToggle(req, res, db, uid, role);
      case 'cycle':
        return await handleCycle(req, res, db, uid, role);
      case 'update-detail':
        return await handleUpdateDetail(req, res, db, uid, role);
      case 'toggle-permission':
        return await handleTogglePermission(req, res, db, uid, role);
      case 'delete-record':
        return await handleDeleteRecord(req, res, db, uid, role);
      case 'delete-dates':
        return await handleDeleteDates(req, res, db, uid, role);
      default:
        return res.status(404).json({ success: false, error: 'Unknown attendance action' });
    }
  } catch (err) {
    console.error(`[Attendance/${req.query.action}] Error:`, err);
    if (err instanceof AttendanceEligibilityError) {
      return res.status(err.statusCode).json({
        success: false,
        errorCode: err.errorCode,
        eligibility: err.eligibility,
        error: err.message,
      });
    }
    const status = getStatusCode(err, 500);
    return res.status(status).json({
      success: false,
      errorCode: status >= 500 ? 'internal_error' : 'request_error',
      error:
        status >= 500
          ? 'Attendance request failed'
          : err instanceof Error
            ? err.message
            : 'Attendance request failed',
    });
  }
}

function resolveClassTermForDate(
  classId: string,
  classData: Record<string, unknown>,
  date: string
) {
  const terms = buildClassTerms({ id: classId, ...classData });
  return terms.find((t) => date >= t.startDate && (!t.endDate || date <= t.endDate)) ?? null;
}

function isTrialStudent(student: Record<string, unknown>): boolean {
  return String(student.studentLifecycle || '') === 'trial';
}

async function refreshTrialReviewStatusIfNeeded(
  db: DocumentStore,
  studentId: string,
  student: Record<string, unknown>,
  actor: { uid: string; role: string }
) {
  if (!isTrialStudent(student)) return { updated: false, trialSessionCount: 0 };
  return refreshTrialReviewStatus(db, studentId, actor);
}

async function handleToggle(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const body = normalizeBody(req.body);
  const validation = validateBody(attendanceToggleSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const classId = getString(body, 'classId');
  const studentId = getString(body, 'studentId');
  const date = getString(body, 'date');
  const status = getString(body, 'status') as AttendanceStatus;
  const eligibilityOverride = Boolean(body.eligibilityOverride);
  const overrideReason =
    typeof body.overrideReason === 'string' ? body.overrideReason.trim() : undefined;

  assertAttendanceDateNotFuture(date);
  const classData = await assertTeacherClassAccess(db, classId, uid, role);
  assertAttendanceDateWithinClassRange(classId, date, classData);

  const studentSnap = await db.collection('students').doc(studentId).get();
  if (!studentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }
  const student = studentSnap.data() || {};
  const term = resolveClassTermForDate(classId, classData, date);
  const resolutionMap = await resolveAttendanceEligibilityBatch(db, {
    classId,
    termStart: term?.startDate ?? null,
    termEnd: term?.endDate ?? null,
    date,
    studentsById: new Map([[studentId, { id: studentId, ...student }]]),
  });
  const resolution = resolutionMap.get(studentId);
  if (!resolution?.hasClassMembership) {
    return res.status(400).json({ success: false, error: 'Student does not belong to this class' });
  }

  const eligibility = resolution.eligibility;
  const docId = `${classId}_${studentId}_${date}`;
  const docRef = db.collection('attendance').doc(docId);
  const result = await runStudentIdentityMutationTransaction(
    db,
    { actorId: uid, operation: 'attendance:toggle' },
    async (tx) => {
      const existingSnap = await tx.get(docRef);
      const existingReal = isRealAttendanceSnapshot(existingSnap);
      if (!existingReal && eligibility !== 'eligible' && !eligibilityOverride) {
        throw new AttendanceEligibilityError(
          eligibility as Exclude<typeof eligibility, 'eligible'>
        );
      }
      if (eligibilityOverride && (existingReal || eligibility === 'eligible')) {
        throw attendanceValidationError('Attendance eligibility override is not required');
      }

      if (existingReal) {
        tx.update(docRef, { status, updatedAt: FieldValue.serverTimestamp() });
        return { created: false, action: 'update' as const };
      }

      tx.set(
        docRef,
        {
          classId,
          studentId,
          date,
          status,
          teacherId: classData.teacherId || uid,
          ...attendanceRestoreFields(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { created: true, action: 'create' as const };
    }
  );
  await refreshTrialReviewStatusIfNeeded(db, studentId, student, { uid, role });
  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: result.action,
      collection: 'attendance',
      documentId: docId,
      metadata: {
        classId,
        studentId,
        date,
        status,
        ...(eligibilityOverride && result.created
          ? { eligibilityOverride: true, overrideReason, eligibility }
          : {}),
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );
  await Promise.all([touchRealtimeEvent('parent-dashboard')]);
  return res.status(result.created ? 201 : 200).json({ success: true, id: docId, status });
}

const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'late'];

function isRealAttendanceSnapshot(snapshot: {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}): boolean {
  return snapshot.exists && snapshot.data()?.isVoided !== true;
}

function attendanceRestoreFields() {
  return {
    isVoided: false,
    voidedAt: FieldValue.delete(),
    voidedBy: FieldValue.delete(),
    voidReason: FieldValue.delete(),
  };
}

async function handleCycle(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const body = normalizeBody(req.body);
  const validation = validateBody(attendanceCycleSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const classId = getString(body, 'classId');
  const studentId = getString(body, 'studentId');
  const date = getString(body, 'date');

  assertAttendanceDateNotFuture(date);
  const classData = await assertTeacherClassAccess(db, classId, uid, role);
  assertAttendanceDateWithinClassRange(classId, date, classData);

  const studentSnap = await db.collection('students').doc(studentId).get();
  if (!studentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }
  const student = studentSnap.data() || {};
  const term = resolveClassTermForDate(classId, classData, date);
  const resolutionMap = await resolveAttendanceEligibilityBatch(db, {
    classId,
    termStart: term?.startDate ?? null,
    termEnd: term?.endDate ?? null,
    date,
    studentsById: new Map([[studentId, { id: studentId, ...student }]]),
  });
  const resolution = resolutionMap.get(studentId);
  if (!resolution?.hasClassMembership) {
    return res.status(400).json({ success: false, error: 'Student does not belong to this class' });
  }

  const eligibility = resolution.eligibility;
  const docId = `${classId}_${studentId}_${date}`;
  const docRef = db.collection('attendance').doc(docId);
  const result = await runStudentIdentityMutationTransaction(
    db,
    { actorId: uid, operation: 'attendance:cycle' },
    async (tx) => {
      const existingSnap = await tx.get(docRef);
      const existingReal = isRealAttendanceSnapshot(existingSnap);
      if (!existingReal && eligibility !== 'eligible') {
        throw new AttendanceEligibilityError(
          eligibility as Exclude<typeof eligibility, 'eligible'>
        );
      }

      const currentStatus = existingReal
        ? (existingSnap.data()?.status as AttendanceStatus)
        : null;
      const nextStatus: AttendanceStatus = !currentStatus
        ? 'present'
        : STATUS_CYCLE[(STATUS_CYCLE.indexOf(currentStatus) + 1) % STATUS_CYCLE.length];

      if (existingReal) {
        tx.update(docRef, { status: nextStatus, updatedAt: FieldValue.serverTimestamp() });
      } else {
        tx.set(
          docRef,
          {
            classId,
            studentId,
            date,
            status: nextStatus,
            teacherId: classData.teacherId || uid,
            ...attendanceRestoreFields(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return {
        created: !existingReal,
        previousStatus: currentStatus,
        status: nextStatus,
        action: existingReal ? ('update' as const) : ('create' as const),
      };
    }
  );

  await refreshTrialReviewStatusIfNeeded(db, studentId, student, { uid, role });
  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: result.action,
      collection: 'attendance',
      documentId: docId,
      metadata: {
        classId,
        studentId,
        date,
        previousStatus: result.previousStatus,
        status: result.status,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );

  await Promise.all([touchRealtimeEvent('parent-dashboard')]);
  return res
    .status(result.created ? 201 : 200)
    .json({ success: true, id: docId, status: result.status });
}

async function handleBulkToggle(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const validation = validateBody(attendanceBulkToggleSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }

  const classId = getString(body, 'classId');
  const date = getString(body, 'date');
  const status = getString(body, 'status') as AttendanceStatus;
  const studentIds = [
    ...new Set((body.studentIds as string[]).map((id) => id.trim()).filter(Boolean)),
  ];

  assertAttendanceDateNotFuture(date);
  const classData = await assertTeacherClassAccess(db, classId, uid, role);
  assertAttendanceDateWithinClassRange(classId, date, classData);

  const studentRefs = studentIds.map((studentId) => db.collection('students').doc(studentId));
  const studentSnaps = await db.getAll(...studentRefs);
  const studentsById = new Map<string, Record<string, unknown>>();

  studentSnaps.forEach((snap) => {
    if (snap.exists) studentsById.set(snap.id, snap.data() || {});
  });

  const missingStudentIds = studentIds.filter((studentId) => !studentsById.has(studentId));
  if (missingStudentIds.length > 0) {
    return res.status(404).json({
      success: false,
      error: 'Some students were not found',
      missingStudentIds,
    });
  }

  const term = resolveClassTermForDate(classId, classData, date);
  const resolutionMap = await resolveAttendanceEligibilityBatch(db, {
    classId,
    termStart: term?.startDate ?? null,
    termEnd: term?.endDate ?? null,
    date,
    studentsById,
  });

  const wrongClassStudentIds = studentIds.filter(
    (studentId) => !resolutionMap.get(studentId)?.hasClassMembership
  );
  if (wrongClassStudentIds.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Some students do not belong to this class',
      studentIds: wrongClassStudentIds,
    });
  }

  const updatedAt = FieldValue.serverTimestamp();
  const attendanceRefs = studentIds.map((studentId) =>
    db.collection('attendance').doc(`${classId}_${studentId}_${date}`)
  );
  const result = await runStudentIdentityMutationTransaction(
    db,
    { actorId: uid, operation: 'attendance:bulk-toggle' },
    async (tx) => {
      // DocumentStore requires all transaction reads before the first write. The
      // existing record is authoritative here: corrected enrollment metadata
      // may make the cell ineligible, but it must not make real attendance
      // impossible to edit.
      const existingSnaps = [];
      for (const ref of attendanceRefs) {
        existingSnaps.push(await tx.get(ref));
      }
      const existingByStudentId = new Map(
        studentIds.map((studentId, index) => [studentId, existingSnaps[index]] as const)
      );
      const skipped = { not_enrolled: [] as string[], on_leave: [] as string[] };
      const updatedStudentIds: string[] = [];

      studentIds.forEach((studentId, index) => {
        const eligibility = resolutionMap.get(studentId)?.eligibility ?? 'eligible';
        if (!isRealAttendanceSnapshot(existingSnaps[index]) && eligibility !== 'eligible') {
          skipped[eligibility].push(studentId);
          return;
        }
        updatedStudentIds.push(studentId);
      });

      for (const studentId of updatedStudentIds) {
        const docId = `${classId}_${studentId}_${date}`;
        const existingSnap = existingByStudentId.get(studentId)!;
        tx.set(
          db.collection('attendance').doc(docId),
          {
            classId,
            studentId,
            date,
            status,
            teacherId: String(classData.teacherId || uid),
            ...(!isRealAttendanceSnapshot(existingSnap) ? attendanceRestoreFields() : {}),
            updatedAt,
          },
          { merge: true }
        );
      }

      return { updatedStudentIds, skipped };
    }
  );

  if (result.updatedStudentIds.length === 0) {
    return res.status(200).json({
      success: true,
      updatedCount: 0,
      studentIds: [],
      status,
      skipped: result.skipped,
    });
  }

  const trialStudentIds = result.updatedStudentIds.filter((studentId) =>
    isTrialStudent(studentsById.get(studentId) || {})
  );
  await Promise.all(
    trialStudentIds.map((studentId) => refreshTrialReviewStatus(db, studentId, { uid, role }))
  );

  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: 'update',
      collection: 'attendance',
      documentId: `${classId}_${date}`,
      metadata: {
        classId,
        date,
        status,
        studentIds: result.updatedStudentIds,
        updatedCount: result.updatedStudentIds.length,
        skipped: result.skipped,
        bulk: true,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );

  await Promise.all([touchRealtimeEvent('parent-dashboard')]);

  return res.status(200).json({
    success: true,
    updatedCount: result.updatedStudentIds.length,
    studentIds: result.updatedStudentIds,
    status,
    skipped: result.skipped,
  });
}

async function getAttendanceWithAccess(db: DocumentStore, id: string, uid: string, role: string) {
  const snap = await db.collection('attendance').doc(id).get();
  if (!snap.exists) throw Object.assign(new Error('Attendance not found'), { statusCode: 404 });
  const data = snap.data() || {};
  await assertTeacherClassAccess(db, String(data.classId || ''), uid, role);
  return snap;
}

async function handleUpdateDetail(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const body = normalizeBody(req.body);
  const id = getString(body, 'attendanceId');
  if (!id) return res.status(400).json({ success: false, error: 'Missing attendanceId' });
  const snap = await getAttendanceWithAccess(db, id, uid, role);
  const minutesLate = Number(body.minutesLate || 0);
  if (!Number.isFinite(minutesLate) || minutesLate < 0 || minutesLate > 240) {
    return res.status(400).json({ success: false, error: 'Invalid minutesLate' });
  }
  await snap.ref.update({
    permission: getBoolean(body, 'permission') || false,
    minutesLate,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: 'update',
      collection: 'attendance',
      documentId: id,
      metadata: {
        action: 'update-detail',
        minutesLate,
        permission: getBoolean(body, 'permission') || false,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );
  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
  ]);
  return res.status(200).json({ success: true, id });
}

async function handleTogglePermission(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const body = normalizeBody(req.body);
  const id = getString(body, 'attendanceId');
  if (!id) return res.status(400).json({ success: false, error: 'Missing attendanceId' });
  const snap = await getAttendanceWithAccess(db, id, uid, role);
  await snap.ref.update({
    permission: getBoolean(body, 'permission') || false,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: 'update',
      collection: 'attendance',
      documentId: id,
      metadata: {
        action: 'toggle-permission',
        permission: getBoolean(body, 'permission') || false,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );
  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
  ]);
  return res.status(200).json({ success: true, id });
}

async function handleDeleteRecord(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'DELETE')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const body = normalizeBody(req.body);
  const id = getString(body, 'id') || (typeof req.query.id === 'string' ? req.query.id : '');
  if (!id) return res.status(400).json({ success: false, error: 'Missing attendance id' });
  const snap = await getAttendanceWithAccess(db, id, uid, role);
  const studentId = String(snap.data()?.studentId || '');
  await snap.ref.update({
    isVoided: true,
    voidedAt: new Date().toISOString(),
    voidedBy: uid,
    voidReason: getString(body, 'reason') || 'Voided by staff',
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (studentId) {
    await refreshTrialReviewStatus(db, studentId, { uid, role });
  }
  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: 'delete',
      collection: 'attendance',
      documentId: id,
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );
  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
  ]);
  return res.status(200).json({ success: true, id });
}

async function handleDeleteDates(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const body = normalizeBody(req.body);
  const classId = getString(body, 'classId');
  const dates = Array.isArray(body.dates)
    ? body.dates.filter((d): d is string => typeof d === 'string')
    : [];
  if (!classId || dates.length === 0)
    return res.status(400).json({ success: false, error: 'Invalid delete payload' });

  const MAX_DATES = 30;
  if (dates.length > MAX_DATES)
    return res.status(400).json({ success: false, error: `Too many dates (max ${MAX_DATES})` });

  const validDates = dates.filter((d) => isIsoDate(d));
  if (validDates.length !== dates.length)
    return res
      .status(400)
      .json({ success: false, error: 'Invalid date format (expected YYYY-MM-DD)' });

  await assertTeacherClassAccess(db, classId, uid, role);

  const refs: AppDocumentStore.DocumentReference[] = [];
  const affectedStudentIds = new Set<string>();
  for (const collectionName of ['attendance', 'class_sessions']) {
    for (let i = 0; i < validDates.length; i += 30) {
      const chunk = validDates.slice(i, i + 30);
      const snap = await db
        .collection(collectionName)
        .where('classId', '==', classId)
        .where('date', 'in', chunk)
        .get();
      snap.docs.forEach((docSnap) => {
        refs.push(docSnap.ref);
        if (collectionName === 'attendance') {
          const studentId = String(docSnap.data()?.studentId || '');
          if (studentId) affectedStudentIds.add(studentId);
        }
      });
    }
  }
  const voidedAt = new Date().toISOString();
  const voidReason = getString(body, 'reason') || 'Voided by staff';
  const count = await commitWriteOperationsInChunks(
    db,
    refs.map((ref) => ({
      type: 'update',
      ref,
      data:
        ref.parent.id === 'attendance'
          ? {
              isVoided: true,
              voidedAt,
              voidedBy: uid,
              voidReason,
              updatedAt: FieldValue.serverTimestamp(),
            }
          : {
              status: 'cancelled',
              cancelledAt: voidedAt,
              cancelledBy: uid,
              cancellationReason: voidReason,
              updatedAt: FieldValue.serverTimestamp(),
            },
    }))
  );
  const studentIdsArr = Array.from(affectedStudentIds);
  const trialChunkSize = 10;
  for (let i = 0; i < studentIdsArr.length; i += trialChunkSize) {
    const chunk = studentIdsArr.slice(i, i + trialChunkSize);
    await Promise.all(
      chunk.map((studentId) => refreshTrialReviewStatus(db, studentId, { uid, role }))
    );
  }
  await writeRequiredAuditLog(
    db,
    {
      userId: uid,
      userRole: role,
      action: 'delete',
      collection: 'attendance',
      documentId: classId,
      metadata: { dates: validDates, deletedCount: count },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    },
    'attendance_correction'
  );
  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
  ]);
  return res.status(200).json({ success: true, deletedCount: count });
}
