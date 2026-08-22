import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { canManageAcademicRecords, canManageFinance } from '../../lib/auth/permissions.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { importStudentsFromClass } from '../helpers/studentImportHelper.js';
import { assertStudentIdentityMutationAllowed } from '../../lib/maintenance/studentIdentityMaintenance.js';
import { normalizeBody, getString, getNumber, sendApiError } from '../../lib/http/helpers.js';
import {
  writeClassAudit,
  getLedgerClassBatchSize,
  generateCourseFeeLedgers,
  rebuildStudentCounts,
  parseIsoDateOnly,
  normalizeHolidayDates,
  extendActiveClassesForSystemHolidaysDetailed,
  getIsoDateDayOfWeek,
  normalizeDaysOfWeek,
  getSystemHolidays,
  buildHolidayClassUpdate,
  archiveCurrentCourseEvaluations,
} from '../helpers/classHelpers.js';
import {
  CourseClosingError,
  computeCourseClosingSnapshot,
  invalidateCourseClosingApprovals,
} from '../helpers/courseClosing.js';
import { COURSE_CLOSING_INCOMPLETE } from '../../../../shared/courseClosing.js';
import { randomUUID } from 'node:crypto';
import {
  readStoredStudentCourseEnrollment,
  resolveTermJoinedAt,
  upsertSystemEnrollment,
} from '../../lib/student/courseEnrollmentRepository.js';
import { assertValidStudentCourseEnrollment, isOpenStudentCourseEnrollmentStatus, makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ArchivedTermRecord = Record<string, unknown> & {
  id: string;
  startDate: string;
  endDate: string;
  tuitionFee?: number;
  resetOperationId?: string;
};

async function syncResetCourseEnrollments(
  db: DocumentStore,
  classId: string,
  archivedTerm: ArchivedTermRecord,
  newTerm: { startDate: string; endDate: string },
  actorId: string
): Promise<string[]> {
  const enrollmentsCollection = db.collection('student_course_enrollments');
  const studentsCollection = db.collection('students');
  if (typeof enrollmentsCollection?.where !== 'function' || typeof enrollmentsCollection?.doc !== 'function') {
    return [];
  }
  if (typeof studentsCollection?.where !== 'function') return [];
  const studentsSnapshot = await studentsCollection.where('classId', '==', classId).get();
  const affectedStudentIds: string[] = [];
  const now = new Date().toISOString();
  const today = getVietnamTodayStr(new Date(now));
  for (const studentDoc of studentsSnapshot.docs || []) {
    const student = (studentDoc.data() || {}) as Record<string, unknown>;
    const lifecycle = String(student.studentLifecycle || '');
    const enrollmentStatus = String(student.enrollmentStatus || '');
    if (lifecycle === 'archived' || ['dropped', 'completed'].includes(enrollmentStatus)) continue;
    await runStudentIdentityMutationTransaction(
      db,
      { actorId, operation: 'classes:reset-course' },
      async (tx) => {
      if (typeof (tx as unknown as { create?: unknown }).create !== 'function') return;
      const query = enrollmentsCollection.where('studentId', '==', studentDoc.id);
      const snapshot = await tx.get(query);
      const all = (snapshot.docs || []).map((doc: any) => readStoredStudentCourseEnrollment(doc));
      const newId = makeStudentCourseEnrollmentId(studentDoc.id, classId, newTerm.startDate);
      const closedAll = all.map((enrollment) => {
        if (!isOpenStudentCourseEnrollmentStatus(enrollment.status)) return enrollment;
        // The new term's own enrollment is re-opened by upsertSystemEnrollment
        // below, so closing it here is pointless on a first run and wrong on a
        // replay: it already exists with a joinedAt inside the new term, and
        // archivedTerm.endDate precedes that, breaking endedAt >= joinedAt.
        if (enrollment.id === newId) return enrollment;
        return assertValidStudentCourseEnrollment({
          ...enrollment,
          status: 'completed',
          endedAt: archivedTerm.endDate,
          statusReason: 'course_reset',
          statusChangedAt: now,
          statusChangedBy: actorId,
          updatedAt: now,
        });
      });
      for (let i = 0; i < all.length; i += 1) {
        if (closedAll[i].status !== all[i].status) {
          tx.update(enrollmentsCollection.doc(all[i].id), { ...closedAll[i], serverUpdatedAt: FieldValue.serverTimestamp() });
        }
      }
      const existing = closedAll.find((enrollment) => enrollment.id === newId) || null;
      const status = lifecycle === 'trial' ? 'trial' : enrollmentStatus === 'on_leave' ? 'on_leave' : 'active';
      await upsertSystemEnrollment(tx, db, {
        studentId: studentDoc.id,
        classId,
        termStart: newTerm.startDate,
        termEnd: newTerm.endDate,
        status: status as 'trial' | 'active' | 'on_leave',
        joinedAt: resolveTermJoinedAt(
          { termStart: newTerm.startDate, termEnd: newTerm.endDate },
          today
        ),
        actorId,
        now,
      }, { existing, all: closedAll });
    });
    affectedStudentIds.push(studentDoc.id);
  }
  return affectedStudentIds;
}

function findTermByOperationId(
  classData: Record<string, unknown>,
  operationId: string
): ArchivedTermRecord | undefined {
  const terms = Array.isArray(classData.terms) ? classData.terms : [];
  return terms.find(
    (term): term is ArchivedTermRecord =>
      Boolean(term) &&
      typeof term === 'object' &&
      (term as Record<string, unknown>).resetOperationId === operationId
  );
}

export async function handleImportStudents(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Only admins can import students' });
  }

  try {
    const body = normalizeBody(req.body);
    const sourceClassId = getString(body, 'sourceClassId');
    const targetClassId = getString(body, 'targetClassId');
    if (!sourceClassId || !targetClassId) {
      return res.status(400).json({ success: false, error: 'Missing class ids' });
    }

    const targetClass = await db.collection('classes').doc(targetClassId).get();
    if (!targetClass.exists)
      return res.status(404).json({ success: false, error: 'Class not found' });
    const targetData = targetClass.data() || {};
    const rawTargetGrade = Number(targetData.grade);
    const targetGrade =
      Number.isInteger(rawTargetGrade) && rawTargetGrade >= 1 && rawTargetGrade <= 12
        ? rawTargetGrade
        : null;
    await assertStudentIdentityMutationAllowed(db, {
      actorId: user.uid,
      operation: 'classes:import-students',
    });
    const result = await importStudentsFromClass(db, {
      sourceClassId,
      targetClassId,
      teacherId: String(targetData.teacherId || ''),
      targetGrade,
      actorId: user.uid,
      mutationOperation: 'classes:import-students',
      // Importing into an existing class is a promotion between courses, not a
      // corrective transfer: the source course is finishing for these students.
      kind: 'course_completion',
    });
    // Reported by the progression results rather than inferred from counters,
    // so a partial cohort still invalidates exactly the classes it touched.
    const affectedClassIds = result.affectedClassIds;
    const invalidatedClassIds = await invalidateCourseClosingApprovals(
      db,
      affectedClassIds,
      user.uid,
      'REQUIRED_ROSTER_CHANGED'
    );

    await writeClassAudit(req, db, user, userInfo, 'import', targetClassId, undefined, {
      sourceClassId,
      importedCount: result.importedCount,
      replayedCount: result.replayedCount,
      skippedCount: result.skippedCount,
      failures: result.failures,
      event: 'course_closing_roster_changed',
      invalidationReason: 'REQUIRED_ROSTER_CHANGED',
      affectedClassIds,
      invalidatedClassIds,
    });

    await Promise.all([
      touchRealtimeEvent('students'),
      touchRealtimeEvent('accounting-students'),
      touchRealtimeEvent('accounting-student-finance'),
      // The imported students arrive owing tuition. The Students page caches
      // ledgers for 15 minutes and only refreshes them on this channel, so
      // without the bump the debt column sits stale while the roster updates.
      ...(result.createdLedgerCount > 0 ? [touchRealtimeEvent('finance-ledger')] : []),
      ...affectedClassIds.map((affectedClassId) =>
        touchRealtimeEvent('course-closing', { targetId: affectedClassId })
      ),
    ]);

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[Classes/import-students] Error:', err);
    return sendApiError(res, err, 'Failed to import students');
  }
}

