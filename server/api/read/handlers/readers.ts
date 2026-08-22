import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { resolveAuditLogFilters } from './auditLogFilters.js';
import {
  FieldPath,
  type Query,
  type DocumentStore,
  type QueryDocumentSnapshot,
  type DocumentSnapshot,
} from '@/server/db/documentStore.js';
import { withStatus } from '../../lib/http/helpers.js';
import {
  assertCanReadStudentScopedResource,
  assertClassAccess,
  assertFinanceAccess,
  getClassGrade,
  requireRole,
  withAuthzStatus,
  type UserContext,
} from '../../lib/auth/authz.js';
import type { AuthRole } from '../../lib/auth/roles.js';
import {
  projectStudent,
  STUDENT_INDEX_QUERY_FIELDS,
  type StudentProjectionView,
} from '../../lib/student/studentProjection.js';
import { getParentDashboardPayload } from '../../lib/services/parentDashboardService.js';
import { buildFinanceReport } from '../../lib/services/financeReportService.js';
import {
  aggregateDashboardReadModel,
  isDashboardReadModelFresh,
} from '../../lib/services/dashboardAggregateService.js';
import {
  isCurrentAcademicCourseRecord,
  isOfficeAcademicClassVisible,
  isRequiredAcademicEvaluationStudent,
  selectFinalEvaluation,
  type AcademicEvaluationLike,
} from '../../../../shared/academic.js';
import { isClassVisibleForRoleOutsideAdminDashboard } from '../../../../shared/classVisibility.js';
import type { CourseClosingSnapshot } from '../../../../shared/courseClosing.js';
import { applyTeacherSalaryVisibility } from '../../../../shared/teacherSalaryVisibility.js';
import {
  getClassTimeRange,
  getScheduledClassDatesInRange,
  isFutureVietnamDate,
  isIsoDate,
} from '../../../../shared/classSchedule.js';
import {
  buildPromotionCutoffByClassId,
  clampEndDateToPromotion,
  isAfterPromotionCutoff,
} from '../../../../shared/classPromotion.js';
import { getEffectiveTeacherIdForSession } from '../../../../shared/teacherAttendance.js';
import { canStudentAccessAssignment } from '../../../../shared/assignmentDelivery.js';
import { createReadCache, readCacheKey } from '../../lib/cache/readCache.js';
import { deferReadTelemetry } from '../../lib/telemetry/deferredReadTelemetry.js';
import {
  buildExpectedStudentSessions,
  mergeExpectedSessionsWithAttendance,
  type ExpectedSession,
} from '../../../../shared/studentAttendanceReport.js';
import { createEligibilityResolver } from '../../../../shared/studentSessionEligibility.js';
import { readCourseJoins, readLeavePeriods } from '../../../../shared/studentEnrollmentWindows.js';
import { estimateSessionValue } from '../../../../shared/studentRefundEstimate.js';
import {
  evaluationVersion,
  snapshotFromCourseClosingContext,
} from '../../classes/helpers/courseClosing.js';
import {
  deriveLedgerDisplayStatus,
  formatLedgerPeriodKey,
} from '../../../../shared/studentFinanceReport.js';
import {
  buildEnrollmentTimeline,
  buildClassTerms,
  findTermForDate,
  makeTermKey,
  UNKNOWN_TERM_ID,
  type ClassTerm,
  type TimelineSegment,
} from '../../../../shared/studentEnrollmentTimeline.js';
import {
  deriveAccountingPaymentStatus,
  matchesAccountingSearchTerms,
  parseAccountingSearchTerms,
  type StudentCourseFinanceSummary,
} from '../../../../shared/accountingStudentFinance.js';
import { readStoredStudentCourseEnrollment } from '../../lib/student/courseEnrollmentRepository.js';
import { resolveCanonicalStudentId } from '../../lib/student/studentIdentityResolver.js';
import { loadCourseTermRosters } from '../../lib/student/courseTermRoster.js';
import {
  readCanonicalStudentReadControl,
  recordCanonicalReadDiscrepancies,
} from '../../lib/student/canonicalStudentReadControl.js';
import {
  compareCanonicalStudentReadSets,
  listCanonicalClassRoster,
  listCanonicalStudentDirectory,
  paginateCanonicalRows,
  readCanonicalStudentContext,
  readCanonicalStudentsByIds,
  type CanonicalStudentReadAnomaly,
} from '../../lib/student/canonicalStudentReadRepository.js';
import type {
  CanonicalStudentEnrollmentView,
  CanonicalStudentPlacementStatus,
  CanonicalStudentReadMode,
  CanonicalStudentReadRow,
} from '../../../../shared/canonicalStudentReadModel.js';
import {
  isOpenStudentCourseEnrollmentStatus,
  type StudentCourseEnrollmentStatus,
} from '../../../../shared/studentCourseEnrollment.js';
import { buildAccountingStudentSummary } from '../../lib/accounting/studentFinanceProjection.js';
import type { AccountingStudentFinancePage } from '../../../../shared/accountingStudentFinance.js';
import {
  FINANCE_DASHBOARD_LIMIT,
  ADMIN_DASHBOARD_LIMIT,
  PARENT_DASHBOARD_LIMIT,
  MAX_LIMIT,
  STUDENTS_READ_MAX_LIMIT,
  STUDENTS_COMPLETE_INDEX_MAX,
  ADMIN_DASHBOARD_STAFF_ROLES,
  ACCOUNTING_LEDGER_FAN_OUT,
  ACCOUNTING_LEDGER_PAGE_CAP,
  ACCOUNTING_LEDGER_TOTAL_CAP,
  dashboardCache,
  parentDashboardCache,
  getLimit,
  getBoundedLimit,
  getCursor,
  getMonthRange,
  resolveCursor,
  paginatedQuery,
  docData,
  teacherMonthProfile,
  teacherMonthClass,
  teacherMonthSession,
  filterClassRowsForContext,
  isClassDocVisibleForContext,
  filterDocsToVisibleClasses,
  filterRowsToVisibleClasses,
  parentPaymentSummary,
  projectedAssignmentDoc,
  projectedSubmissionDoc,
  parentLedgerSummary,
  parentReceiptSummary,
  parentInvoiceSummary,
  projectedAttendanceForRole,
  projectedEvaluationForRole,
  projectedSessionForRole,
  projectedReportForRole,
  projectedStudentDoc,
  projectedClassDoc,
  projectedTeacherDoc,
  projectedEvaluationDoc,
  projectedLedgerDoc,
  accountingLedgerSummary,
  projectedZaloNotificationDoc,
  projectedNotificationDoc,
  buildClassStudentCounts,
  buildOfficeDashboardStudentCounts,
  getRequestedStudentProjection,
  authorizeStudentProjection,
  canReadStudentDirectory,
  chunks,
  collectStudentIds,
  collectAuditUserIds,
  fetchStudentDocsByIds,
  fetchAuditUsersByIds,
  mergeDocsById,
  buildTeacherAttendanceRow,
  isArchivedClassDoc,
  shouldHideArchivedClassSession,
  flattenStudentReceiptRows,
  type TeacherAttendanceSessionRow,
} from './utils.js';

const parentTuitionCache = createReadCache<Record<string, any>>(20_000);
const academicReportsCache = createReadCache<Record<string, any>>(30_000);

// Local helper functions used specifically by these read handlers

function buildAdminDashboardSummaryPayload(
  model: Record<string, any>,
  classes: any,
  users: any,
  _ctx: UserContext
) {
  const counts = (model.counts || {}) as Record<string, unknown>;
  const staffDocs = users.docs;
  const teacherDocs = staffDocs.filter((doc: any) => String(doc.data()?.role || '') === 'teacher');
  const staff = staffDocs.map(projectedTeacherDoc);

  const modelClassStudentCounts = model.classStudentCounts as
    | Record<string, { total: number; active: number; onLeave: number; dropped: number }>
    | undefined;
  const modelActiveStudents = model.activeStudents as number | undefined;

  const classStudentCounts = modelClassStudentCounts || {};
  const paymentsNeedingReview = Number(counts.paymentsNeedingReview || 0);
  const failedNotifications = Number(counts.failedNotifications || 0);
  const activeStudents =
    modelActiveStudents ??
    Object.values(classStudentCounts).reduce((sum, item) => sum + Number(item.active || 0), 0);
  const recentAlerts = [
    ...(paymentsNeedingReview > 0
      ? [{ id: 'payments_review', type: 'payments_needing_review', count: paymentsNeedingReview }]
      : []),
    ...(failedNotifications > 0
      ? [{ id: 'failed_notifications', type: 'failed_notifications', count: failedNotifications }]
      : []),
  ];

  return {
    // Carries its own `generatedAt`, so the client can tell a fresh
    // enrollment-derived count from one served out of a stale stored model and
    // fall back to the live directory in the second case.
    ...(model.canonicalHeadcount ? { canonicalHeadcount: model.canonicalHeadcount } : {}),
    summary: {
      // Canonical de-duplicated headcount; falls back to the raw document count
      // only for read models produced before `currentStudents` existed.
      totalStudents: Number(counts.currentStudents ?? counts.students ?? 0),
      archivedStudentRecords: Number(counts.students || 0),
      activeStudents: Number(counts.activeStudents || activeStudents),
      totalClasses: Number(counts.classes || classes.docs.length),
      activeClasses: Number(
        counts.activeClasses ||
          classes.docs.filter((doc: any) => String(doc.data()?.status || 'active') === 'active')
            .length
      ),
      totalTeachers: Number(counts.teachers || teacherDocs.length),
      attendanceToday: { present: 0, absent: 0, late: 0 },
      financeSummary: {
        pendingPayments: Number(counts.pendingPayments || 0),
        paymentsNeedingReview,
      },
      recentAlerts,
      generatedAt: String(model.generatedAt || ''),
    },
    students: [],
    classes: classes.docs.map(projectedClassDoc),
    teachers: staff,
    staff,
    evaluations: [],
    classStudentCounts,
    genderCounts: model.genderCounts,
    performanceCounts: model.performanceCounts || {
      excellent: 0,
      good: 0,
      fair: 0,
      average: 0,
    },
  };
}
function assertDateOnly(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw withAuthzStatus(`Invalid ${field}`, 400);
  }
}

function daysBetweenInclusive(from: string, to: string) {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((toMs - fromMs) / 86_400_000) + 1;
}

function getMonthBoundary(month: string, offset: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function queryByClassIds(
  db: DocumentStore,
  collectionName: string,
  classIds: string[],
  limit: number,
  configure: (query: Query) => Query = (query) => query
) {
  if (classIds.length === 0) return [];
  const snaps = await Promise.all(
    chunks(classIds, 30).map((ids) =>
      configure(db.collection(collectionName)).where('classId', 'in', ids).limit(limit).get()
    )
  );
  return snaps.flatMap((snap) => snap.docs).slice(0, limit);
}

async function queryOfficeAcademicByClassIds(
  db: DocumentStore,
  collectionName: string,
  classIds: string[],
  limitPerClass: number
) {
  const uniqueClassIds = [...new Set(classIds.filter(Boolean))];
  if (uniqueClassIds.length === 0) return [];
  const snaps = await Promise.all(
    chunks(uniqueClassIds, 30).map((ids) => {
      const chunkLimit = Math.max(limitPerClass, limitPerClass * ids.length);
      return db.collection(collectionName).where('classId', 'in', ids).limit(chunkLimit).get();
    })
  );
  return mergeDocsById(...snaps.map((snap) => snap.docs));
}

async function queryOfficeAcademicNotificationsByCourseIds(db: DocumentStore, courseIds: string[]) {
  const uniqueCourseIds = [...new Set(courseIds.filter(Boolean))];
  if (uniqueCourseIds.length === 0) return [];
  const snaps = await Promise.all(
    chunks(uniqueCourseIds, 10).flatMap((ids) =>
      ['sent', 'failed'].map((status) =>
        db
          .collection('zalo_notifications')
          .where('courseId', 'in', ids)
          .where('status', '==', status)
          .get()
      )
    )
  );
  return mergeDocsById(...snaps.map((snap) => snap.docs));
}

function contextDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  } as any;
}

function addSetItem(record: Record<string, Set<string>>, classId: string, studentId: string) {
  if (!classId || !studentId) return;
  record[classId] ||= new Set<string>();
  record[classId].add(studentId);
}

async function buildParentDashboard(db: DocumentStore, ctx: UserContext, limit: number) {
  return {
    dashboard: await getParentDashboardPayload(db, ctx, limit),
  };
}

const TEACHER_PAYROLL_MONTH_ROLES: readonly AuthRole[] = [
  'admin',
  'accounting',
  'office',
  'teacher',
];

function buildSubstituteByClassDate(docs: Array<{ data: () => Record<string, any> | undefined }>) {
  const substituteByClassDate = new Map<string, string>();

  docs.forEach((doc) => {
    const data = doc.data() || {};
    const classId = String(data.classId || '');
    const date = String(data.date || '');
    const substituteTeacherId = String(data.substituteTeacherId || '');
    if (classId && date && substituteTeacherId) {
      substituteByClassDate.set(`${classId}_${date}`, substituteTeacherId);
    }
  });

  return substituteByClassDate;
}

function substituteRowsFromMap(entries: Array<[string, string]>) {
  return entries.map(([key, substituteTeacherId]) => {
    const [classId, date] = key.split('_');
    return { classId, date, substituteTeacherId };
  });
}