export async function handleUpdateSalary(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Only admins can update salary' });
  }

  try {
    const body = normalizeBody(req.body);
    const classId = getString(body, 'classId');
    const salaryPerSession = getNumber(body, 'salaryPerSession');
    if (!classId || salaryPerSession < 0) {
      return res.status(400).json({ success: false, error: 'Invalid salary payload' });
    }

    const classRef = db.collection('classes').doc(classId);
    const classSnap = await classRef.get();
    if (!classSnap.exists)
      return res.status(404).json({ success: false, error: 'Class not found' });
    const before = classSnap.data() || {};

    await classRef.update({ salaryPerSession, updatedAt: FieldValue.serverTimestamp() });
    await writeClassAudit(
      req,
      db,
      user,
      userInfo,
      'update',
      classId,
      { salaryPerSession: { before: before.salaryPerSession, after: salaryPerSession } },
      { className: before.name }
    );

    return res.status(200).json({ success: true, id: classId, salaryPerSession });
  } catch (err) {
    console.error('[Classes/update-salary] Error:', err);
    return sendApiError(res, err, 'Failed to update salary');
  }
}

export async function handleResetCourse(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role) && !canManageFinance(userInfo.role)) {
    return res
      .status(403)
      .json({ success: false, error: 'Only admins, office, or accounting can reset course' });
  }

  try {
    const body = normalizeBody(req.body);
    const classId = getString(body, 'classId');
    const startDate = getString(body, 'startDate');
    const endDate = getString(body, 'endDate');
    const operationId = getString(body, 'operationId');
    if (!classId || !parseIsoDateOnly(startDate) || !parseIsoDateOnly(endDate)) {
      return res.status(400).json({ success: false, error: 'Invalid reset-course payload' });
    }
    // Retry safety: the caller owns the operation identity so a timed-out
    // request can be replayed without archiving or rotating twice.
    if (!UUID_PATTERN.test(operationId)) {
      return res
        .status(400)
        .json({ success: false, error: 'reset-course requires a UUID operationId' });
    }

    const classRef = db.collection('classes').doc(classId);
    const classSnap = await classRef.get();
    if (!classSnap.exists)
      return res.status(404).json({ success: false, error: 'Class not found' });
    const before = classSnap.data() || {};

    // Look for an existing term from this same operation BEFORE evaluating the
    // current course: a successful first attempt already rotated to a fresh,
    // necessarily incomplete course.
    const replayedTerm = findTermByOperationId(before, operationId);

    const archivedTerm: ArchivedTermRecord =
      replayedTerm ??
      ({
        id: `term_${operationId}`,
        name: `Khoa ${before.startDate || ''} - ${before.endDate || ''}`,
        startDate: String(before.startDate || ''),
        endDate: String(before.endDate || ''),
        // Snapshot the outgoing schedule: `holidays` is reset below, so without
        // this the course's expected sessions become unrecoverable.
        holidays: Array.isArray(before.holidays) ? before.holidays : [],
        weeklySessions: Array.isArray(before.weeklySessions) ? before.weeklySessions : [],
        daysOfWeek: Array.isArray(before.daysOfWeek) ? before.daysOfWeek : [],
        courseId: String(before.currentCourseId || ''),
        ...(typeof before.tuitionFee === 'number' &&
        Number.isFinite(before.tuitionFee) &&
        before.tuitionFee >= 0
          ? { tuitionFee: before.tuitionFee }
          : {}),
        ...(before.courseClosing ? { courseClosing: before.courseClosing } : {}),
        resetOperationId: operationId,
      } satisfies ArchivedTermRecord);

    let newCourseId = '';
    let outgoingClassData: Record<string, unknown> = before;

    if (!replayedTerm) {
      // Guard first: no role may reset a course that is not fully closed.
      const snapshot = await computeCourseClosingSnapshot(db, classId);
      if (snapshot.status !== 'completed') {
        await writeClassAudit(
          req,
          db,
          user,
          userInfo,
          'update',
          classId,
          {},
          {
            className: before.name,
            resetCourseRejected: true,
            errorCode: COURSE_CLOSING_INCOMPLETE,
            courseId: snapshot.courseId,
            pendingEvaluationCount: snapshot.pendingEvaluationStudentIds.length,
            pendingRankCount: snapshot.pendingRankStudentIds.length,
            pendingTuitionCount: snapshot.pendingTuitionStudentIds.length,
          }
        );
        throw new CourseClosingError(
          409,
          COURSE_CLOSING_INCOMPLETE,
          'Chưa thể Reset Course: lớp chưa hoàn tất mọi thông báo kết khóa.',
          snapshot
        );
      }

      // Guard against submitting the outgoing course's own dates as the "new"
      // course: ISO date strings compare lexicographically, so this also catches
      // a new startDate that lands inside the outgoing course entirely. Runs only
      // once closing is confirmed complete, so a stale/incomplete approval still
      // reports as 409 rather than being masked by this 400.
      if (before.endDate && startDate < String(before.endDate)) {
        return res.status(400).json({
          success: false,
          error: `Ngày bắt đầu khóa mới (${startDate}) không được nhỏ hơn ngày kết thúc khóa cũ (${before.endDate})`,
        });
      }

      newCourseId = randomUUID();
      // Small transaction on the class document only. Evaluations stay outside
      // so a course with more than 500 evaluations is not a transaction problem.
      await runStudentIdentityMutationTransaction(
        db,
        { actorId: user.uid, operation: 'classes:reset-course' },
        async (transaction) => {
        const fresh = await transaction.get(classRef);
        const freshData = (fresh.data() || {}) as Record<string, unknown>;
        if (findTermByOperationId(freshData, operationId)) return;

        const recheck = await computeCourseClosingSnapshot(db, classId, { transaction });
        if (recheck.status !== 'completed') {
          throw new CourseClosingError(
            409,
            COURSE_CLOSING_INCOMPLETE,
            'Chưa thể Reset Course: lớp chưa hoàn tất mọi thông báo kết khóa.',
            recheck
          );
        }

        outgoingClassData = freshData;
        const existingTerms = Array.isArray(freshData.terms) ? freshData.terms : [];
        transaction.update(classRef, {
          startDate,
          endDate,
          terms: [...existingTerms, archivedTerm],
          holidays: [],
          currentCourseId: newCourseId,
          // Approval and exemptions never cross a course boundary.
          courseClosing: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    } else {
      newCourseId = String(before.currentCourseId || '');
    }

    const affectedStudentIds = await syncResetCourseEnrollments(
      db,
      classId,
      archivedTerm,
      { startDate, endDate },
      user.uid
    );

    // Idempotent by construction: only evaluations of the outgoing course that
    // do not yet point at this archived term are touched.
    const syncedEvaluations = await archiveCurrentCourseEvaluations(
      db,
      classId,
      { ...outgoingClassData, startDate: archivedTerm.startDate, endDate: archivedTerm.endDate },
      archivedTerm
    );
    const ledgerResult = await generateCourseFeeLedgers(db, [classId]);
    await refreshAccountingStudentSummariesAfterCommit(
      db,
      ledgerResult.affectedStudentIds || affectedStudentIds,
      'course-reset-ledgers',
      { actorId: user.uid, operation: 'classes:reset-course' }
    );

    if (!replayedTerm) {
      await writeClassAudit(
        req,
        db,
        user,
        userInfo,
        'update',
        classId,
        {
          startDate: { before: before.startDate, after: startDate },
          endDate: { before: before.endDate, after: endDate },
        },
        {
          className: before.name,
          resetCourse: true,
          operationId,
          oldCourseId: String(before.currentCourseId || ''),
          newCourseId,
          ledgerResult,
          syncedEvaluations,
        }
      );
    }

    await Promise.all([
      touchRealtimeEvent('finance-ledger'),
      touchRealtimeEvent('parent-dashboard'),
      touchRealtimeEvent('office-schedule-changed'),
      touchRealtimeEvent('course-closing', { targetId: classId }),
    ]);

    return res.status(200).json({
      success: true,
      id: classId,
      startDate,
      endDate,
      operationId,
      oldCourseId: archivedTerm.courseId,
      newCourseId,
      terms: [...(Array.isArray(before.terms) ? before.terms : []), ...(replayedTerm ? [] : [archivedTerm])],
      holidays: [],
      affectedStudentIds,
      ledgerResult,
      syncedEvaluations,
    });
  } catch (err) {
    console.error('[Classes/reset-course] Error:', err);
    return sendApiError(res, err, 'Failed to reset course');
  }
}

export async function handleGenerateLedgers(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'admin' && userInfo.role !== 'accounting') {
    return res
      .status(403)
      .json({ success: false, error: 'Only admins or accounting can generate ledgers' });
  }

  try {
    const body = normalizeBody(req.body);
    const classIds = Array.isArray(body.classIds)
      ? body.classIds.filter(
          (classId): classId is string => typeof classId === 'string' && !!classId
        )
      : undefined;
    const enrollmentIds = Array.isArray(body.enrollmentIds)
      ? body.enrollmentIds.filter((id): id is string => typeof id === 'string' && !!id)
      : undefined;
    if (classIds?.length && enrollmentIds?.length) {
      return res.status(400).json({ success: false, error: 'Provide classIds or enrollmentIds, not both' });
    }
    const cursor =
      getString(body, 'cursor') || (typeof req.query.cursor === 'string' ? req.query.cursor : '');
    const batchSize = getLedgerClassBatchSize(body.batchSize ?? req.query.batchSize);

    // A missing mode stays 'apply' for existing scripts. A present but
    // unrecognised value is rejected: silently treating a typo as 'apply'
    // would turn a dry run into a whole-center write.
    const rawMode = body.mode;
    if (rawMode !== undefined && rawMode !== 'preview' && rawMode !== 'apply') {
      return res.status(400).json({ success: false, error: 'mode must be "preview" or "apply"' });
    }
    const mode: 'preview' | 'apply' = rawMode === 'preview' ? 'preview' : 'apply';
    if (mode === 'preview' && enrollmentIds?.length) {
      return res
        .status(400)
        .json({ success: false, error: 'preview mode is not supported with enrollmentIds' });
    }

    const result = await generateCourseFeeLedgers(db, {
      classIds,
      enrollmentIds,
      cursor,
      batchSize,
      mode,
    });

    // A preview writes nothing, so there is nothing to audit, project or
    // invalidate. Skipping this is also what keeps preview cheap.
    if (mode === 'apply') {
      await writeClassAudit(req, db, user, userInfo, 'create', 'course_fee_ledgers', undefined, {
        classIds,
        enrollmentIds,
        cursor,
        ...result,
      });

      await refreshAccountingStudentSummariesAfterCommit(
        db,
        result.affectedStudentIds || [],
        'ledger-generation',
        { actorId: user.uid, operation: 'classes:generate-ledgers' }
      );

      await Promise.all([
        touchRealtimeEvent('finance-ledger'),
        touchRealtimeEvent('accounting-student-finance'),
      ]);
    }

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[Classes/generate-ledgers] Error:', err);
    return sendApiError(res, err, 'Failed to generate ledgers');
  }
}

export async function handleRebuildStudentCounts(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (userInfo.role !== 'admin') {
    return res
      .status(403)
      .json({ success: false, error: 'Only admins can rebuild student counts' });
  }

  try {
    const body = normalizeBody(req.body);
    const cursor =
      getString(body, 'cursor') || (typeof req.query.cursor === 'string' ? req.query.cursor : '');
    const batchSize = getLedgerClassBatchSize(body.batchSize ?? req.query.batchSize);
    const result = await rebuildStudentCounts(db, { cursor, batchSize });

    await writeClassAudit(req, db, user, userInfo, 'update', 'studentCounts', undefined, {
      cursor,
      ...result,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[Classes/rebuild-student-counts] Error:', err);
    return sendApiError(res, err, 'Failed to rebuild student counts');
  }
}

export async function handleSaveSettings(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (userInfo.role !== 'admin' && userInfo.role !== 'office')
    return res
      .status(403)
      .json({ success: false, error: 'Only admins or office can save settings' });

  try {
    const body = normalizeBody(req.body);
    const settingType = getString(body, 'settingType');

    if (settingType === 'holidays') {
      const rawDates = Array.isArray(body.dates) ? body.dates : [];
      if (rawDates.some((date) => typeof date !== 'string' || !parseIsoDateOnly(date.trim()))) {
        return res.status(400).json({ success: false, error: 'Invalid holiday date' });
      }
      const dates = normalizeHolidayDates(rawDates);
      await db.collection('system_settings').doc('holidays').set({ dates }, { merge: true });
      const { affectedClassCount, affectedClassIds } =
        await extendActiveClassesForSystemHolidaysDetailed(db, dates);
      const invalidatedClassIds = await invalidateCourseClosingApprovals(
        db,
        affectedClassIds,
        user.uid,
        'COURSE_DATES_CHANGED'
      );
      await writeClassAudit(
        req,
        db,
        user,
        userInfo,
        'update',
        'system_settings/holidays',
        undefined,
        {
          action: 'save-settings',
          settingType: 'holidays',
          dateCount: dates.length,
          affectedClassCount,
          affectedClassIds,
          invalidatedClassIds,
        }
      );
      await Promise.all([
        touchRealtimeEvent('office-schedule-changed'),
        ...affectedClassIds.map((affectedClassId) =>
          touchRealtimeEvent('course-closing', { targetId: affectedClassId })
        ),
      ]);

      return res.status(200).json({ success: true, affectedClassCount });
    }

    return res.status(400).json({ success: false, error: 'Unknown setting type' });
  } catch (err) {
    console.error('[Classes/save-settings] Error:', err);
    return sendApiError(res, err, 'Failed to save settings');
  }
}

export async function handleSaveHolidays(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = normalizeBody(req.body);
    const classId = getString(body, 'classId');
    const rawHolidays = Array.isArray(body.holidays) ? body.holidays : [];
    const holidays = normalizeHolidayDates(rawHolidays);
    const rawScope = getString(body, 'scope');
    const scope =
      rawScope === 'teacher-all' || rawScope === 'all-same-day' ? 'teacher-all' : 'single';
    const replace = body.replace === true;

    if (!classId) {
      return res.status(400).json({ success: false, error: 'Missing classId' });
    }
    if (
      rawHolidays.some(
        (holiday) => typeof holiday !== 'string' || !parseIsoDateOnly(holiday.trim())
      )
    ) {
      return res.status(400).json({ success: false, error: 'Invalid holiday date' });
    }
    if (replace && scope !== 'single') {
      return res
        .status(400)
        .json({ success: false, error: 'Replace mode is only supported for one class' });
    }
    if (scope === 'teacher-all' && holidays.length !== 1) {
      return res
        .status(400)
        .json({ success: false, error: 'Teacher-wide holidays require exactly one date' });
    }

    // Verify teacher owns this class or is admin
    const classRef = db.collection('classes').doc(classId);
    const classSnap = await classRef.get();
    if (!classSnap.exists) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    const classData = classSnap.data()!;
    if (
      userInfo.role !== 'admin' &&
      userInfo.role !== 'office' &&
      classData.teacherId !== user.uid
    ) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const classDays = normalizeDaysOfWeek(classData.daysOfWeek);
    if (
      classDays.length > 0 &&
      holidays.some((holiday) => {
        const day = getIsoDateDayOfWeek(holiday);
        return day === null || !classDays.includes(day);
      })
    ) {
      return res.status(400).json({ success: false, error: 'Holiday is not a class day' });
    }

    const systemHolidays = await getSystemHolidays(db);

    if (scope === 'teacher-all') {
      const targetDay = getIsoDateDayOfWeek(holidays[0]);
      if (targetDay === null) {
        return res.status(400).json({ success: false, error: 'Invalid holiday date' });
      }
      const teacherId = String(classData.teacherId || '');
      if (!teacherId) {
        return res.status(400).json({ success: false, error: 'Class is missing teacherId' });
      }
      const teacherClassesSnap = await db
        .collection('classes')
        .where('teacherId', '==', teacherId)
        .get();
      const batch = db.batch();
      let affectedCount = 0;
      let currentClassEndDate: string | undefined;
      let currentClassHolidays: string[] | undefined;
      const dateChangedClassIds: string[] = [];

      for (const doc of teacherClassesSnap.docs) {
        const cls = doc.data();
        if (normalizeDaysOfWeek(cls.daysOfWeek).includes(targetDay)) {
          const existingHolidays = normalizeHolidayDates(cls.holidays);
          const newHolidays = [...new Set([...existingHolidays, ...holidays])].sort();
          const updateData = buildHolidayClassUpdate(cls, newHolidays, systemHolidays);
          batch.update(doc.ref, updateData);
          if (
            typeof updateData.endDate === 'string' &&
            updateData.endDate !== String(cls.endDate || '')
          ) {
            dateChangedClassIds.push(doc.id);
          }
          if (doc.id === classId) {
            currentClassHolidays = newHolidays;
            currentClassEndDate =
              typeof updateData.endDate === 'string' ? updateData.endDate : undefined;
          }
          affectedCount++;
        }
      }

      await batch.commit();
      const invalidatedClassIds = await invalidateCourseClosingApprovals(
        db,
        dateChangedClassIds,
        user.uid,
        'COURSE_DATES_CHANGED'
      );
      await Promise.all([
        touchRealtimeEvent('office-schedule-changed'),
        ...dateChangedClassIds.map((affectedClassId) =>
          touchRealtimeEvent('course-closing', { targetId: affectedClassId })
        ),
      ]);
      await writeClassAudit(req, db, user, userInfo, 'update', classId, undefined, {
        action: 'save-holidays',
        scope: 'teacher-all',
        holidays,
        affectedCount,
        ...(dateChangedClassIds.length > 0
          ? {
              event: 'course_closing_invalidated',
              invalidationReason: 'COURSE_DATES_CHANGED',
              affectedClassIds: dateChangedClassIds,
              invalidatedClassIds,
            }
          : {}),
      });

      return res.status(200).json({
        success: true,
        affectedCount,
        holidays: currentClassHolidays,
        endDate: currentClassEndDate,
      });
    } else {
      // Single class
      let newHolidays: string[];
      if (replace) {
        newHolidays = holidays;
      } else {
        const existingHolidays = normalizeHolidayDates(classData.holidays);
        newHolidays = [...new Set([...existingHolidays, ...holidays])].sort();
      }
      const updateData = buildHolidayClassUpdate(classData, newHolidays, systemHolidays);
      await classRef.update(updateData);
      const courseDatesChanged =
        typeof updateData.endDate === 'string' &&
        updateData.endDate !== String(classData.endDate || '');
      const invalidatedClassIds = courseDatesChanged
        ? await invalidateCourseClosingApprovals(db, [classId], user.uid, 'COURSE_DATES_CHANGED')
        : [];

      await writeClassAudit(req, db, user, userInfo, 'update', classId, undefined, {
        action: 'save-holidays',
        scope: 'single',
        holidays,
        ...(courseDatesChanged
          ? {
              event: 'course_closing_invalidated',
              invalidationReason: 'COURSE_DATES_CHANGED',
              beforeEndDate: classData.endDate,
              afterEndDate: updateData.endDate,
              invalidatedClassIds,
            }
          : {}),
      });
      await Promise.all([
        touchRealtimeEvent('office-schedule-changed'),
        ...(courseDatesChanged
          ? [touchRealtimeEvent('course-closing', { targetId: classId })]
          : []),
      ]);

      return res.status(200).json({
        success: true,
        holidays: newHolidays,
        endDate: typeof updateData.endDate === 'string' ? updateData.endDate : undefined,
      });
    }
  } catch (err) {
    console.error('[Classes/save-holidays] Error:', err);
    return sendApiError(res, err, 'Failed to save holidays');
  }
}