export async function readTeacherMonthPayload(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest,
  roles: readonly AuthRole[],
  options: { scopeTeacherToSelf?: boolean } = {}
) {
  requireRole(ctx, [...roles]);
  const { month, from, to } = getMonthRange(req);
  const limit = getLimit(req, 2000);
  const fetchLimit = limit + 1;

  const [classesSnap, sessionsSnap, teachersSnap, substitutesSnap] = await Promise.all([
    db.collection('classes').limit(fetchLimit).get(),
    db
      .collection('class_sessions')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .limit(fetchLimit)
      .get(),
    db.collection('users').where('role', '==', 'teacher').limit(fetchLimit).get(),
    db
      .collection('substitute_requests')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .where('status', '==', 'accepted')
      .limit(fetchLimit)
      .get(),
  ]);

  const truncatedSources = [
    ...(classesSnap.docs.length > limit ? ['classes'] : []),
    ...(sessionsSnap.docs.length > limit ? ['class_sessions'] : []),
    ...(teachersSnap.docs.length > limit ? ['users'] : []),
    ...(substitutesSnap.docs.length > limit ? ['substitute_requests'] : []),
  ];
  const boundedClassDocs = classesSnap.docs.slice(0, limit);
  const boundedSessionDocs = sessionsSnap.docs.slice(0, limit);
  const boundedTeacherDocs = teachersSnap.docs.slice(0, limit);
  const boundedSubstituteDocs = substitutesSnap.docs.slice(0, limit);

  const visibleClassDocs = filterClassRowsForContext(boundedClassDocs, ctx);
  const visibleClassIds = new Set(visibleClassDocs.map((doc) => doc.id));
  const visibleClassDocsById = new Map(visibleClassDocs.map((doc) => [doc.id, doc]));
  const substituteByClassDate = buildSubstituteByClassDate(boundedSubstituteDocs);

  let classDocs = visibleClassDocs;
  let teacherDocs = boundedTeacherDocs;
  let substituteEntries = [...substituteByClassDate.entries()];
  const promotionCutoffs = buildPromotionCutoffByClassId(
    visibleClassDocs.map((doc) => doc.data() || {})
  );

  let sessions = boundedSessionDocs
    .filter((doc) => visibleClassIds.has(String(doc.data()?.classId || '')))
    // A promoted cohort's pay follows the new class, so the source class stops
    // contributing sessions from the promotion date onward.
    .filter(
      (doc) =>
        !isAfterPromotionCutoff(
          promotionCutoffs,
          String(doc.data()?.classId || ''),
          String(doc.data()?.date || '')
        )
    )
    .map((doc) => {
      const data = doc.data() || {};
      const classId = String(data.classId || '');
      const date = String(data.date || '');
      const classDoc = visibleClassDocsById.get(classId);
      const effectiveTeacherId = getEffectiveTeacherIdForSession({
        acceptedSubstituteTeacherId: substituteByClassDate.get(`${classId}_${date}`),
        sessionTeacherId: data.teacherId,
        classTeacherId: classDoc?.data()?.teacherId,
      });
      return teacherMonthSession(doc, effectiveTeacherId);
    });

  if (options.scopeTeacherToSelf && ctx.role === 'teacher') {
    const teacherId = String(ctx.uid || '');
    const ownClassIds = new Set(
      classDocs
        .filter((doc) => String(doc.data()?.teacherId || '') === teacherId)
        .map((doc) => doc.id)
    );
    const relevantClassIds = new Set(ownClassIds);

    sessions.forEach((session) => {
      if (session.teacherId === teacherId) relevantClassIds.add(session.classId);
    });
    substituteEntries.forEach(([key, substituteTeacherId]) => {
      const [classId] = key.split('_');
      if (substituteTeacherId === teacherId || ownClassIds.has(classId)) {
        relevantClassIds.add(classId);
      }
    });

    classDocs = classDocs.filter((doc) => relevantClassIds.has(doc.id));
    const scopedClassIds = new Set(classDocs.map((doc) => doc.id));
    sessions = sessions.filter(
      (session) =>
        scopedClassIds.has(session.classId) &&
        (session.teacherId === teacherId || ownClassIds.has(session.classId))
    );
    substituteEntries = substituteEntries.filter(([key, substituteTeacherId]) => {
      const [classId] = key.split('_');
      return (
        scopedClassIds.has(classId) &&
        (substituteTeacherId === teacherId || ownClassIds.has(classId))
      );
    });
    teacherDocs = teacherDocs.filter((doc) => doc.id === teacherId);
  }

  return {
    month,
    range: { from, to },
    teachers: teacherDocs
      .map(teacherMonthProfile)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    // Clamping endDate stops the client-side schedule generator from projecting
    // sessions for a class whose cohort has already moved on.
    classes: applyTeacherSalaryVisibility(
      classDocs.map(teacherMonthClass).map((cls) => ({
        ...cls,
        endDate: clampEndDateToPromotion(promotionCutoffs, cls.id, String(cls.endDate || '')),
      })),
      ctx.role
    ),
    sessions: applyTeacherSalaryVisibility(sessions, ctx.role),
    substitutes: substituteRowsFromMap(substituteEntries),
    truncatedSources,
    serverTime: Date.now(),
  };
}

// Extracted read channel handlers

export async function readOfficeTeachersMonth(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  return readTeacherMonthPayload(db, ctx, req, ['office', 'admin']);
}

export async function readTeacherPayrollMonth(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  return readTeacherMonthPayload(db, ctx, req, TEACHER_PAYROLL_MONTH_ROLES, {
    scopeTeacherToSelf: true,
  });
}

export async function readTeacherAttendanceWeek(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin', 'office']);
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw withStatus('Invalid teacher attendance date range', 400);
  }

  const [classesSnap, sessionsSnap, teachersSnap, substitutesSnap] = await Promise.all([
    db.collection('classes').limit(getLimit(req, 2000)).get(),
    db
      .collection('class_sessions')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .limit(getLimit(req, 2000))
      .get(),
    db.collection('users').where('role', '==', 'teacher').limit(getLimit(req, 2000)).get(),
    db
      .collection('substitute_requests')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .where('status', '==', 'accepted')
      .limit(getLimit(req, 2000))
      .get(),
  ]);

  const classDocs = filterClassRowsForContext(classesSnap.docs, ctx);
  const classMap = new Map(classDocs.map((doc) => [doc.id, doc]));
  const teacherMap = new Map(
    teachersSnap.docs.map((doc) => [
      doc.id,
      {
        uid: doc.id,
        displayName: String(doc.data().displayName || doc.data().email || ''),
        email: String(doc.data().email || ''),
      },
    ])
  );
  const substituteByClassDate = new Map<string, string>();
  substitutesSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const classId = String(data.classId || '');
    const date = String(data.date || '');
    const substituteTeacherId = String(data.substituteTeacherId || '');
    if (classId && date && substituteTeacherId) {
      substituteByClassDate.set(`${classId}_${date}`, substituteTeacherId);
    }
  });

  const sessionMap = new Map(sessionsSnap.docs.map((doc) => [doc.id, doc]));
  const rows = new Map<string, TeacherAttendanceSessionRow>();
  const promotionCutoffs = buildPromotionCutoffByClassId(classDocs.map((doc) => doc.data() || {}));

  classDocs.forEach((classDoc) => {
    const data = classDoc.data() || {};
    // An archived class keeps its original endDate, so without this guard it would
    // keep generating virtual attendance rows every week until that date passes.
    if (isArchivedClassDoc(classDoc)) return;
    getScheduledClassDatesInRange(
      {
        startDate: String(data.startDate || ''),
        endDate: String(data.endDate || ''),
        daysOfWeek: Array.isArray(data.daysOfWeek) ? (data.daysOfWeek as number[]) : [],
      },
      from,
      to
    ).forEach((date) => {
      const id = `${classDoc.id}_${date}`;
      const session = sessionMap.get(id);
      const teacherId = getEffectiveTeacherIdForSession({
        acceptedSubstituteTeacherId: substituteByClassDate.get(id),
        sessionTeacherId: session?.data()?.teacherId,
        classTeacherId: data.teacherId,
      });
      rows.set(
        id,
        buildTeacherAttendanceRow({
          id,
          classDoc,
          session,
          date,
          teacherId,
          teacherMap,
          isVirtual: !session,
        })
      );
    });
  });

  sessionsSnap.docs.forEach((session) => {
    const data = session.data() || {};
    const classId = String(data.classId || '');
    const classDoc = classMap.get(classId);
    if (!classDoc) return;
    const date = String(data.date || '');
    // Once the cohort moved to the new class, the source class earns nothing further,
    // so these rows drop whether or not somebody already marked them.
    if (isAfterPromotionCutoff(promotionCutoffs, classId, date)) return;
    if (shouldHideArchivedClassSession({ classDoc, session, date })) return;
    const teacherId = getEffectiveTeacherIdForSession({
      acceptedSubstituteTeacherId: substituteByClassDate.get(`${classId}_${date}`),
      sessionTeacherId: data.teacherId,
      classTeacherId: classDoc.data()?.teacherId,
    });
    rows.set(
      session.id,
      buildTeacherAttendanceRow({
        id: session.id,
        classDoc,
        session,
        date,
        teacherId,
        teacherMap,
        isVirtual: false,
      })
    );
  });

  const sessions = [...rows.values()].sort((a, b) =>
    `${a.date} ${a.schedule}`.localeCompare(`${b.date} ${b.schedule}`)
  );
  return {
    sessions,
    teachers: [...teacherMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    classes: classDocs.map((doc) => ({
      id: doc.id,
      name: String(doc.data()?.name || ''),
      schedule: typeof doc.data()?.schedule === 'string' ? doc.data()?.schedule : '',
      room: typeof doc.data()?.room === 'string' ? doc.data()?.room : '',
    })),
    serverTime: Date.now(),
  };
}

export async function readFinance(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  assertFinanceAccess(ctx);
  const view = typeof req.query.view === 'string' ? req.query.view : '';
  if (view) return readFinanceView(db, ctx, req, view);
  const resource = typeof req.query.resource === 'string' ? req.query.resource : '';
  if (resource) return readFinanceResource(db, ctx, req, resource);

  const limit = getBoundedLimit(req, FINANCE_DASHBOARD_LIMIT, FINANCE_DASHBOARD_LIMIT);
  const cursor = getCursor(req);
  const cursorDoc = cursor ? await resolveCursor(db, 'students', cursor) : null;

  const [classes, studentPage, ledgers, receipts, invoices, expenses, teachers] = await Promise.all(
    [
      db.collection('classes').limit(limit).get(),
      paginatedQuery(
        db.collection('students').orderBy('name').orderBy(FieldPath.documentId()),
        limit,
        cursorDoc
      ),
      db.collection('course_fee_ledgers').limit(limit).get(),
      db.collection('receipts').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('invoices').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('expenses').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('users').where('role', '==', 'teacher').limit(limit).get(),
    ]
  );
  const referencedStudentIds = new Set([
    ...collectStudentIds(ledgers.docs),
    ...collectStudentIds(receipts.docs),
  ]);
  const referencedStudents = await fetchStudentDocsByIds(
    db,
    referencedStudentIds,
    studentPage.docs
  );
  const studentDocs = mergeDocsById(studentPage.docs, referencedStudents);
  return {
    classes: filterClassRowsForContext(classes.docs.map(docData), ctx),
    students: studentDocs.map((doc) => projectedStudentDoc(doc, 'finance')),
    ledgers: ledgers.docs.map(docData),
    receipts: receipts.docs.map(docData),
    invoices: invoices.docs.map(docData),
    expenses: expenses.docs.map(docData),
    payments: [],
    teachers: teachers.docs.map((doc) => ({
      uid: doc.id,
      displayName: String(doc.data().displayName || doc.data().name || doc.data().email || 'GV'),
    })),
    page: {
      limit,
      nextCursor: studentPage.nextCursor || null,
      hasMore: Boolean(studentPage.nextCursor),
    },
  };
}

export async function readDashboardAggregate(db: DocumentStore, ctx: UserContext) {
  requireRole(ctx, ['admin', 'accounting']);
  const key = readCacheKey({ channel: 'dashboard-aggregate', role: ctx.role });
  return dashboardCache.get(key, async () => {
    const snap = await db.collection('read_models').doc('dashboard_global').get();
    return { model: snap.exists ? docData(snap) : null };
  });
}

export async function readAdminDashboardSummary(db: DocumentStore, ctx: UserContext) {
  requireRole(ctx, ['admin']);
  const limit = ADMIN_DASHBOARD_LIMIT;
  const studentsEvent = await db.collection('realtime_events').doc('students').get();
  const studentsVersion = Number(studentsEvent.data()?.version || 0);
  const key = readCacheKey({
    channel: 'admin-dashboard-summary',
    role: ctx.role,
    params: { studentsVersion },
  });

  return dashboardCache.get(key, async () => {
    const [snap, classes, users] = await Promise.all([
      db.collection('read_models').doc('dashboard_global').get(),
      db.collection('classes').limit(limit).get(),
      db
        .collection('users')
        .where('role', 'in', [...ADMIN_DASHBOARD_STAFF_ROLES])
        .limit(limit)
        .get(),
    ]);
    const storedModel = snap.exists ? snap.data() || {} : null;
    const model = isDashboardReadModelFresh(storedModel, studentsVersion)
      ? storedModel
      : await aggregateDashboardReadModel(db);
    return buildAdminDashboardSummaryPayload(model, classes, users, ctx);
  });
}

export async function readCalendarWindow(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'teacher', 'office']);
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  assertDateOnly(from, 'from');
  assertDateOnly(to, 'to');
  if (to < from) throw withAuthzStatus('Invalid calendar window', 400);
  if (daysBetweenInclusive(from, to) > 45) {
    throw withAuthzStatus('Calendar window cannot exceed 45 days', 400);
  }

  const classLimit = ADMIN_DASHBOARD_LIMIT;
  const classId = typeof req.query.classId === 'string' ? req.query.classId.trim() : '';
  let classesQuery: Query = db.collection('classes');
  let attendanceQuery: Query = db
    .collection('attendance')
    .where('date', '>=', from)
    .where('date', '<=', to);
  if (classId) {
    const classData = await assertClassAccess(db, ctx, classId, 'read');
    if (!isClassVisibleForRoleOutsideAdminDashboard(classData, ctx.role)) {
      throw withAuthzStatus('Class not found', 404);
    }
    classesQuery = classesQuery.where('__name__', '==', classId);
    attendanceQuery = attendanceQuery.where('classId', '==', classId);
  } else if (ctx.role === 'teacher') {
    classesQuery = classesQuery.where('teacherId', '==', ctx.uid);
    attendanceQuery = attendanceQuery.where('teacherId', '==', ctx.uid);
  }
  const [classes, attendance, holidaysSnap] = await Promise.all([
    classesQuery.limit(classLimit + 1).get(),
    attendanceQuery.select('classId', 'date').get(),
    db
      .collection('system_settings')
      .doc('holidays')
      .get()
      .catch(() => null),
  ]);
  if (classes.docs.length > classLimit) {
    throw withAuthzStatus(`Calendar class dataset exceeds ${classLimit} records`, 409);
  }
  const visibleClasses = classes.docs.filter((doc) => isClassDocVisibleForContext(doc, ctx));
  const visibleClassIds = new Set(visibleClasses.map((doc) => doc.id));
  const attendanceCounts: Record<string, number> = {};
  let totalAttendanceRecords = 0;
  for (const doc of attendance.docs) {
    const data = doc.data() || {};
    const attendanceClassId = String(data.classId || '');
    const date = String(data.date || '');
    if (!date || !visibleClassIds.has(attendanceClassId)) continue;
    const countKey = `${attendanceClassId}::${date}`;
    attendanceCounts[countKey] = (attendanceCounts[countKey] || 0) + 1;
    totalAttendanceRecords += 1;
  }
  const systemHolidays =
    holidaysSnap && holidaysSnap.exists && Array.isArray(holidaysSnap.data()?.dates)
      ? (holidaysSnap.data()?.dates as string[])
      : [];

  return {
    window: { from, to },
    classes: visibleClasses.map(projectedClassDoc),
    attendance: [],
    attendanceCounts,
    systemHolidays,
    meta: { complete: true, totalAttendanceRecords },
  };
}

export async function readReportsMonthly(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  if (!/^\d{4}-\d{2}$/.test(month)) throw withAuthzStatus('Invalid month', 400);
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'finance';
  if (scope === 'academic') return readAcademicReportsMonthly(db, ctx, req, month);

  assertFinanceAccess(ctx);
  const [year, monthNumber] = month.split('-').map(Number);
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(endDay).padStart(2, '0')}`;
  return {
    month,
    report: await buildFinanceReport(db, { startDate, endDate }),
  };
}

async function readAcademicReportsMonthlyUncached(
  db: DocumentStore,
  ctx: UserContext,
  limit: number,
  month: string
) {
  const monthStart = getMonthBoundary(month, 0);
  const previousMonthStart = getMonthBoundary(month, -1);
  const nextMonthStart = getMonthBoundary(month, 1);

  let classesQuery: Query = db.collection('classes');
  let attendanceQuery: Query = db
    .collection('attendance')
    .where('date', '>=', previousMonthStart)
    .where('date', '<', nextMonthStart);
  let assignmentsQuery: Query = db.collection('assignments');
  let submissionsQuery: Query = db
    .collection('submissions')
    .where('submittedAt', '>=', monthStart)
    .where('submittedAt', '<', nextMonthStart);
  let evaluationsQuery: Query = db
    .collection('evaluations')
    .where('date', '>=', monthStart)
    .where('date', '<', nextMonthStart);

  if (ctx.role === 'teacher') {
    classesQuery = classesQuery.where('teacherId', '==', ctx.uid);
    attendanceQuery = attendanceQuery.where('teacherId', '==', ctx.uid);
    assignmentsQuery = assignmentsQuery.where('teacherId', '==', ctx.uid);
    submissionsQuery = submissionsQuery.where('teacherId', '==', ctx.uid);
    evaluationsQuery = evaluationsQuery.where('teacherId', '==', ctx.uid);
  }

  const [
    classes,
    canonicalStudentDirectory,
    attendance,
    assignments,
    submissions,
    evaluations,
    teachers,
  ] = await Promise.all([
    classesQuery.limit(limit).get(),
    ctx.role === 'teacher' ? Promise.resolve(null) : listCanonicalStudentDirectory(db, { limit }),
    attendanceQuery.limit(limit).get(),
    assignmentsQuery.limit(limit).get(),
    submissionsQuery.limit(limit).get(),
    evaluationsQuery.limit(limit).get(),
    ctx.role === 'teacher'
      ? Promise.resolve({
          docs: [
            contextDoc(ctx.uid, { displayName: ctx.name, email: ctx.email, role: 'teacher' }),
          ],
        })
      : db.collection('users').where('role', '==', 'teacher').limit(limit).get(),
  ]);
  const visibleClasses = classes.docs.filter((doc) => isClassDocVisibleForContext(doc, ctx));
  const visibleClassIds = new Set(visibleClasses.map((doc) => doc.id));
  let reportStudents: Array<Record<string, unknown>>;

  if (ctx.role === 'teacher') {
    // The physical student documents no longer own teacher/class placement.
    // Build the report roster from the same canonical enrollments as the
    // teacher student directory, otherwise `students.teacherId` returns an
    // empty set after migration and every chart displays zero.
    const byCanonicalId = new Map<string, CanonicalStudentReadRow>();
    for (const classDoc of visibleClasses) {
      const roster = await listCanonicalClassRoster(db, { classId: classDoc.id });
      for (const row of roster) byCanonicalId.set(row.canonicalProfileId, row);
    }
    reportStudents = [...byCanonicalId.values()]
      .slice(0, limit)
      .map((row) => projectCanonicalStudent(row, 'academic'));
  } else {
    // Admin and office dashboards/directories already read the canonical student
    // directory. Reading physical `students` documents here resurrects aliased or
    // stale active profiles and makes every chart count the same child twice.
    reportStudents = (canonicalStudentDirectory?.rows || []).map((row) =>
      projectCanonicalStudent(row, 'academic')
    );
  }

  return {
    month,
    window: { previousMonthStart, monthStart, nextMonthStart },
    classes: visibleClasses.map(projectedClassDoc),
    students: reportStudents,
    attendance: filterDocsToVisibleClasses(attendance.docs, visibleClassIds, ctx).map((doc) =>
      projectedAttendanceForRole(doc, ctx.role)
    ),
    assignments: filterDocsToVisibleClasses(assignments.docs, visibleClassIds, ctx).map((doc) =>
      projectedAssignmentDoc(doc, ctx.role)
    ),
    submissions: filterDocsToVisibleClasses(submissions.docs, visibleClassIds, ctx).map((doc) =>
      projectedSubmissionDoc(doc, ctx.role)
    ),
    evaluations: filterDocsToVisibleClasses(evaluations.docs, visibleClassIds, ctx).map((doc) =>
      projectedEvaluationForRole(doc, ctx.role)
    ),
    teachers: teachers.docs.map(projectedTeacherDoc),
    page: { limit },
  };
}

export async function readAcademicReportsMonthly(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest,
  month: string
) {
  requireRole(ctx, ['admin', 'teacher', 'office']);
  // A 200-document cap here silently truncated the students query below the real
  // roster size (e.g. 383 students), so the report's headcount fell out of sync
  // with the admin dashboard and students directory, which read the full collection.
  const limit = getBoundedLimit(req, ADMIN_DASHBOARD_LIMIT, ADMIN_DASHBOARD_LIMIT);
  const cacheKey = readCacheKey({
    channel: 'reports-monthly',
    role: ctx.role,
    uid: ctx.role === 'teacher' ? ctx.uid : undefined,
    params: { limit, month },
  });
  return academicReportsCache.get(cacheKey, () =>
    readAcademicReportsMonthlyUncached(db, ctx, limit, month)
  );
}

export async function readJobs(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'accounting']);
  const limit = getBoundedLimit(req, ADMIN_DASHBOARD_LIMIT, ADMIN_DASHBOARD_LIMIT);
  const cursor = getCursor(req);
  const cursorDoc = cursor ? await resolveCursor(db, 'jobs', cursor) : null;
  const { docs, nextCursor } = await paginatedQuery(
    db.collection('jobs').orderBy('createdAt', 'desc'),
    limit,
    cursorDoc
  );
  return {
    jobs: docs.map(docData),
    page: {
      limit,
      nextCursor: nextCursor || null,
      hasMore: Boolean(nextCursor),
    },
  };
}

export async function readFinanceView(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest,
  view: string
) {
  const limit = getBoundedLimit(req, FINANCE_DASHBOARD_LIMIT, FINANCE_DASHBOARD_LIMIT);
  if (view === 'ledgers') {
    const [classes, ledgers, teachers] = await Promise.all([
      db.collection('classes').limit(limit).get(),
      db.collection('course_fee_ledgers').limit(limit).get(),
      db.collection('users').where('role', '==', 'teacher').limit(limit).get(),
    ]);
    const students = await fetchStudentDocsByIds(db, collectStudentIds(ledgers.docs));
    return {
      classes: filterClassRowsForContext(classes.docs.map(docData), ctx),
      students: students.map((doc) => projectedStudentDoc(doc, 'finance')),
      ledgers: ledgers.docs.map(docData),
      teachers: teachers.docs.map((doc) => ({
        uid: doc.id,
        displayName: String(doc.data().displayName || doc.data().name || doc.data().email || 'GV'),
      })),
    };
  }

  if (view === 'receipts') {
    const [classes, ledgers, receipts, teachers] = await Promise.all([
      db.collection('classes').limit(limit).get(),
      db.collection('course_fee_ledgers').limit(limit).get(),
      db.collection('receipts').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('users').where('role', '==', 'teacher').limit(limit).get(),
    ]);
    const referencedStudentIds = new Set([
      ...collectStudentIds(ledgers.docs),
      ...collectStudentIds(receipts.docs),
    ]);
    const students = await fetchStudentDocsByIds(db, referencedStudentIds);
    return {
      classes: filterClassRowsForContext(classes.docs.map(docData), ctx),
      students: students.map((doc) => projectedStudentDoc(doc, 'finance')),
      ledgers: ledgers.docs.map(docData),
      receipts: receipts.docs.map(docData),
      teachers: teachers.docs.map((doc) => ({
        uid: doc.id,
        displayName: String(doc.data().displayName || doc.data().name || doc.data().email || 'GV'),
      })),
    };
  }

  if (view === 'expenses') {
    const expenses = await db
      .collection('expenses')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return {
      expenses: expenses.docs.map(docData),
    };
  }

  throw withAuthzStatus('Unknown finance view', 400);
}

export async function readFinanceResource(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest,
  resource: string
) {
  const limit = getBoundedLimit(req, FINANCE_DASHBOARD_LIMIT, FINANCE_DASHBOARD_LIMIT);
  const cursor = getCursor(req);
  const supportedResources = new Set([
    'classes',
    'students',
    'teachers',
    'ledgers',
    'receipts',
    'invoices',
    'expenses',
    'payments',
  ]);
  if (!supportedResources.has(resource)) {
    throw withAuthzStatus('Unknown finance resource', 400);
  }

  const config: Record<
    string,
    { collection: string; orderBy: string; direction?: 'desc' | 'asc' }
  > = {
    classes: { collection: 'classes', orderBy: 'name' },
    students: { collection: 'students', orderBy: 'name' },
    teachers: { collection: 'users', orderBy: 'displayName' },
    ledgers: { collection: 'course_fee_ledgers', orderBy: 'createdAt', direction: 'desc' },
    receipts: { collection: 'receipts', orderBy: 'createdAt', direction: 'desc' },
    invoices: { collection: 'invoices', orderBy: 'createdAt', direction: 'desc' },
    expenses: { collection: 'expenses', orderBy: 'createdAt', direction: 'desc' },
    payments: { collection: 'payment_requests', orderBy: 'createdAt', direction: 'desc' },
  };
  const cfg = config[resource];
  const cursorDoc = cursor ? await resolveCursor(db, cfg.collection, cursor) : null;
  let query: Query = db.collection(cfg.collection);
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const classId = typeof req.query.classId === 'string' ? req.query.classId.trim() : '';
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';

  if (resource === 'teachers') query = query.where('role', '==', 'teacher');
  if (status && status !== 'all') query = query.where('status', '==', status);
  if (classId && resource === 'receipts') {
    query = query.where('classIds', 'array-contains', classId);
  } else if (classId && ['students', 'ledgers', 'invoices', 'payments'].includes(resource)) {
    query = query.where('classId', '==', classId);
  }
  const dateField =
    resource === 'receipts'
      ? 'receivedDate'
      : resource === 'expenses'
        ? 'paidDate'
        : resource === 'invoices'
          ? 'issueDate'
          : '';
  if (dateField && startDate) query = query.where(dateField, '>=', startDate);
  if (dateField && endDate) query = query.where(dateField, '<=', endDate);

  const { docs, nextCursor } = await paginatedQuery(
    query.orderBy(cfg.orderBy, cfg.direction),
    limit,
    cursorDoc
  );

  const rows = docs.map(
    resource === 'students'
      ? (doc) => projectedStudentDoc(doc, 'finance')
      : resource === 'teachers'
        ? (doc) => ({
            uid: doc.id,
            displayName: String(
              doc.data()?.displayName || doc.data()?.name || doc.data()?.email || 'GV'
            ),
          })
        : docData
  );
  const visibleRows = resource === 'classes' ? filterClassRowsForContext(rows, ctx) : rows;
  return {
    items: visibleRows,
    [resource]: visibleRows,
    page: {
      resource,
      limit,
      nextCursor: nextCursor || null,
      hasMore: Boolean(nextCursor),
    },
  };
}

/**
 * Adds the sibling-group peers of the students on this page. Accounting is
 * server-paginated, so without this the client cannot expand a search result
 * into its siblings — nor price them, since ledgers are fetched by student id.
 *
 * The returned list keeps the original page first; pagination metadata must
 * still be derived from the original page, not from this widened list.
 */
export async function attachSiblingGroupMembers(
  db: AppDocumentStore.DocumentStore,
  docs: AppDocumentStore.QueryDocumentSnapshot[]
): Promise<AppDocumentStore.QueryDocumentSnapshot[]> {
  const groupIds = [
    ...new Set(docs.map((doc) => String(doc.data()?.siblingGroupId || '').trim()).filter(Boolean)),
  ];
  if (groupIds.length === 0) return docs;

  const snaps = await Promise.all(
    groupIds.map((groupId) =>
      db.collection('students').where('siblingGroupId', '==', groupId).get()
    )
  );
  const groupDocs = snaps.flatMap((snap) => snap.docs);

  // A merged child's retired profile keeps the family's group id, so the group
  // query returns two documents for one human. Deduplicating by document id
  // keeps both, and the family list is where that shows up as a phantom
  // sibling.
  const canonicalById = new Map<string, string>();
  await Promise.all(
    [...new Set([...docs, ...groupDocs].map((doc) => doc.id))].map(async (id) => {
      try {
        canonicalById.set(id, (await resolveCanonicalStudentId(db, id)).canonicalProfileId);
      } catch {
        // Unresolvable ids stand for themselves. Dropping them would remove a
        // real sibling from a family over a broken pointer.
        canonicalById.set(id, id);
      }
    })
  );
  const canonicalOf = (id: string) => canonicalById.get(id) ?? id;

  // Prefer the document that is itself canonical, so which twin appears does
  // not depend on the order the query happened to return them in.
  const ordered = [...groupDocs].sort(
    (left, right) =>
      Number(canonicalOf(right.id) === right.id) - Number(canonicalOf(left.id) === left.id)
  );

  const seen = new Set(docs.map((doc) => canonicalOf(doc.id)));
  const merged = [...docs];
  for (const doc of ordered) {
    const canonicalId = canonicalOf(doc.id);
    if (seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    merged.push(doc as AppDocumentStore.QueryDocumentSnapshot);
  }
  return merged;
}

/**
 * Pulls a family onto the page, the canonical way.
 *
 * The finance page groups siblings so a family is priced together. Doing that
 * from physical documents is how a merged child arrives twice, each row
 * carrying part of the balance — so the members are resolved and folded into
 * one row per human before anything is priced.
 */
async function attachCanonicalSiblings(
  db: DocumentStore,
  rows: CanonicalStudentReadRow[],
  onAnomaly: (anomaly: CanonicalStudentReadAnomaly) => void
): Promise<CanonicalStudentReadRow[]> {
  const groupIds = [
    ...new Set(rows.map((row) => String(row.profile.siblingGroupId || '').trim()).filter(Boolean)),
  ];
  if (groupIds.length === 0) return rows;

  const snaps = await Promise.all(
    groupIds.map((groupId) =>
      db.collection('students').where('siblingGroupId', '==', groupId).get()
    )
  );
  const memberIds = snaps.flatMap((snap) => snap.docs.map((doc) => doc.id));
  const members = await readCanonicalStudentsByIds(db, memberIds, onAnomaly);

  const byCanonicalId = new Map(rows.map((row) => [row.canonicalProfileId, row]));
  for (const row of members.values()) {
    if (!byCanonicalId.has(row.canonicalProfileId)) {
      byCanonicalId.set(row.canonicalProfileId, row);
    }
  }
  return [...byCanonicalId.values()];
}

export async function readAccountingStudents(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  assertFinanceAccess(ctx);
  const limit = getBoundedLimit(req, ADMIN_DASHBOARD_LIMIT, ADMIN_DASHBOARD_LIMIT);
  const classId = typeof req.query.classId === 'string' ? req.query.classId.trim() : '';

  // The admin student directory already gets its roster from the canonical
  // `students` channel. It needs this channel only for tuition ledgers, so do
  // not rebuild the same 700-row canonical directory a second time. Besides
  // wasting several seconds, that duplicate scan can occupy the whole small
  // VPS PostgreSQL pool and turn this optional enrichment into a 500.
  if (String(req.query.view || '').trim() === 'ledgers') {
    let ledgerQuery: Query = db.collection('course_fee_ledgers');
    if (classId) ledgerQuery = ledgerQuery.where('classId', '==', classId);
    const ledgerSnapshot = await ledgerQuery.limit(limit + 1).get();
    return {
      ledgers: ledgerSnapshot.docs.slice(0, limit).map(accountingLedgerSummary),
      ledgerLimit: limit,
      ledgerTruncated: ledgerSnapshot.docs.length > limit,
    };
  }

  const control = await readCanonicalStudentReadControl(db);
  const cursor = getCursor(req);

  const [classes, teachers] = await Promise.all([
    db.collection('classes').orderBy('name').limit(ADMIN_DASHBOARD_LIMIT).get(),
    db.collection('users').where('role', '==', 'teacher').limit(ADMIN_DASHBOARD_LIMIT).get(),
  ]);

  let students: Record<string, unknown>[];
  let studentIds: string[];
  let nextCursor: string | null;

  if (control.mode === 'legacy_compare') {
    let studentsQuery: Query = db.collection('students');
    if (classId) studentsQuery = studentsQuery.where('classId', '==', classId);
    const cursorDoc = cursor ? await resolveCursor(db, 'students', cursor) : null;
    const studentPage = await paginatedQuery(
      classId
        ? studentsQuery.orderBy(FieldPath.documentId())
        : studentsQuery.orderBy('name').orderBy(FieldPath.documentId()),
      limit,
      cursorDoc
    );
    const siblingAwareDocs = await attachSiblingGroupMembers(db, studentPage.docs);
    students = siblingAwareDocs.map((doc) => projectedStudentDoc(doc, 'finance'));
    studentIds = siblingAwareDocs.map((doc) => doc.id);
    nextCursor = studentPage.nextCursor || null;
    const comparedIds = studentIds;
    deferReadTelemetry(() =>
      recordLegacyStudentDiscrepancies(db, 'accounting_students', comparedIds)
    );
  } else {
    const anomalies: CanonicalStudentReadAnomaly[] = [];
    const onAnomaly = (anomaly: CanonicalStudentReadAnomaly) => anomalies.push(anomaly);
    let rows: CanonicalStudentReadRow[];
    if (classId) {
      rows = await listCanonicalClassRoster(db, { classId, onAnomaly });
      nextCursor = null;
    } else {
      const page = await listCanonicalStudentDirectory(db, { limit, cursor: cursor || undefined });
      anomalies.push(...page.anomalies);
      rows = page.rows;
      nextCursor = page.nextCursor;
    }
    assertNoCanonicalAnomalies(control.mode, anomalies);
    rows = await attachCanonicalSiblings(db, rows, onAnomaly);
    assertNoCanonicalAnomalies(control.mode, anomalies);
    students = rows.map((row) => projectCanonicalStudent(row, 'finance'));
    studentIds = rows.map((row) => row.canonicalProfileId);
  }

  const ledgers: Record<string, unknown>[] = [];
  const seenLedgerIds = new Set<string>();

  // DocumentStore caps an `in` filter at thirty ids, so a roster is a fan-out of
  // queries rather than one. Awaiting them one at a time made a 754-student
  // page wait through twelve round trips before the cap stopped it.
  //
  // The wave is what keeps the early exit: firing all twenty-six at once would
  // read the whole roster to fill a list that stops at three hundred rows.
  // Results are still consumed strictly in chunk order, so the rows — and
  // which of them the cap keeps — are the rows the sequential loop produced.
  for (const wave of chunks(chunks(studentIds, 30), ACCOUNTING_LEDGER_FAN_OUT)) {
    const waveSnaps = await Promise.all(
      wave.map((ids) =>
        db
          .collection('course_fee_ledgers')
          .where('studentId', 'in', ids)
          .limit(ACCOUNTING_LEDGER_PAGE_CAP)
          .get()
      )
    );

    for (const ledgerSnap of waveSnaps) {
      for (const ledgerDoc of ledgerSnap.docs) {
        if (seenLedgerIds.has(ledgerDoc.id)) continue;
        seenLedgerIds.add(ledgerDoc.id);
        ledgers.push(accountingLedgerSummary(ledgerDoc));
        if (ledgers.length >= ACCOUNTING_LEDGER_TOTAL_CAP) break;
      }
      if (ledgers.length >= ACCOUNTING_LEDGER_TOTAL_CAP) break;
    }

    if (ledgers.length >= ACCOUNTING_LEDGER_TOTAL_CAP) break;
  }

  return {
    classes: filterClassRowsForContext(classes.docs.map(docData), ctx),
    students,
    ledgers,
    ledgerLimit: ACCOUNTING_LEDGER_TOTAL_CAP,
    ledgerTruncated: ledgers.length >= ACCOUNTING_LEDGER_TOTAL_CAP,
    teachers: teachers.docs.map((doc) => ({
      uid: doc.id,
      displayName: String(doc.data().displayName || doc.data().name || doc.data().email || 'GV'),
    })),
    page: {
      limit,
      nextCursor,
      hasMore: Boolean(nextCursor),
    },
  };
}

export async function readAccountingStudentFinance(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
): Promise<AccountingStudentFinancePage> {
  assertFinanceAccess(ctx);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const searchTerms =
    typeof req.query.search === 'string' ? parseAccountingSearchTerms(req.query.search) : [];
  const classId = typeof req.query.classId === 'string' ? req.query.classId.trim() : '';
  const lifecycleScope = req.query.lifecycleScope === 'all' ? 'all' : 'current';
  const enrollmentStatus =
    typeof req.query.enrollmentStatus === 'string' ? req.query.enrollmentStatus : '';
  const paymentStatus = typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus : '';
  const cursorValue = typeof req.query.cursor === 'string' ? req.query.cursor : '';
  const offset = cursorValue
    ? Math.max(0, Number.parseInt(Buffer.from(cursorValue, 'base64url').toString('utf8'), 10) || 0)
    : 0;
  const today = getVietnamTodayStr();
  const studentSnap = await db.collection('students').orderBy('name').limit(5000).get();
  const rows = [];
  for (const studentDoc of studentSnap.docs || []) {
    const student = (studentDoc.data() || {}) as Record<string, unknown>;
    if (
      lifecycleScope === 'current' &&
      ['archived', 'dropped'].includes(String(student.studentLifecycle || ''))
    )
      continue;
    const enrollmentCollection = db.collection('student_course_enrollments');
    const ledgerCollection = db.collection('course_fee_ledgers');
    const enrollments =
      typeof enrollmentCollection?.where === 'function'
        ? (await enrollmentCollection.where('studentId', '==', studentDoc.id).get()).docs.map(
            (doc) => readStoredStudentCourseEnrollment(doc)
          )
        : [];
    if (
      classId &&
      !enrollments.some((row) => row.classId === classId) &&
      student.classId !== classId
    )
      continue;
    if (enrollmentStatus && !enrollments.some((row) => row.status === enrollmentStatus)) continue;
    const ledgers =
      typeof ledgerCollection?.where === 'function'
        ? (await ledgerCollection.where('studentId', '==', studentDoc.id).get()).docs.map(
            (doc) => ({
              id: doc.id,
              classId: doc.data().classId,
              termStart: doc.data().termStart,
              amount: doc.data().amount,
              discountTotal: doc.data().discountTotal,
              paidTotal: doc.data().paidTotal,
              dueDate: doc.data().dueDate,
              waived: doc.data().status === 'waived',
            })
          )
        : [];
    const summary = buildAccountingStudentSummary({
      student: { id: studentDoc.id, ...student },
      enrollments,
      ledgers,
      today,
    });
    if (!matchesAccountingSearchTerms(summary, searchTerms)) continue;
    if (paymentStatus && summary.currentCoursePaymentStatus !== paymentStatus) continue;
    rows.push(summary);
    // Keep collecting the bounded candidate set so cursor pagination can be
    // applied after all filters without leaking a count of excluded rows.
  }
  const pageRows = rows.slice(offset, offset + limit);
  const hasMore = offset + limit < rows.length;
  const nextCursor = hasMore
    ? Buffer.from(String(offset + limit), 'utf8').toString('base64url')
    : null;
  return {
    rows: pageRows,
    page: { nextCursor, hasMore },
    dataIncomplete: studentSnap.docs.length >= 5000,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Old vocabulary for the deprecated top-level `enrollmentStatus`.
 *
 * `waiting_for_placement` maps back to `promoted` on purpose. The field exists
 * during rollout so clients written against the old schema keep rendering, and
 * `promoted` is the value they already know for "finished a course, not in the
 * next one yet". The honest name lives in `placementStatus` beside it, and this
 * mapping disappears with the field.
 */
/** How many ids one shadow comparison will resolve. See its call site. */
const CANONICAL_COMPARE_MAX_IDS = 200;

const LEGACY_ENROLLMENT_STATUS: Record<CanonicalStudentPlacementStatus, string> = {
  trial: 'trial',
  studying: 'active',
  on_leave: 'on_leave',
  waiting_for_placement: 'promoted',
  inactive: 'dropped',
};

/**
 * Feeds canonical data through the existing field allowlist.
 *
 * The allowlist is unchanged: it is still what decides which fields a role may
 * see. What changes is where `classId`, `teacherId`, and `enrollmentStatus`
 * come from — the enrollment rather than the profile's stale copies of them.
 */
function projectCanonicalStudent(row: CanonicalStudentReadRow, view: StudentProjectionView) {
  return {
    ...projectStudent(
      {
        ...row.profile,
        id: row.canonicalProfileId,
        classId: row.currentClassId ?? '',
        teacherId: row.currentTeacherId ?? '',
        enrollmentStatus: LEGACY_ENROLLMENT_STATUS[row.placementStatus],
      },
      view
    ),
    canonicalProfileId: row.canonicalProfileId,
    placementStatus: row.placementStatus,
    ...(row.redirected ? { requestedProfileId: row.requestedProfileId, redirected: true } : {}),
    // Expose the exact attendance enrollment so the UI can build the eligibility
    // resolver without needing a separate DocumentStore query.
    ...(row.scopedEnrollment ? { attendanceEnrollment: row.scopedEnrollment } : {}),
  };
}

function assertNoCanonicalAnomalies(
  mode: CanonicalStudentReadMode,
  anomalies: readonly CanonicalStudentReadAnomaly[]
) {
  if (mode !== 'canonical_required' || anomalies.length === 0) return;
  // Required mode is the point at which the enrollment is the only answer, so
  // a profile it cannot answer for is an invariant failure rather than a row to
  // drop. Dropping it is how a student disappears from a roster silently.
  const detail = anomalies
    .slice(0, 5)
    .map((anomaly) => `${anomaly.requestedProfileId}:${anomaly.code}`)
    .join(', ');
  throw withStatus(
    `CANONICAL_STUDENT_READ_INVARIANT: ${anomalies.length} profile(s) could not be derived (${detail})`,
    409
  );
}

/**
 * Shadow comparison, scoped to the page that was actually served.
 *
 * Comparing a legacy page against the whole canonical directory would report
 * every student not on this page as missing. Resolving the page's own ids is
 * the comparison that means something: several of them collapsing into one
 * canonical profile is the duplicate pattern itself.
 */
async function recordLegacyStudentDiscrepancies(
  db: DocumentStore,
  surface: string,
  legacyIds: string[]
): Promise<void> {
  if (legacyIds.length === 0) return;
  // Bounded on purpose. Comparison runs inside the request, and `legacy_compare`
  // is what production serves first, so an unbounded version would add a read
  // per student to every list — three thousand of them on the index view.
  // Detecting that discrepancies exist does not need the whole page.
  const sample = legacyIds.slice(0, CANONICAL_COMPARE_MAX_IDS);
  try {
    const rows = await readCanonicalStudentsByIds(db, sample);
    recordCanonicalReadDiscrepancies(
      await compareCanonicalStudentReadSets(db, surface, sample, [...rows.values()])
    );
  } catch (error) {
    // Shadow mode observes; it never decides. A comparison that fails must not
    // turn a working read into an error for the user in front of it.
    console.warn('[canonical-read-compare-failed]', surface, String(error));
  }
}

export async function readStudents(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  const control = await readCanonicalStudentReadControl(db);
  if (control.mode !== 'legacy_compare') {
    return readStudentsCanonical(db, ctx, req, control.mode);
  }

  const result = await readStudentsLegacy(db, ctx, req);
  const legacyIds = result.students
    .map((student) => String((student as { id?: unknown }).id || ''))
    .filter(Boolean);
  deferReadTelemetry(() => recordLegacyStudentDiscrepancies(db, 'students', legacyIds));
  return result;
}

/**
 * The canonical answer.
 *
 * Every scope here starts from enrollments. The teacher scope is the clearest
 * example of why: it used to filter `students.teacherId`, a projection that
 * goes stale the moment a student moves, so a teacher kept seeing students who
 * had left and lost students who had arrived.
 */
async function readStudentsCanonical(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest,
  mode: CanonicalStudentReadMode
) {
  const view = getRequestedStudentProjection(req);
  authorizeStudentProjection(ctx, view);
  const classId = typeof req.query.classId === 'string' ? req.query.classId : '';
  const limit =
    view === 'index' ? STUDENTS_COMPLETE_INDEX_MAX : getLimit(req, 200, STUDENTS_READ_MAX_LIMIT);
  const cursor = getCursor(req) || undefined;
  const anomalies: CanonicalStudentReadAnomaly[] = [];
  const onAnomaly = (anomaly: CanonicalStudentReadAnomaly) => anomalies.push(anomaly);

  if (ctx.role === 'student' || ctx.role === 'parent') {
    if (!ctx.studentId) throw withAuthzStatus('Student account is not linked', 403);
    await assertCanReadStudentScopedResource(db, ctx, ctx.studentId);
    const row = await readCanonicalStudentContext(db, ctx.studentId);
    return {
      students: [projectCanonicalStudent(row, view)],
      page: { limit, nextCursor: null, hasMore: false },
    };
  }

  const empty = { students: [], page: { limit, nextCursor: null, hasMore: false } };
  let rows: CanonicalStudentReadRow[];

  if (classId) {
    const classData = await assertClassAccess(db, ctx, classId, 'read');
    if (!isClassVisibleForRoleOutsideAdminDashboard(classData, ctx.role)) return empty;
    rows = await listCanonicalClassRoster(db, { classId, onAnomaly });
  } else if (ctx.role === 'teacher') {
    const classesSnap = await db.collection('classes').where('teacherId', '==', ctx.uid).get();
    const rosters: CanonicalStudentReadRow[][] = [];
    // A class roster fans out into profile, enrollment and teacher lookups for
    // every student. Starting every class at once can enqueue hundreds of
    // PostgreSQL operations, exhaust the pool and turn one slow roster into a
    // failed teacher dashboard. Keep each class bounded to the pool before
    // moving to the next one.
    for (const doc of classesSnap.docs) {
      rosters.push(await listCanonicalClassRoster(db, { classId: doc.id, onAnomaly }));
    }
    // A teacher with two classes can hold the same student twice only if the
    // data is already broken, but the roster must still show one row per human.
    const byCanonicalId = new Map<string, CanonicalStudentReadRow>();
    for (const row of rosters.flat()) byCanonicalId.set(row.canonicalProfileId, row);
    rows = [...byCanonicalId.values()];
  } else if (ctx.role === 'admin' || ctx.role === 'accounting' || ctx.role === 'office') {
    const page = await listCanonicalStudentDirectory(db, { limit, cursor });
    assertNoCanonicalAnomalies(mode, page.anomalies);
    return buildCanonicalStudentsResponse(db, page.rows, view, limit, page.nextCursor);
  } else {
    requireRole(ctx, ['admin']);
    return empty;
  }

  assertNoCanonicalAnomalies(mode, anomalies);
  const paged = paginateCanonicalRows(rows, limit, cursor);
  return buildCanonicalStudentsResponse(db, paged.page, view, limit, paged.nextCursor);
}

async function buildCanonicalStudentsResponse(
  db: DocumentStore,
  rows: readonly CanonicalStudentReadRow[],
  view: StudentProjectionView,
  limit: number,
  nextCursor: string | null
) {
  const students = rows.map((row) => projectCanonicalStudent(row, view));
  if (view !== 'index') {
    return { students, page: { limit, nextCursor, hasMore: Boolean(nextCursor) } };
  }
  if (students.length > STUDENTS_COMPLETE_INDEX_MAX) {
    const error = withStatus(
      'Student dataset exceeds the supported maximum of 3000',
      409
    ) as Error & { errorCode?: string };
    error.errorCode = 'dataset_limit_exceeded';
    throw error;
  }
  const eventSnap = await db.collection('realtime_events').doc('students').get();
  return {
    students,
    meta: {
      total: students.length,
      complete: true,
      maxSupported: STUDENTS_COMPLETE_INDEX_MAX,
      version: Number(eventSnap.data()?.version || 0),
      generatedAt: new Date().toISOString(),
    },
    page: { limit: STUDENTS_COMPLETE_INDEX_MAX, nextCursor: null, hasMore: false },
  };
}

async function readStudentsLegacy(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  const view = getRequestedStudentProjection(req);
  authorizeStudentProjection(ctx, view);
  const classId = typeof req.query.classId === 'string' ? req.query.classId : '';
  const limit =
    view === 'index' ? STUDENTS_COMPLETE_INDEX_MAX : getLimit(req, 200, STUDENTS_READ_MAX_LIMIT);
  let query: Query = db.collection('students');
  if (ctx.role === 'teacher') query = query.where('teacherId', '==', ctx.uid);
  else if (ctx.role === 'student' || ctx.role === 'parent') {
    if (!ctx.studentId) throw withAuthzStatus('Student account is not linked', 403);
    const student = await assertCanReadStudentScopedResource(db, ctx, ctx.studentId);
    return {
      students: [projectStudent({ id: ctx.studentId, ...student }, view)],
      page: { limit, nextCursor: null, hasMore: false },
    };
  } else if (ctx.role !== 'admin' && ctx.role !== 'accounting' && ctx.role !== 'office') {
    requireRole(ctx, ['admin']);
  }
  if (classId) {
    const classData = await assertClassAccess(db, ctx, classId, 'read');
    if (!isClassVisibleForRoleOutsideAdminDashboard(classData, ctx.role)) {
      return {
        students: [],
        page: { limit, nextCursor: null, hasMore: false },
      };
    }
    query = query.where('classId', '==', classId);
  }

  if (view === 'index') {
    const [studentsSnap, eventSnap] = await Promise.all([
      query
        .select(...STUDENT_INDEX_QUERY_FIELDS)
        .orderBy('name')
        .limit(STUDENTS_COMPLETE_INDEX_MAX + 1)
        .get(),
      db.collection('realtime_events').doc('students').get(),
    ]);

    if (studentsSnap.docs.length > STUDENTS_COMPLETE_INDEX_MAX) {
      const error = withStatus(
        'Student dataset exceeds the supported maximum of 3000',
        409
      ) as Error & { errorCode?: string };
      error.errorCode = 'dataset_limit_exceeded';
      throw error;
    }

    return {
      students: studentsSnap.docs.map((doc) => projectedStudentDoc(doc, view)),
      meta: {
        total: studentsSnap.docs.length,
        complete: true,
        maxSupported: STUDENTS_COMPLETE_INDEX_MAX,
        version: Number(eventSnap.data()?.version || 0),
        generatedAt: new Date().toISOString(),
      },
      page: {
        limit: STUDENTS_COMPLETE_INDEX_MAX,
        nextCursor: null,
        hasMore: false,
      },
    };
  }

  const cursor = getCursor(req);
  const cursorDoc = cursor ? await resolveCursor(db, 'students', cursor) : null;
  const hasEqualityFilter = ctx.role === 'teacher' || Boolean(classId);
  const { docs, nextCursor } = await paginatedQuery(
    hasEqualityFilter
      ? query.orderBy(FieldPath.documentId())
      : query.orderBy('name').orderBy(FieldPath.documentId()),
    limit,
    cursorDoc
  );
  return {
    students: docs.map((doc) => projectedStudentDoc(doc, view)),
    page: {
      limit,
      nextCursor: nextCursor || null,
      hasMore: Boolean(nextCursor),
    },
  };
}

export async function readClasses(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  const limit = getLimit(req, 200);
  if (ctx.role === 'teacher') {
    const snap = await db
      .collection('classes')
      .where('teacherId', '==', ctx.uid)
      .limit(limit)
      .get();
    return {
      classes: filterClassRowsForContext(snap.docs.map(docData), ctx),
      page: { limit, nextCursor: null, hasMore: false },
    };
  }
  if (ctx.role === 'student' || ctx.role === 'parent') {
    if (!ctx.classId) return { classes: [], page: { limit, nextCursor: null, hasMore: false } };
    const snap = await db.collection('classes').doc(ctx.classId).get();
    const classes = snap.exists ? filterClassRowsForContext([docData(snap)], ctx) : [];
    return {
      classes,
      page: { limit, nextCursor: null, hasMore: false },
    };
  }

  requireRole(ctx, ['admin', 'accounting', 'office']);
  const cursor = getCursor(req);
  const cursorDoc = cursor ? await resolveCursor(db, 'classes', cursor) : null;
  const { docs, nextCursor } = await paginatedQuery(
    db.collection('classes').orderBy('name'),
    limit,
    cursorDoc
  );
  return {
    classes: filterClassRowsForContext(docs.map(docData), ctx),
    page: { limit, nextCursor: nextCursor || null, hasMore: Boolean(nextCursor) },
  };
}

export async function readOfficeAcademic(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'office']);
  const view = typeof req.query.view === 'string' ? req.query.view : 'full';
  if (!['full', 'summary', 'detail', 'notifications', 'teacher-references'].includes(view)) {
    throw withAuthzStatus('Unknown office academic view', 400);
  }
  const limit = getLimit(req, 200);

  // Class and teacher screens only need this small directory to paint their
  // first useful state. Keep it ahead of every class/roster/evaluation query.
  if (view === 'teacher-references') {
    const usersSnap = await db
      .collection('users')
      .where('role', '==', 'teacher')
      .limit(limit)
      .get();
    const teachers = usersSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        uid: doc.id,
        displayName: String(data.displayName || data.name || ''),
        email: String(data.email || ''),
        phone: String(data.phone || ''),
        role: String(data.role || ''),
        blockedTeacher: Boolean(data.blockedTeacher),
      };
    });

    return {
      classes: [],
      teachers,
      page: { limit, nextCursor: null, hasMore: false },
    };
  }

  const cursor = getCursor(req);
  const cursorDoc = cursor ? await resolveCursor(db, 'classes', cursor) : null;

  const [classesResult, usersSnap] = await Promise.all([
    paginatedQuery(db.collection('classes').orderBy('name'), limit, cursorDoc),
    db.collection('users').where('role', '==', 'teacher').limit(limit).get(),
  ]);

  const classes = filterClassRowsForContext(classesResult.docs.map(docData), ctx).filter(
    isOfficeAcademicClassVisible
  );
  const classIds = classes.map((classRow) => String(classRow.id || '')).filter(Boolean);
  const visibleClassIds = new Set(classIds);
  const teachers = usersSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      uid: doc.id,
      displayName: String(data.displayName || data.name || ''),
      email: String(data.email || ''),
      role: String(data.role || ''),
    };
  });

  const currentCourseIds = classes
    .map((classRow) => String(classRow.currentCourseId || ''))
    .filter(Boolean);
  const [notificationDocs, courseRosters, evaluationDocs, ledgerDocs] = await Promise.all([
    queryOfficeAcademicNotificationsByCourseIds(db, currentCourseIds),
    loadCourseTermRosters(
      db,
      classes.map((classRow) => ({
        classId: String(classRow.id || ''),
        termStart: String(classRow.startDate || '') || undefined,
      }))
    ),
    queryOfficeAcademicByClassIds(db, 'evaluations', classIds, limit),
    queryOfficeAcademicByClassIds(db, 'course_fee_ledgers', classIds, limit),
  ]);

  const studentDocsByClass = new Map<string, DocumentSnapshot[]>();
  const studentRows: Record<string, unknown>[] = [];

  for (const classRow of classes) {
    const classId = String(classRow.id || '');
    const members = courseRosters.get(classId) || [];
    studentDocsByClass.set(
      classId,
      members.map((member) => member.studentDoc)
    );
    for (const member of members) {
      studentRows.push(
        projectedStudentDoc(
          contextDoc(member.studentDoc.id, {
            ...(member.studentDoc.data() || {}),
            classId,
          }),
          'directory'
        )
      );
    }
  }

  const evaluationRows = filterRowsToVisibleClasses(
    evaluationDocs.map(docData),
    visibleClassIds,
    ctx
  );
  const ledgerRows = filterRowsToVisibleClasses(
    ledgerDocs.map(projectedLedgerDoc),
    visibleClassIds,
    ctx
  );
  const notificationRows = filterRowsToVisibleClasses(
    notificationDocs.map(projectedZaloNotificationDoc),
    visibleClassIds,
    ctx
  );
  const classDocsById = new Map(classesResult.docs.map((doc) => [doc.id, doc]));
  const evaluationDocsByClass = new Map<string, typeof evaluationDocs>();
  for (const doc of evaluationDocs) {
    const classId = String(doc.data()?.classId || '');
    if (!visibleClassIds.has(classId)) continue;
    const docs = evaluationDocsByClass.get(classId) || [];
    docs.push(doc);
    evaluationDocsByClass.set(classId, docs);
  }
  const notificationDocsByCourse = new Map<string, ReturnType<typeof contextDoc>[]>();
  for (const doc of notificationDocs) {
    const projected = projectedZaloNotificationDoc(doc);
    const courseId = String(projected.courseId || '');
    if (!courseId) continue;
    const docs = notificationDocsByCourse.get(courseId) || [];
    docs.push(contextDoc(doc.id, projected));
    notificationDocsByCourse.set(courseId, docs);
  }
  const classesById = new Map(classes.map((classRow) => [String(classRow.id || ''), classRow]));
  const currentCourseRecordFilter = (record: Record<string, unknown>) => {
    const classRow = classesById.get(String(record.classId || ''));
    return Boolean(classRow && isCurrentAcademicCourseRecord(record, classRow));
  };
  const currentEvaluationRows = evaluationRows.filter(currentCourseRecordFilter);
  const currentLedgerRows = ledgerRows.filter(currentCourseRecordFilter);
  const currentNotificationRows = notificationRows.filter(currentCourseRecordFilter);
  const studentsByClass: Record<string, Record<string, unknown>[]> = {};
  for (const student of studentRows) {
    const classId = String(student.classId || '');
    if (!classId) continue;
    studentsByClass[classId] ||= [];
    studentsByClass[classId].push(student);
  }

  const rankSentByClass: Record<string, Set<string>> = {};
  const tuitionSentByClass: Record<string, Set<string>> = {};
  const failedNotificationsByClass: Record<string, number> = {};
  const evaluationNoticeTypes = new Set(['evaluation', 'evaluation_notice']);
  const tuitionNoticeTypes = new Set(['next_course_tuition', 'tuition_notice']);
  for (const notification of currentNotificationRows) {
    const classId = String(notification.classId || '');
    const studentId = String(notification.studentId || '');
    const type = String(notification.type || '');
    const status = String(notification.status || '');
    if (!classId || !studentId) continue;
    if (status === 'sent' && type === 'rank_achievement') {
      addSetItem(rankSentByClass, classId, studentId);
    }
    if (status === 'sent' && tuitionNoticeTypes.has(type)) {
      addSetItem(tuitionSentByClass, classId, studentId);
    }
    if (status === 'failed' && (evaluationNoticeTypes.has(type) || tuitionNoticeTypes.has(type))) {
      failedNotificationsByClass[classId] = (failedNotificationsByClass[classId] || 0) + 1;
    }
  }

  const summaries: Record<
    string,
    {
      classId: string;
      eligibleStudentCount: number;
      finalEvaluationCount: number;
      isEvaluationComplete: boolean;
      evaluationSentCount: number;
      tuitionNoticeSentCount: number;
      missingEvaluationStudentIds: string[];
      failedNotificationCount: number;
      evaluationSentStudentIds: string[];
      rankSentStudentIds: string[];
      tuitionNoticeSentStudentIds: string[];
      courseClosing: CourseClosingSnapshot;
    }
  > = {};

  for (const classRow of classes) {
    const classId = String(classRow.id || '');
    const courseId = String(classRow.currentCourseId || '');
    const classDoc = classDocsById.get(classId) || contextDoc(classId, classRow);
    const classStudentDocs = (studentDocsByClass.get(classId) || []) as DocumentSnapshot[];
    const classEvaluationDocs = (evaluationDocsByClass.get(classId) ||
      []) as QueryDocumentSnapshot[];
    const courseClosing = snapshotFromCourseClosingContext({
      classDoc,
      courseId,
      students: classStudentDocs,
      evaluations: classEvaluationDocs,
      sentNotifications: (notificationDocsByCourse.get(courseId) ||
        []) as unknown as QueryDocumentSnapshot[],
    });
    const eligibleStudents = (studentsByClass[classId] || []).filter(
      isRequiredAcademicEvaluationStudent
    );
    const lockedEvaluationIds = new Set(courseClosing.lockedEvaluationIds);
    const evaluationSentStudentIds = classEvaluationDocs
      .filter((doc) => lockedEvaluationIds.has(doc.id))
      .map((doc) => String(doc.data()?.studentId || ''))
      .filter(Boolean);
    const selectedEvaluationByStudent = new Map<string, Record<string, unknown>>();
    for (const student of eligibleStudents) {
      const studentId = String(student.id || '');
      const candidates: Array<AcademicEvaluationLike & { id: string; evaluationVersion: string }> =
        classEvaluationDocs
          .filter((doc) => String(doc.data()?.studentId || '') === studentId)
          .map((doc) => ({
            ...((doc.data() || {}) as AcademicEvaluationLike),
            id: doc.id,
            evaluationVersion: evaluationVersion(doc),
          }))
          .filter((evaluation) => isCurrentAcademicCourseRecord(evaluation, classRow));
      const selected = selectFinalEvaluation(candidates);
      if (selected) selectedEvaluationByStudent.set(studentId, selected);
    }
    const rankSentStudentIds = [...(rankSentByClass[classId] || new Set<string>())].filter(
      (studentId) => {
        const evaluation = selectedEvaluationByStudent.get(studentId);
        return Boolean(
          evaluation &&
          currentNotificationRows.some(
            (notification) =>
              String(notification.classId || '') === classId &&
              String(notification.studentId || '') === studentId &&
              String(notification.type || '') === 'rank_achievement' &&
              String(notification.status || '') === 'sent' &&
              String(notification.evaluationId || '') === String(evaluation.id || '') &&
              String(notification.evaluationVersion || '') ===
                String(evaluation.evaluationVersion || '')
          )
        );
      }
    );
    const tuitionNoticeSentStudentIds = [...(tuitionSentByClass[classId] || new Set<string>())];
    summaries[classId] = {
      classId,
      eligibleStudentCount: courseClosing.requiredStudentCount,
      finalEvaluationCount: courseClosing.finalEvaluationCount,
      isEvaluationComplete:
        courseClosing.requiredStudentCount > 0 &&
        courseClosing.finalEvaluationCount === courseClosing.requiredStudentCount,
      evaluationSentCount: courseClosing.evaluationSentCount,
      tuitionNoticeSentCount: courseClosing.tuitionSentCount,
      missingEvaluationStudentIds: courseClosing.missingEvaluationStudentIds,
      failedNotificationCount: failedNotificationsByClass[classId] || 0,
      evaluationSentStudentIds,
      rankSentStudentIds,
      tuitionNoticeSentStudentIds,
      courseClosing,
    };
  }

  const base = {
    classes,
    summaries,
    teachers,
    page: {
      limit,
      nextCursor: classesResult.nextCursor || null,
      hasMore: Boolean(classesResult.nextCursor),
    },
  };

  if (view === 'summary') {
    return {
      ...base,
      students: [],
      evaluations: [],
      ledgers: [],
      notifications: [],
    };
  }

  if (view === 'notifications') {
    return {
      ...base,
      students: [],
      evaluations: [],
      ledgers: [],
      notifications: currentNotificationRows,
    };
  }

  return {
    ...base,
    students: studentRows,
    evaluations: currentEvaluationRows,
    ledgers: currentLedgerRows,
    notifications: currentNotificationRows,
  };
}

export async function readClassDetail(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'teacher', 'office']);
  const classId = String(req.query.classId || '');
  const classData = await assertClassAccess(db, ctx, classId, 'read');
  if (!isClassVisibleForRoleOutsideAdminDashboard(classData, ctx.role)) {
    throw withAuthzStatus('Class not found', 404);
  }
  const requestedTermStart =
    typeof req.query.attendanceTermStart === 'string' ? req.query.attendanceTermStart.trim() : '';
  if (
    requestedTermStart &&
    !buildClassTerms({ id: classId, ...classData }).some(
      (term) => term.startDate === requestedTermStart
    )
  ) {
    throw withStatus('Attendance term does not belong to this class', 400);
  }
  const rosterTermStart = requestedTermStart || String(classData.startDate || '') || undefined;
  const courseRosters = await loadCourseTermRosters(db, [{ classId, termStart: rosterTermStart }]);
  const studentView: StudentProjectionView = canReadStudentDirectory(ctx)
    ? 'directory'
    : 'academic';
  const roster = (courseRosters.get(classId) || []).map(({ studentDoc, enrollmentDoc }) => {
    const projected = projectedStudentDoc(
      contextDoc(studentDoc.id, {
        ...(studentDoc.data() || {}),
        classId,
      }),
      studentView
    );
    if (!enrollmentDoc) return projected;
    const enrollmentData = enrollmentDoc.data() || {};
    const attendanceEnrollment: CanonicalStudentEnrollmentView = {
      id: enrollmentDoc.id,
      classId: String(enrollmentData.classId || ''),
      termStart: String(enrollmentData.termStart || ''),
      termEnd: typeof enrollmentData.termEnd === 'string' ? enrollmentData.termEnd : null,
      joinedAt: String(enrollmentData.joinedAt || ''),
      endedAt: typeof enrollmentData.endedAt === 'string' ? enrollmentData.endedAt : null,
      status: String(enrollmentData.status || '') as StudentCourseEnrollmentStatus,
    };
    return { ...projected, attendanceEnrollment };
  });

  if (String(req.query.view || '') === 'roster') return { students: roster };

  const limit = getLimit(req, 200);
  const [attendance, evaluations, sessions, reports] = await Promise.all([
    db
      .collection('attendance')
      .where('classId', '==', classId)
      .orderBy('date', 'desc')
      .limit(limit)
      .get(),
    db.collection('evaluations').where('classId', '==', classId).limit(limit).get(),
    db.collection('class_sessions').where('classId', '==', classId).limit(limit).get(),
    db.collection('dailyReports').where('classId', '==', classId).limit(limit).get(),
  ]);
  const classDoc = contextDoc(classId, classData);

  return {
    class:
      ctx.role === 'student' || ctx.role === 'parent' || ctx.role === 'office'
        ? projectedClassDoc(classDoc)
        : docData(classDoc),
    students: roster,
    attendance: attendance.docs
      .filter((doc) => doc.data()?.isVoided !== true)
      .map((doc) => projectedAttendanceForRole(doc, ctx.role)),
    evaluations: evaluations.docs
      .filter((doc) => doc.data()?.isDeleted !== true)
      .map((doc) => projectedEvaluationForRole(doc, ctx.role)),
    sessions: sessions.docs.map((doc) => projectedSessionForRole(doc, ctx.role)),
    reports: reports.docs.map((doc) => projectedReportForRole(doc, ctx.role)),
  };
}

export async function readAssignments(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  const view = typeof req.query.view === 'string' ? req.query.view : 'full';
  let assignmentsQuery: Query = db.collection('assignments');
  let submissionsQuery: Query = db.collection('submissions');
  if (ctx.role === 'teacher') {
    assignmentsQuery = assignmentsQuery.where('teacherId', '==', ctx.uid);
    submissionsQuery = submissionsQuery.where('teacherId', '==', ctx.uid);
  } else if (ctx.role === 'student') {
    if (!ctx.studentId || !ctx.classId) throw withAuthzStatus('Student account is not linked', 403);
    assignmentsQuery = assignmentsQuery.where('classId', '==', ctx.classId);
    submissionsQuery = submissionsQuery.where('studentId', '==', ctx.studentId);
  } else {
    requireRole(ctx, ['admin']);
  }

  // The student directory needs only grades for its GPA column. Avoid reading
  // and serializing the assignments collection for a screen that never uses
  // it, and trim non-graded submissions before they cross the network.
  if (view === 'graded-submissions') {
    const submissions = await submissionsQuery.limit(getLimit(req, 200)).get();
    return {
      assignments: [],
      submissions: submissions.docs
        .filter((doc) => doc.data()?.isDeleted !== true && doc.data()?.status === 'graded')
        .map((doc) => projectedSubmissionDoc(doc, ctx.role)),
      serverTime: Date.now(),
    };
  }

  const [assignments, submissions] = await Promise.all([
    assignmentsQuery.limit(getLimit(req, 200)).get(),
    submissionsQuery.limit(getLimit(req, 200)).get(),
  ]);
  let assignmentDocs = assignments.docs.filter((doc) => doc.data()?.isDeleted !== true);
  if (ctx.role === 'student') {
    assignmentDocs = assignmentDocs.filter((doc) => {
      const data = doc.data() || {};
      return canStudentAccessAssignment(
        { classId: data.classId, deliveryPolicy: data.deliveryPolicy },
        { classId: ctx.classId, studentId: ctx.studentId }
      );
    });
  }
  return {
    assignments: assignmentDocs.map((doc) => projectedAssignmentDoc(doc, ctx.role)),
    submissions: submissions.docs
      .filter((doc) => doc.data()?.isDeleted !== true)
      .map((doc) => projectedSubmissionDoc(doc, ctx.role)),
    serverTime: Date.now(),
  };
}

/**
 * The canonical profile behind a linked student or parent account.
 *
 * The account's stored `studentId` was correct when it was written and may
 * since have been merged away. Reading it literally returns nothing — and on a
 * tuition page, nothing is indistinguishable from "you owe nothing".
 *
 * An unresolvable link falls back to the stored id rather than failing. A
 * broken pointer is not evidence the account should be locked out, and the
 * records written under that id are still the best answer available.
 */
async function scopedStudentId(db: DocumentStore, ctx: UserContext): Promise<string> {
  const linked = String(ctx.studentId || '');
  if (!linked) throw withAuthzStatus('Student account is not linked', 403);
  try {
    return (await resolveCanonicalStudentId(db, linked)).canonicalProfileId;
  } catch {
    return linked;
  }
}

export async function readNotifications(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  const limit = getLimit(req, 100);
  if (ctx.role === 'student' || ctx.role === 'parent') {
    const studentId = await scopedStudentId(db, ctx);
    const snap = await db
      .collection('notifications')
      .where('studentId', '==', studentId)
      .limit(limit)
      .get();
    return { notifications: snap.docs.map(projectedNotificationDoc) };
  }
  if (ctx.role === 'teacher') {
    const snap = await db
      .collection('notifications')
      .where('teacherId', '==', ctx.uid)
      .limit(limit)
      .get();
    return { notifications: snap.docs.map(projectedNotificationDoc) };
  }
  requireRole(ctx, ['admin']);
  const snap = await db.collection('notifications').limit(limit).get();
  return { notifications: snap.docs.map(docData) };
}

export async function readParentDashboard(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['parent', 'student']);
  if (!ctx.studentId) throw withAuthzStatus('Student account is not linked', 403);
  const limit = getBoundedLimit(req, PARENT_DASHBOARD_LIMIT, PARENT_DASHBOARD_LIMIT);
  const key = readCacheKey({
    channel: 'parent-dashboard',
    role: ctx.role,
    uid: ctx.uid,
    params: { studentId: ctx.studentId, limit },
  });

  return parentDashboardCache.get(key, () => buildParentDashboard(db, ctx, limit));
}

export async function readParentTuition(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['parent']);
  if (!ctx.studentId) throw withAuthzStatus('Parent account is not linked', 403);
  const limit = getBoundedLimit(req, PARENT_DASHBOARD_LIMIT, PARENT_DASHBOARD_LIMIT);
  const studentId = await scopedStudentId(db, ctx);
  const key = readCacheKey({
    channel: 'parent-tuition',
    role: ctx.role,
    uid: ctx.uid,
    // Keyed on the canonical id: two accounts naming the same child through
    // different ids are asking the same question and must not cache apart.
    params: { studentId, limit },
  });
  return parentTuitionCache.get(key, async () => {
    const [ledgers, receipts, invoices, payments] = await Promise.all([
      db.collection('course_fee_ledgers').where('studentId', '==', studentId).limit(limit).get(),
      db
        .collection('receipts')
        .where('studentId', '==', studentId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get(),
      db
        .collection('invoices')
        .where('studentId', '==', studentId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get(),
      db
        .collection('payment_requests')
        .where('studentId', '==', studentId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get(),
    ]);
    return {
      ledgers: ledgers.docs.map(parentLedgerSummary),
      receipts: receipts.docs.map(parentReceiptSummary),
      invoices: invoices.docs.map(parentInvoiceSummary),
      payments: payments.docs.map(parentPaymentSummary),
    };
  });
}

export async function readAuditLog(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin']);
  const limit = getLimit(req, 100);
  const cursor = getCursor(req);
  const filters = resolveAuditLogFilters(req);
  let query: Query = db.collection('audit_logs').orderBy('timestamp', 'desc');

  if (filters.action) query = query.where('action', '==', filters.action);
  if (filters.collectionName) {
    query = query.where('collection', '==', filters.collectionName);
  }
  query = query.where('timestamp', '>=', filters.startIso);
  query = query.where('timestamp', '<=', filters.endIso);

  const cursorDoc = cursor ? await resolveCursor(db, 'audit_logs', cursor) : null;
  const { docs, nextCursor } = await paginatedQuery(query, limit, cursorDoc);
  const users = await fetchAuditUsersByIds(db, collectAuditUserIds(docs));
  return {
    logs: docs.map(docData),
    users,
    page: {
      limit,
      nextCursor: nextCursor || null,
      hasMore: Boolean(nextCursor),
    },
  };
}

export async function readPasswordResetRequests(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin', 'teacher']);
  let query: Query = db.collection('passwordResetRequests');
  if (ctx.role === 'teacher') query = query.where('teacherId', '==', ctx.uid);
  const snap = await query.orderBy('createdAt', 'desc').limit(getLimit(req, 100)).get();
  return { requests: snap.docs.map(docData) };
}

function officeWeeklyDashboardClass(doc: AppDocumentStore.QueryDocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    name: String(data.name || ''),
    teacherId: String(data.teacherId || ''),
    schedule: typeof data.schedule === 'string' ? data.schedule : '',
    daysOfWeek: Array.isArray(data.daysOfWeek) ? (data.daysOfWeek as number[]) : [],
    startDate: typeof data.startDate === 'string' ? data.startDate : '',
    endDate: typeof data.endDate === 'string' ? data.endDate : '',
    startTime: typeof data.startTime === 'string' ? data.startTime : '',
    room: typeof data.room === 'string' ? data.room : '',
    status: typeof data.status === 'string' ? data.status : '',
    grade: getClassGrade(data) || null,
    holidays: Array.isArray(data.holidays) ? (data.holidays as string[]) : [],
    terms: Array.isArray(data.terms) ? data.terms : [],
    weeklySessions: Array.isArray(data.weeklySessions) ? data.weeklySessions : [],
  };
}

function officeWeeklyDashboardTeacher(doc: AppDocumentStore.QueryDocumentSnapshot) {
  const data = doc.data() || {};
  return {
    uid: doc.id,
    displayName: String(data.displayName || data.name || data.email || ''),
    email: String(data.email || ''),
  };
}

export async function readOfficeWeeklyDashboard(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['office']);
  const limit = getLimit(req, 2000);

  const [classesSnap, teachersSnap] = await Promise.all([
    db.collection('classes').limit(limit).get(),
    db.collection('users').where('role', '==', 'teacher').limit(limit).get(),
  ]);

  const visibleClassDocs = classesSnap.docs.filter((doc) => isClassDocVisibleForContext(doc, ctx));
  const classIds = visibleClassDocs.map((doc) => doc.id);
  const visibleClassIds = new Set(classIds);
  const studentsSnaps =
    classIds.length === 0
      ? []
      : await Promise.all(
          chunks(classIds, 30).map((ids) =>
            db.collection('students').where('classId', 'in', ids).limit(limit).get()
          )
        );

  const studentDocs = studentsSnaps.flatMap((snap) => snap.docs).slice(0, limit);

  return {
    classes: visibleClassDocs
      .map(officeWeeklyDashboardClass)
      .sort((a, b) => a.name.localeCompare(b.name)),
    teachers: teachersSnap.docs
      .map(officeWeeklyDashboardTeacher)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    studentCounts: buildOfficeDashboardStudentCounts(studentDocs, visibleClassIds),
    serverTime: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Student Admin Report reader
// ---------------------------------------------------------------------------

const STUDENT_ADMIN_REPORT_ATTENDANCE_LIMIT = 5000;
const STUDENT_ADMIN_REPORT_LEDGER_LIMIT = 200;

function getVietnamTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * `students.enrollmentDate` is written as `FieldValue.serverTimestamp()`
 * (`server/api/students/handlers/status.ts`), so on a real document it comes
 * back as a DocumentStore `Timestamp`, never a string. A `typeof === 'string'`
 * check silently no-ops on every production record, disabling the D3
 * eligibility floor for the one class of student it exists to cover — a
 * trial/admissions student whose classId was assigned without a courseJoins
 * entry. Mirrors the Timestamp/Date/seconds-object handling already used by
 * `server/api/lib/student/enrollmentDate.ts`.
 */
function readEnrollmentDateFloor(value: unknown): string | null {
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string') {
    const parsed = new Date(value);
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  } else if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    date = (value as { toDate: () => Date }).toDate();
  } else if (value && typeof value === 'object') {
    const seconds = Number(
      (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
        (value as { _seconds?: unknown })._seconds
    );
    if (Number.isFinite(seconds)) date = new Date(seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Whether a teacher may open this student's record.
 *
 * Decided from the open enrollment's class rather than `students.teacherId`.
 * That field is a projection: it goes stale when a student moves, so the old
 * teacher kept access to a student who had left and the new one was refused a
 * student sitting in their class.
 *
 * The fallback matters as much as the rule. Production still holds students
 * with no enrollment record at all, and answering "no teacher owns them" would
 * lock their actual teacher out of a record they are supposed to see. So while
 * the legacy projection is still maintained, an absent enrollment falls back to
 * it. In `canonical_required` the enrollment is the only answer by definition,
 * and there is nothing to fall back to.
 */
async function teacherOwnsStudent(
  db: DocumentStore,
  teacherUid: string,
  enrollments: readonly { classId: string; status: string }[],
  profile: Record<string, unknown>,
  mode: CanonicalStudentReadMode
): Promise<boolean> {
  const openClassIds = [
    ...new Set(
      enrollments
        .filter((enrollment) =>
          isOpenStudentCourseEnrollmentStatus(enrollment.status as StudentCourseEnrollmentStatus)
        )
        .map((enrollment) => enrollment.classId)
        .filter(Boolean)
    ),
  ];

  if (openClassIds.length === 0) {
    if (mode === 'canonical_required') return false;
    return String(profile.teacherId || '') === teacherUid;
  }

  const classes = await Promise.all(
    openClassIds.map((classId) => db.collection('classes').doc(classId).get())
  );
  return classes.some((snapshot) => String(snapshot.data()?.teacherId || '') === teacherUid);
}

export async function readStudentAdminReport(db: DocumentStore, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'office', 'teacher', 'accounting']);

  const requestedStudentId = String(req.query.studentId || '').trim();
  if (!requestedStudentId) {
    throw withAuthzStatus('studentId is required', 400);
  }

  // Resolved before anything is read, in every mode. A retired profile is a
  // tombstone: no name, no contact, no money. Serving it renders as a working
  // student record with everything missing, which is worse than an error — and
  // every child collection below would then be queried by an id the merge
  // moved away from.
  const { canonicalProfileId: studentId } = await resolveCanonicalStudentId(db, requestedStudentId);

  const todayStr = getVietnamTodayStr();

  // --- 1. Student ---
  const studentSnap = await db.collection('students').doc(studentId).get();
  if (!studentSnap.exists) {
    throw withAuthzStatus('Student not found', 404);
  }
  const studentData = studentSnap.data() || {};
  const safeStudent = projectStudent({ id: studentSnap.id, ...studentData }, 'directory');
  const role = ctx.role;
  const canAcademic = role === 'admin' || role === 'office' || role === 'teacher';
  const canFinance = role === 'admin' || role === 'accounting';

  const canonicalEnrollments: ReturnType<typeof readStoredStudentCourseEnrollment>[] = [];
  const enrollmentCollection = db.collection('student_course_enrollments');
  if (typeof enrollmentCollection?.where === 'function') {
    const enrollmentSnap = await enrollmentCollection.where('studentId', '==', studentId).get();
    for (const doc of enrollmentSnap.docs || []) {
      try {
        canonicalEnrollments.push(readStoredStudentCourseEnrollment(doc));
      } catch {
        /* malformed legacy rows stay out of the privacy-safe response */
      }
    }
  }

  if (role === 'teacher') {
    const { mode } = await readCanonicalStudentReadControl(db);
    if (!(await teacherOwnsStudent(db, ctx.uid, canonicalEnrollments, studentData, mode))) {
      throw withAuthzStatus('Student not found', 404);
    }
  }

  // --- 2. Full-history attendance ---
  // Ordered `date desc` to match the existing (studentId ASC, date DESC) index
  // — no index migration needed. Descending also means the cap drops the
  // oldest rows, which is the right bias.
  let attendanceTruncated = false;
  let rawAttendance: {
    id: string;
    date: string;
    classId: string;
    status?: string;
    isVoided: boolean;
    permission: boolean;
    minutesLate: number;
  }[] = [];
  const canBuildSessionSummary = canAcademic || canonicalEnrollments.length > 0;
  if (canBuildSessionSummary) {
    const attSnap = await db
      .collection('attendance')
      .where('studentId', '==', studentId)
      .orderBy('date', 'desc')
      .limit(STUDENT_ADMIN_REPORT_ATTENDANCE_LIMIT + 1)
      .get();

    attendanceTruncated = attSnap.docs.length > STUDENT_ADMIN_REPORT_ATTENDANCE_LIMIT;
    rawAttendance = attSnap.docs
      .slice(0, STUDENT_ADMIN_REPORT_ATTENDANCE_LIMIT)
      .map((doc) => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          date: String(d.date || ''),
          classId: String(d.classId || ''),
          status: typeof d.status === 'string' ? d.status : undefined,
          isVoided: d.isVoided === true,
          permission: d.permission === true,
          minutesLate: typeof d.minutesLate === 'number' ? d.minutesLate : 0,
        };
      })
      .filter((row) => row.date && row.classId)
      .reverse(); // back to ascending
  }

  // --- 3. Full-history ledgers ---
  let ledgersTruncated = false;
  let ledgers: {
    id: string;
    amount: unknown;
    discountTotal: unknown;
    paidTotal: unknown;
    dueDate: string | null;
    classId: string | null;
    termLabel: string | null;
    termStart: string | null;
    termEnd: string | null;
    status: string | null;
    tuitionReminderCount?: number;
    tuitionReminderLastSentAt?: string | null;
  }[] = [];
  if (canFinance) {
    const ledgerSnap = await db
      .collection('course_fee_ledgers')
      .where('studentId', '==', studentId)
      .limit(STUDENT_ADMIN_REPORT_LEDGER_LIMIT + 1)
      .get();

    ledgersTruncated = ledgerSnap.docs.length > STUDENT_ADMIN_REPORT_LEDGER_LIMIT;
    ledgers = ledgerSnap.docs.slice(0, STUDENT_ADMIN_REPORT_LEDGER_LIMIT).map((doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        amount: d.amount,
        discountTotal: d.discountTotal,
        paidTotal: d.paidTotal,
        dueDate: typeof d.dueDate === 'string' ? d.dueDate : null,
        classId: typeof d.classId === 'string' ? d.classId : null,
        termLabel: typeof d.termLabel === 'string' ? d.termLabel : null,
        termStart: typeof d.termStart === 'string' ? d.termStart : null,
        termEnd: typeof d.termEnd === 'string' ? d.termEnd : null,
        status: typeof d.status === 'string' ? d.status : null,
        tuitionReminderCount: Number(d.tuitionReminderCount || 0),
        tuitionReminderLastSentAt:
          typeof d.tuitionReminderLastSentAt === 'string' ? d.tuitionReminderLastSentAt : null,
      };
    });
  }

  // --- 4. Classes referenced by any evidence ---
  const classIdSet = new Set<string>();
  const currentClassId = typeof studentData.classId === 'string' ? studentData.classId : null;
  if (currentClassId) classIdSet.add(currentClassId);
  for (const enrollment of canonicalEnrollments) classIdSet.add(enrollment.classId);
  for (const a of rawAttendance) classIdSet.add(a.classId);
  for (const l of ledgers) if (l.classId) classIdSet.add(l.classId);

  const classIds = [...classIdSet];
  let classDocs: AppDocumentStore.QueryDocumentSnapshot[] = [];
  if (classIds.length > 0) {
    const classSnaps = await Promise.all(
      chunks(classIds, 30).map((ids) =>
        db.collection('classes').where('__name__', 'in', ids).limit(30).get()
      )
    );
    classDocs = classSnaps.flatMap((s) => s.docs);
  }

  const classLikes = classDocs.map((doc) => {
    const d = doc.data() || {};
    return {
      id: doc.id,
      name: String(d.name || ''),
      grade: getClassGrade(d) || null,
      startDate: typeof d.startDate === 'string' ? d.startDate : '',
      endDate: typeof d.endDate === 'string' ? d.endDate : '',
      holidays: Array.isArray(d.holidays) ? d.holidays : [],
      weeklySessions: Array.isArray(d.weeklySessions) ? d.weeklySessions : [],
      daysOfWeek: Array.isArray(d.daysOfWeek) ? d.daysOfWeek : [],
      terms: Array.isArray(d.terms) ? d.terms : [],
      tuitionFee: typeof d.tuitionFee === 'number' ? d.tuitionFee : 0,
    };
  });

  // --- 5. Timeline ---
  const timeline: TimelineSegment[] = buildEnrollmentTimeline({
    classes: classLikes,
    currentClassId,
    attendance: rawAttendance.map((a) => ({ classId: a.classId, date: a.date })),
    ledgers: ledgers.map((l) => ({
      classId: l.classId,
      termStart: l.termStart,
      termEnd: l.termEnd,
    })),
    enrollments: canonicalEnrollments.map((enrollment) => ({
      classId: enrollment.classId,
      termStart: enrollment.termStart,
    })),
  });

  const termsByClass = new Map<string, ClassTerm[]>();
  for (const classData of classLikes) termsByClass.set(classData.id, buildClassTerms(classData));

  const resolveTermKey = (classId: string, date: string): string => {
    const term = findTermForDate(termsByClass.get(classId) ?? [], date);
    return makeTermKey(classId, term ? term.termId : UNKNOWN_TERM_ID);
  };

  const resolveTermStart = (classId: string, date: string): string | null => {
    const term = findTermForDate(termsByClass.get(classId) ?? [], date);
    return term ? term.startDate : null;
  };

  const accountingSessionCounts = new Map<
    string,
    {
      attended: number;
      elapsed: number;
      absentExcused: number;
      absentUnexcused: number;
      onLeave: number;
      complete: number;
    }
  >();
  const safeTimeline = timeline.map((segment) => {
    const enrollment = canonicalEnrollments.find(
      (row) => row.classId === segment.classId && row.termStart === segment.term.startDate
    );
    return enrollment
      ? {
          ...segment,
          enrollment: {
            id: enrollment.id,
            status: enrollment.status,
            joinedAt: enrollment.joinedAt,
            endedAt: enrollment.endedAt,
            source: enrollment.source,
            confidence: enrollment.confidence,
          },
        }
      : { ...segment, enrollment: null };
  });

  let classSessionsTruncated = false;
  let safeAttendanceRows: {
    date: string;
    classId: string;
    termKey: string;
    status: string;
    absentWithPermission: boolean;
    minutesLate: number;
    source: ExpectedSession['source'];
  }[] = [];

  const sessionValueByTerm: Record<
    string,
    {
      courseTotalSessions: number;
      pricePerSession: number | null;
      refundable: { sessions: number; amount: number };
      notEnrolled: { sessions: number; amount: number };
    }
  > = {};

  // --- 6. Expected sessions, per segment, honouring attendanceMode ---
  if (canBuildSessionSummary) {
    const expectedModeSegments = timeline.filter((s) => s.attendanceMode === 'expected');
    const scheduledDates: { date: string; classId: string }[] = [];

    for (const segment of expectedModeSegments) {
      const classData = classLikes.find((c) => c.id === segment.classId);
      if (!classData) continue;

      const schedule = segment.term.schedule ?? {
        holidays: classData.holidays as string[],
        weeklySessions: classData.weeklySessions,
        daysOfWeek: classData.daysOfWeek as number[],
      };

      const rangeFrom = segment.term.startDate;
      const rangeTo = segment.term.endDate || todayStr;
      if (!rangeFrom || rangeFrom > rangeTo) continue;

      const holidaySet = new Set(schedule.holidays);
      const daysOfWeek =
        Array.isArray(schedule.weeklySessions) && schedule.weeklySessions.length > 0
          ? (schedule.weeklySessions as any[])
              .map((ws: any) => Number(ws.dayOfWeek))
              .filter((d) => !Number.isNaN(d))
          : schedule.daysOfWeek;

      const generated = getScheduledClassDatesInRange(
        {
          startDate: rangeFrom,
          endDate: rangeTo,
          daysOfWeek,
          weeklySessions: schedule.weeklySessions,
        } as any,
        rangeFrom,
        rangeTo
      );

      for (const date of generated) {
        if (holidaySet.has(date) || isFutureVietnamDate(date)) continue;
        scheduledDates.push({ date, classId: segment.classId });
      }
    }

    // --- 7. Makeup / cancelled sessions ---
    // limitToLast keeps the NEWEST sessions when a chunk exceeds the cap — the
    // default view is the current course, so recent makeup/cancelled data is
    // the load-bearing part. The +1 sentinel makes the truncation flag exact
    // (a plain running count would flag a chunk of exactly 5000). orderBy(date)
    // rides the existing (classId, date) composite index — no new index.
    const makeupSessions: { date: string; classId: string }[] = [];
    const cancelledKeys = new Set<string>();
    const CLASS_SESSIONS_MAX_PER_CHUNK = 5000;
    for (const ids of chunks(classIds, 30)) {
      const snap = await db
        .collection('class_sessions')
        .where('classId', 'in', ids)
        .orderBy('date', 'asc')
        .limitToLast(CLASS_SESSIONS_MAX_PER_CHUNK + 1)
        .get();
      if (snap.docs.length > CLASS_SESSIONS_MAX_PER_CHUNK) classSessionsTruncated = true;
      for (const doc of snap.docs.slice(-CLASS_SESSIONS_MAX_PER_CHUNK)) {
        const d = doc.data() || {};
        const date = String(d.date || '');
        const cid = String(d.classId || '');
        if (!date || !cid) continue;
        const status = String(d.status || '');
        if (status === 'cancelled') cancelledKeys.add(`${cid}|${date}`);
        else if (status === 'makeup') makeupSessions.push({ date, classId: cid });
      }
    }

    // Count the complete course, including future sessions and makeups, so the
    // display-only unit price does not change as the course progresses.
    const courseTotalSessionsByTerm = new Map<string, number>();
    for (const segment of expectedModeSegments) {
      const classData = classLikes.find((item) => item.id === segment.classId);
      if (!classData) continue;

      const schedule = segment.term.schedule ?? {
        holidays: classData.holidays as string[],
        weeklySessions: classData.weeklySessions,
        daysOfWeek: classData.daysOfWeek as number[],
      };
      const fullFrom = segment.term.startDate;
      const fullTo = segment.term.endDate;
      if (!fullFrom || !fullTo || fullFrom > fullTo) continue;

      const holidaySet = new Set(schedule.holidays);
      const daysOfWeek =
        Array.isArray(schedule.weeklySessions) && schedule.weeklySessions.length > 0
          ? (schedule.weeklySessions as any[])
              .map((session: any) => Number(session.dayOfWeek))
              .filter((day) => !Number.isNaN(day))
          : schedule.daysOfWeek;
      const allDates = getScheduledClassDatesInRange(
        {
          startDate: fullFrom,
          endDate: fullTo,
          daysOfWeek,
          weeklySessions: schedule.weeklySessions,
        } as any,
        fullFrom,
        fullTo
      );
      const courseDates = new Set<string>(allDates);
      for (const makeup of makeupSessions) {
        if (makeup.classId !== segment.classId) continue;
        if (makeup.date < fullFrom || makeup.date > fullTo) continue;
        courseDates.add(makeup.date);
      }

      let total = 0;
      for (const date of courseDates) {
        if (holidaySet.has(date)) continue;
        if (cancelledKeys.has(`${segment.classId}|${date}`)) continue;
        total++;
      }
      courseTotalSessionsByTerm.set(segment.key, total);
    }

    // marked_only segments use their real attendance rows verbatim: no
    // synthesised unmarked sessions (that is what the mode exists to avoid),
    // and no cancellation filtering (a real row on a "cancelled" date is still
    // real). Makeup sessions only ever extend expected-mode segments.
    const markedOnlyKeys = new Set(
      timeline.filter((s) => s.attendanceMode === 'marked_only').map((s) => s.key)
    );
    const expectedModeKeys = new Set(
      timeline.filter((s) => s.attendanceMode === 'expected').map((s) => s.key)
    );

    // Positive filter: a makeup must belong to an expected-mode segment that is
    // actually in the timeline. "Not marked_only" would also admit makeups from
    // courses the student never took (no evidence → no segment), creating
    // orphaned unmarked rows.
    // Future makeups belong in the whole-course denominator, but cannot create
    // attendance/refund rows before the session has happened.
    const expectedModeMakeups = makeupSessions.filter(
      (m) => expectedModeKeys.has(resolveTermKey(m.classId, m.date)) && !isFutureVietnamDate(m.date)
    );

    // enrollmentDate is KEPT, as a floor for courses with no join entry.
    // It is the only signal covering assignment paths that do not stamp
    // courseJoins — admissions/handlers/createTrial.ts:81 sets classId directly.
    // Dropping it would make a trial student created today start showing phantom
    // blank rows for the whole course to date: a regression of the exact bug this
    // feature fixes. A matching courseJoins entry always wins over the floor.
    const enrollmentDate = readEnrollmentDateFloor(studentData.enrollmentDate);

    const resolveEligibility = createEligibilityResolver({
      courseJoins: readCourseJoins(studentData.courseJoins),
      leavePeriods: readLeavePeriods(studentData.leavePeriods),
      resolveTermStart,
      enrollmentDate,
    });

    const expectedModeSessions = buildExpectedStudentSessions(
      scheduledDates,
      expectedModeMakeups,
      cancelledKeys,
      resolveEligibility
    );

    // Voided rows are excluded: mergeExpectedSessionsWithAttendance ignores them
    // when indexing, so seeding a session from one would resurface it as a
    // phantom "unmarked". A real row on a makeup date keeps its makeup label —
    // hardcoding 'scheduled' would misreport it.
    const makeupDateKeys = new Set(makeupSessions.map((m) => `${m.classId}|${m.date}`));
    const markedOnlySessions: ExpectedSession[] = [];
    const seenMarkedOnly = new Set<string>();
    for (const a of rawAttendance) {
      if (a.isVoided) continue;
      if (!markedOnlyKeys.has(resolveTermKey(a.classId, a.date))) continue;
      const key = `${a.classId}|${a.date}`;
      if (seenMarkedOnly.has(key)) continue;
      seenMarkedOnly.add(key);
      markedOnlySessions.push({
        date: a.date,
        classId: a.classId,
        source: makeupDateKeys.has(key) ? 'makeup' : 'scheduled',
        // marked_only rows are real attendance by definition — always eligible.
        eligibility: 'eligible',
      });
    }

    const expectedSessions = [...expectedModeSessions, ...markedOnlySessions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const attendanceRows = mergeExpectedSessionsWithAttendance(expectedSessions, rawAttendance);

    safeAttendanceRows = attendanceRows.map((r) => ({
      date: r.date,
      classId: r.classId,
      termKey: resolveTermKey(r.classId, r.date),
      status: r.status,
      absentWithPermission: r.absentWithPermission,
      minutesLate: r.minutesLate,
      source: r.source,
    }));

    if (role === 'accounting') {
      for (const row of safeAttendanceRows) {
        if (row.status === 'not_enrolled') continue;
        const current = accountingSessionCounts.get(row.termKey) || {
          attended: 0,
          elapsed: 0,
          absentExcused: 0,
          absentUnexcused: 0,
          onLeave: 0,
          complete: 0,
        };
        current.elapsed += 1;
        if (row.status === 'present' || row.status === 'late') current.attended += 1;
        if (row.status === 'absent' && row.absentWithPermission) current.absentExcused += 1;
        if (row.status === 'absent' && !row.absentWithPermission) current.absentUnexcused += 1;
        if (row.status === 'on_leave') current.onLeave += 1;
        if (row.status !== 'unmarked') current.complete += 1;
        accountingSessionCounts.set(row.termKey, current);
      }
    }

    // Per-course money estimate. DISPLAY ONLY — nothing here touches a ledger.
    //
    // Gated on canFinance as well as canAcademic (today: admin only). Two reasons,
    // and the second is the load-bearing one:
    //   1. office/teacher have no business seeing tuition figures (readers.ts:1717).
    //   2. `ledgers` is only populated under canFinance (line 1779), so computing
    //      this in the academic branch would give office/teacher an empty array,
    //      resolving the fallback to 0đ while an admin sees the real number for
    //      the same student. Silently wrong beats loudly absent — so: absent.
    for (const segment of canFinance ? timeline : []) {
      const courseTotalSessions = courseTotalSessionsByTerm.get(segment.key) ?? 0;
      const classData = classLikes.find((c) => c.id === segment.classId);

      // Per spec D1's resolution table: the CURRENT term matches on termStart
      // alone (an ongoing course's ledger may predate a later-set class.endDate,
      // or the class may still be open-ended — requiring termEnd here would
      // reject a legitimate current-course ledger). Only an ARCHIVED term
      // requires both bounds, because a re-run course can share a startDate with
      // an earlier course and termEnd is what disambiguates them.
      const ledgerFee = Number(
        ledgers.find(
          (l) =>
            l.classId === segment.classId &&
            l.termStart === segment.term.startDate &&
            (segment.term.isCurrent || l.termEnd === segment.term.endDate)
        )?.amount ?? 0
      );

      // class.tuitionFee is the CURRENT course's fee and applies only to the
      // current term. buildClassTerms (studentEnrollmentTimeline.ts:105) snapshots
      // each archived term's schedule into terms[] but nothing about money, so
      // using it on an archived segment would price 2024's course at 2026's rate.
      // An archived course with no matching ledger renders '—', which is honest.
      const classFee = segment.term.isCurrent
        ? Number((classData as { tuitionFee?: unknown } | undefined)?.tuitionFee ?? 0)
        : 0;
      const courseFee = classFee > 0 ? classFee : ledgerFee;

      const termRows = safeAttendanceRows.filter((r) => r.termKey === segment.key);
      const estimate = estimateSessionValue({
        courseFee,
        courseTotalSessions,
        excusedAbsences: termRows.filter((r) => r.status === 'absent' && r.absentWithPermission)
          .length,
        onLeaveSessions: termRows.filter((r) => r.status === 'on_leave').length,
        notEnrolledSessions: termRows.filter((r) => r.status === 'not_enrolled').length,
      });

      sessionValueByTerm[segment.key] = { courseTotalSessions, ...estimate };
    }
  }

  // --- 8. Receipts ---
  let receipts: {
    id: string;
    ledgerId: string;
    receiptNumber: string | null;
    date: string | null;
    amount: number;
    method: string | null;
    status: string | null;
    source: string | null;
  }[] = [];
  if (canFinance) {
    const ledgerIds = new Set(ledgers.map((ledger) => ledger.id));
    if (ledgerIds.size > 0) {
      const receiptSnap = await db
        .collection('receipts')
        .where('studentId', '==', studentId)
        .where('status', '==', 'posted')
        .limit(500)
        .get();
      receipts = flattenStudentReceiptRows(
        receiptSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
        ledgerIds
      );
    }
  }

  // --- 9. Ledger rows ---
  let ledgerRows: {
    id: string;
    periodKey: string;
    classId: string | null;
    /**
     * Resolved here because a ledger can point at an archived class the client
     * never receives, and the accounting workspace renders ledgers that no
     * enrollment covers.
     */
    className: string;
    termKey: string | null;
    termStart: string | null;
    termEnd: string | null;
    termLabel: string | null;
    dueDate: string | null;
    grossAmount: number;
    discount: number;
    netAmount: number;
    paid: number;
    outstanding: number;
    displayStatus: string;
    isOverdue: boolean;
    hasDueDate: boolean;
    tuitionReminderCount?: number;
    tuitionReminderLastSentAt?: string | null;
  }[] = [];
  if (canFinance) {
    ledgerRows = ledgers.map((l) => {
      const info = deriveLedgerDisplayStatus(l, todayStr);
      const terms = l.classId ? (termsByClass.get(l.classId) ?? []) : [];
      const matched = terms.find(
        (t) => t.startDate === (l.termStart || '') && t.endDate === (l.termEnd || '')
      );
      return {
        id: l.id,
        periodKey: formatLedgerPeriodKey(l),
        classId: l.classId,
        className: l.classId
          ? String(classLikes.find((item) => item.id === l.classId)?.name || '')
          : '',
        termKey: l.classId
          ? makeTermKey(l.classId, matched ? matched.termId : UNKNOWN_TERM_ID)
          : null,
        termStart: l.termStart,
        termEnd: l.termEnd,
        termLabel: l.termLabel,
        dueDate: l.dueDate,
        grossAmount: info.grossAmount,
        discount: info.discount,
        netAmount: info.netAmount,
        paid: info.paid,
        outstanding: info.outstanding,
        displayStatus: info.displayStatus,
        isOverdue: info.isOverdue,
        hasDueDate: info.hasDueDate,
        tuitionReminderCount: Number((l as any).tuitionReminderCount || 0),
        tuitionReminderLastSentAt:
          typeof (l as any).tuitionReminderLastSentAt === 'string'
            ? (l as any).tuitionReminderLastSentAt
            : null,
      };
    });
  }

  const courseSummaries: StudentCourseFinanceSummary[] = canonicalEnrollments.map((enrollment) => {
    const classData = classLikes.find((item) => item.id === enrollment.classId);
    const terms = termsByClass.get(enrollment.classId) || [];
    const termIndex = Math.max(
      0,
      terms.findIndex((term) => term.startDate === enrollment.termStart)
    );
    const term = terms[termIndex];
    const termKey = makeTermKey(enrollment.classId, term?.termId || UNKNOWN_TERM_ID);
    const ledger = ledgerRows.find(
      (row) => row.classId === enrollment.classId && row.termStart === enrollment.termStart
    );
    const rows = safeAttendanceRows.filter((row) => row.termKey === termKey);
    const sessions = accountingSessionCounts.get(termKey) || {
      attended: rows.filter((row) => row.status === 'present' || row.status === 'late').length,
      elapsed: rows.filter((row) => row.status !== 'not_enrolled').length,
      absentExcused: rows.filter((row) => row.status === 'absent' && row.absentWithPermission)
        .length,
      absentUnexcused: rows.filter((row) => row.status === 'absent' && !row.absentWithPermission)
        .length,
      onLeave: rows.filter((row) => row.status === 'on_leave').length,
      complete: rows.filter((row) => !['unmarked', 'not_enrolled'].includes(row.status)).length,
    };
    const sessionSummary = {
      ...sessions,
      attendedSessions: sessions.attended,
      occurredSessions: sessions.elapsed,
      completedSessions: sessions.complete,
      complete:
        !attendanceTruncated && !classSessionsTruncated && sessions.complete >= sessions.elapsed,
      completeKnown: !attendanceTruncated && !classSessionsTruncated,
    };
    const grossAmount = ledger?.grossAmount || 0;
    const discount = ledger?.discount || 0;
    const netAmount = ledger?.netAmount || 0;
    const paid = ledger?.paid || 0;
    return {
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        joinedAt: enrollment.joinedAt,
        endedAt: enrollment.endedAt,
        source: enrollment.source,
        confidence: enrollment.confidence,
      },
      termKey,
      className: classData?.name || enrollment.classId,
      termIndex,
      sessions: sessionSummary,
      finance: {
        ledgerId: ledger?.id || null,
        grossAmount,
        discount,
        netAmount,
        paid,
        outstanding: ledger?.outstanding || 0,
        dueDate: ledger?.dueDate || null,
        status: deriveAccountingPaymentStatus({
          ledgerExists: Boolean(ledger),
          netAmount,
          paid,
          dueDate: ledger?.dueDate,
          today: todayStr,
          waived: ledger?.displayStatus === 'waived',
        }),
        tuitionReminderCount: ledger?.tuitionReminderCount || 0,
        lastTuitionReminderAt: ledger?.tuitionReminderLastSentAt || null,
      },
    };
  });

  return {
    student: safeStudent,
    // Named so the client can move the browser to the surviving profile rather
    // than keeping a retired id in the address bar, where it becomes a
    // bookmark and a shared link that outlive the merge.
    canonicalProfileId: studentId,
    requestedProfileId: requestedStudentId,
    redirected: studentId !== requestedStudentId,
    timeline: safeTimeline,
    attendanceRows: canAcademic ? safeAttendanceRows : [],
    sessionValueByTerm,
    ledgers: ledgerRows,
    receipts,
    courseSummaries,
    truncation: {
      attendance: attendanceTruncated,
      ledgers: ledgersTruncated,
      classSessions: classSessionsTruncated,
    },
    generatedAt: new Date().toISOString(),
  };
}
