import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type {
  Query,
  DocumentStore,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from '@/server/db/documentStore.js';
import { withStatus } from '../../lib/http/helpers.js';
import {
  assertFinanceAccess,
  requireRole,
  withAuthzStatus,
  type UserContext,
} from '../../lib/auth/authz.js';
import {
  isStudentProjectionView,
  projectStudent,
  type StudentProjectionView,
} from '../../lib/student/studentProjection.js';
import {
  filterClassesForRoleOutsideAdminDashboard,
  isClassVisibleForRoleOutsideAdminDashboard,
} from '../../../../shared/classVisibility.js';
import {
  getClassSessionForDate,
  getClassTimeRange,
  getScheduledClassDatesInRange,
  isFutureVietnamDate,
} from '../../../../shared/classSchedule.js';
import { getTeacherAttendanceDisplayStatus } from '../../../../shared/teacherAttendance.js';
import { normalizeAssignmentProctoringMode } from '../../../../shared/assignmentProctoring.js';
import { projectAssignmentAssessmentForRole } from '../../../../shared/assignmentAssessment.js';
import { createReadCache } from '../../lib/cache/readCache.js';
import { createServerTiming, shouldEmitServerTiming } from '../../lib/http/serverTiming.js';
import { courseClosingApproved } from '../../../../shared/classJoinWindow.js';

export const MAX_LIMIT = 2000;
export const STUDENTS_READ_MAX_LIMIT = 2000;
export const STUDENTS_COMPLETE_INDEX_MAX = 3000;
export const ADMIN_DASHBOARD_LIMIT = 2000;
export const FINANCE_DASHBOARD_LIMIT = 2000;
export const PARENT_DASHBOARD_LIMIT = 2000;
export const ACCOUNTING_LEDGER_PAGE_CAP = 150;
export const ACCOUNTING_LEDGER_TOTAL_CAP = 300;

/**
 * How many thirty-id ledger queries the accounting read has open at once.
 *
 * Sized against the cap above rather than against DocumentStore: four chunks of a
 * fully-billed roster already fill three hundred rows, so a wave of six turns
 * the common case into a single round trip while overshooting by at most five
 * queries. Raising it buys nothing and only widens that overshoot.
 */
export const ACCOUNTING_LEDGER_FAN_OUT = 6;

export const ADMIN_DASHBOARD_STAFF_ROLES = ['teacher', 'office', 'accounting'] as const;

export const DASHBOARD_CACHE_TTL_MS = 30_000;
export const PARENT_DASHBOARD_CACHE_TTL_MS = 15_000;
export const dashboardCache = createReadCache<unknown>(DASHBOARD_CACHE_TTL_MS);
export const parentDashboardCache = createReadCache<unknown>(PARENT_DASHBOARD_CACHE_TTL_MS);

export function setServerTimingHeader(
  res: ApiResponse,
  timing: ReturnType<typeof createServerTiming>
): void {
  if (!shouldEmitServerTiming()) return;
  const header = timing.header();
  if (header) res.setHeader('Server-Timing', header);
}

export function jsonSuccess(res: ApiResponse, data: unknown, cursor?: string) {
  return res.status(200).json({
    success: true,
    data,
    ...(cursor ? { cursor } : {}),
    serverTime: new Date().toISOString(),
  });
}

export function jsonError(res: ApiResponse, status: number, errorCode: string, error: string) {
  return res.status(status).json({ success: false, errorCode, error });
}

export function getLimit(req: ApiRequest, fallback = 100, max = MAX_LIMIT) {
  const raw = parseInt(String(req.query.limit ?? ''), 10);
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.min(Math.max(value, 1), max);
}

export function getBoundedLimit(req: ApiRequest, fallback: number, max: number) {
  return Math.min(getLimit(req, fallback, max), max);
}

export function getCursor(req: ApiRequest): string {
  return typeof req.query.cursor === 'string' ? req.query.cursor : '';
}

export function getMonthRange(req: ApiRequest): { month: string; from: string; to: string } {
  const month = String(req.query.month || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw withStatus('Invalid teacher month', 400);

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) {
    throw withStatus('Invalid teacher month', 400);
  }

  const from = `${month}-01`;
  const end = new Date(Date.UTC(year, monthNumber, 0));
  const to = end.toISOString().slice(0, 10);
  return { month, from, to };
}

export async function resolveCursor(
  db: DocumentStore,
  collection: string,
  cursor: string
): Promise<DocumentSnapshot | null> {
  if (!cursor) return null;
  const doc = await db.collection(collection).doc(cursor).get();
  return doc.exists ? doc : null;
}

export async function paginatedQuery(
  query: Query,
  limit: number,
  cursorDoc: DocumentSnapshot | null
) {
  let q = query.limit(limit + 1);
  if (cursorDoc) q = q.startAfter(cursorDoc);
  const snap = await q.get();
  const hasMore = snap.docs.length > limit;
  const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
  const nextCursor = hasMore ? docs[docs.length - 1].id : undefined;
  return { docs, nextCursor };
}

export function docData(doc: QueryDocumentSnapshot | DocumentSnapshot): {
  id: string;
  [key: string]: unknown;
} {
  return { id: doc.id, ...(doc.data() || {}) };
}

export function teacherMonthProfile(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    uid: doc.id,
    displayName: String(data.displayName || data.email || ''),
    email: String(data.email || ''),
    phone: typeof data.phone === 'string' ? data.phone : '',
    blockedTeacher: Boolean(data.blockedTeacher),
  };
}

export function teacherMonthClass(doc: QueryDocumentSnapshot | DocumentSnapshot) {
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
    salaryPerSession: Number(data.salaryPerSession || 0),
    holidays: Array.isArray(data.holidays) ? (data.holidays as string[]) : [],
    terms: Array.isArray(data.terms) ? data.terms : [],
    ...projectedWeeklySessions(data),
  };
}

export function teacherMonthSession(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  effectiveTeacherId: string
) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    classId: String(data.classId || ''),
    teacherId: effectiveTeacherId,
    date: String(data.date || ''),
    status: String(data.status || 'taught') as 'taught' | 'cancelled' | 'makeup',
    teacherAttendanceStatus:
      data.teacherAttendanceStatus === 'present' || data.teacherAttendanceStatus === 'absent'
        ? data.teacherAttendanceStatus
        : undefined,
    teacherAttendanceMarkedAt:
      typeof data.teacherAttendanceMarkedAt === 'string' ? data.teacherAttendanceMarkedAt : '',
    teacherAttendanceNote:
      typeof data.teacherAttendanceNote === 'string' ? data.teacherAttendanceNote : '',
    salaryPerSession: Number(data.salaryPerSession || 0),
  };
}

export function filterClassRowsForContext<T>(classes: readonly T[], ctx: UserContext): T[] {
  return filterClassesForRoleOutsideAdminDashboard(classes, ctx.role);
}

export function isClassDocVisibleForContext(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  ctx: UserContext
): boolean {
  return isClassVisibleForRoleOutsideAdminDashboard(doc.data() || {}, ctx.role);
}

export function filterDocsToVisibleClasses<T extends DocumentSnapshot>(
  docs: readonly T[],
  visibleClassIds: ReadonlySet<string>,
  ctx: UserContext
): T[] {
  return docs.filter(
    (doc) =>
      doc.data()?.isDeleted !== true &&
      doc.data()?.isVoided !== true &&
      (ctx.role === 'admin' || visibleClassIds.has(String(doc.data()?.classId || '')))
  );
}

export function filterRowsToVisibleClasses<T>(
  rows: readonly T[],
  visibleClassIds: ReadonlySet<string>,
  ctx: UserContext
): T[] {
  if (ctx.role === 'admin') return [...rows];
  return rows.filter((row) =>
    visibleClassIds.has(String((row as { classId?: unknown }).classId || ''))
  );
}

export function parentPaymentSummary(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    orderCode: Number(data.orderCode || 0),
    amount: Number(data.amount || 0),
    status: String(data.status || 'pending'),
    ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
    ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
    ...(typeof data.checkoutUrl === 'string' && data.checkoutUrl
      ? { checkoutUrl: data.checkoutUrl }
      : {}),
  };
}

export function pickString(data: Record<string, unknown>, key: string) {
  return typeof data[key] === 'string' && data[key] ? { [key]: String(data[key]) } : {};
}

export function pickValue(data: Record<string, unknown>, key: string) {
  return data[key] !== undefined ? { [key]: data[key] } : {};
}

export function projectedAssignmentDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  role: string
) {
  const data = doc.data() || {};
  const projectedAssessment = projectAssignmentAssessmentForRole(data.assessment, role);
  const base = {
    id: doc.id,
    ...pickString(data, 'classId'),
    ...pickString(data, 'teacherId'),
    ...pickString(data, 'title'),
    ...pickString(data, 'description'),
    ...pickString(data, 'dueDate'),
    ...pickString(data, 'type'),
    proctoringMode: normalizeAssignmentProctoringMode(data.proctoringMode),
    ...(projectedAssessment !== undefined ? { assessment: projectedAssessment } : {}),
    ...pickValue(data, 'deliveryPolicy'),
    ...pickValue(data, 'points'),
    ...pickValue(data, 'createdAt'),
    ...pickValue(data, 'updatedAt'),
  };
  if (role === 'admin' || role === 'teacher') {
    return {
      ...base,
      ...pickValue(data, 'instructions'),
      ...pickValue(data, 'rubric'),
    };
  }
  return base;
}

export function projectedSubmissionDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  role: string
) {
  const data = doc.data() || {};
  const base = {
    id: doc.id,
    ...pickString(data, 'assignmentId'),
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickValue(data, 'content'),
    ...pickValue(data, 'grade'),
    ...pickValue(data, 'feedback'),
    ...pickValue(data, 'submittedAt'),
    ...pickValue(data, 'updatedAt'),
    ...pickValue(data, 'quizAnswers'),
    ...pickValue(data, 'assessmentAnswers'),
    ...pickValue(data, 'assessmentScore'),
    ...pickValue(data, 'status'),
    ...pickValue(data, 'attemptNumber'),
  };
  if (role === 'admin' || role === 'teacher') {
    return {
      ...base,
      ...pickValue(data, 'gradedBy'),
      ...pickValue(data, 'gradedAt'),
      ...pickValue(data, 'examIntegrity'),
    };
  }
  return base;
}

export function parentLedgerSummary(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickValue(data, 'amount'),
    ...pickValue(data, 'paidTotal'),
    ...pickValue(data, 'discountTotal'),
    ...pickString(data, 'status'),
    ...pickString(data, 'termStart'),
    ...pickString(data, 'termEnd'),
    ...pickString(data, 'description'),
  };
}

export function parentReceiptSummary(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'classId'),
    ...pickString(data, 'ledgerId'),
    ...pickString(data, 'receiptNo'),
    ...pickValue(data, 'amount'),
    ...pickValue(data, 'amountReceived'),
    ...pickString(data, 'flowVersion'),
    ...pickValue(data, 'classIds'),
    ...pickValue(data, 'allocations'),
    ...pickValue(data, 'walletBalanceBefore'),
    ...pickValue(data, 'walletBalanceAfter'),
    ...pickString(data, 'status'),
    ...pickString(data, 'receivedDate'),
    ...pickString(data, 'createdAt'),
    ...pickString(data, 'description'),
  };
}

export type FlattenedStudentReceiptRow = {
  id: string;
  ledgerId: string;
  receiptNumber: string | null;
  date: string | null;
  amount: number;
  method: string | null;
  status: string | null;
  source: string | null;
};

export function flattenStudentReceiptRows(
  receipts: Array<{ id: string; data: Record<string, unknown> }>,
  visibleLedgerIds: Set<string>
): FlattenedStudentReceiptRow[] {
  return receipts.flatMap((receipt) => {
    const data = receipt.data;
    const common = {
      receiptNumber: typeof data.receiptNo === 'string' ? data.receiptNo : null,
      date: typeof data.receivedDate === 'string' ? data.receivedDate : null,
      method: typeof data.paymentMethod === 'string' ? data.paymentMethod : null,
      status: typeof data.status === 'string' ? data.status : null,
      source: typeof data.source === 'string' ? data.source : null,
    };
    if (Array.isArray(data.allocations)) {
      return data.allocations.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const allocation = value as Record<string, unknown>;
        const ledgerId = String(allocation.ledgerId || '');
        if (!visibleLedgerIds.has(ledgerId)) return [];
        const amount = Number(allocation.amount || 0);
        return [
          {
            id: `${receipt.id}:${ledgerId}`,
            ledgerId,
            amount: Number.isFinite(amount) ? amount : 0,
            ...common,
          },
        ];
      });
    }
    const ledgerId = String(data.ledgerId || '');
    if (!visibleLedgerIds.has(ledgerId)) return [];
    const amount = Number(data.amountReceived || 0);
    return [
      {
        id: receipt.id,
        ledgerId,
        amount: Number.isFinite(amount) ? amount : 0,
        ...common,
      },
    ];
  });
}

export function parentInvoiceSummary(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickValue(data, 'amount'),
    ...pickValue(data, 'amountPaid'),
    ...pickString(data, 'status'),
    ...pickString(data, 'issueDate'),
    ...pickString(data, 'dueDate'),
    ...pickString(data, 'description'),
  };
}

export function projectedAttendanceForRole(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  role: string
) {
  if (role === 'admin' || role === 'teacher') return docData(doc);
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'date'),
    ...pickString(data, 'status'),
    ...pickValue(data, 'createdAt'),
    ...pickValue(data, 'updatedAt'),
  };
}

export function projectedEvaluationForRole(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  role: string
) {
  if (role === 'admin' || role === 'teacher') return docData(doc);
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'date'),
    ...pickString(data, 'evaluationType'),
    ...pickValue(data, 'scores'),
    ...pickValue(data, 'finalScore'),
    ...pickValue(data, 'totalScore'),
    ...pickValue(data, 'feedback'),
  };
}

export function projectedSessionForRole(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  role: string
) {
  if (role === 'admin' || role === 'teacher') return docData(doc);
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'classId'),
    ...pickString(data, 'date'),
    ...pickString(data, 'topic'),
    ...pickString(data, 'status'),
  };
}

export function projectedReportForRole(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  role: string
) {
  if (role === 'admin' || role === 'teacher') return docData(doc);
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'date'),
    ...pickString(data, 'summary'),
    ...pickValue(data, 'createdAt'),
  };
}

export function projectedStudentDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  view: StudentProjectionView
) {
  return projectStudent({ id: doc.id, ...(doc.data() || {}) }, view);
}

function projectedWeeklySessions(data: Record<string, unknown>) {
  return Array.isArray(data.weeklySessions)
    ? {
        weeklySessions: (data.weeklySessions as unknown[]).filter(
          (item) => item && typeof item === 'object'
        ),
      }
    : {};
}

export function projectedClassDoc(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    name: String(data.name || ''),
    ...(data.teacherId ? { teacherId: String(data.teacherId) } : {}),
    ...(data.status ? { status: String(data.status) } : {}),
    ...(data.grade !== undefined ? { grade: data.grade } : {}),
    ...(data.schedule ? { schedule: String(data.schedule) } : {}),
    ...(Array.isArray(data.daysOfWeek) ? { daysOfWeek: data.daysOfWeek as number[] } : {}),
    ...(data.startDate ? { startDate: String(data.startDate) } : {}),
    ...(data.endDate ? { endDate: String(data.endDate) } : {}),
    ...(data.startTime ? { startTime: String(data.startTime) } : {}),
    ...(data.room ? { room: String(data.room) } : {}),
    ...(Array.isArray(data.holidays) ? { holidays: data.holidays as string[] } : {}),
    ...(courseClosingApproved(data) ? { courseClosingApproved: true } : {}),
    ...projectedWeeklySessions(data),
  };
}

export function projectedTeacherDoc(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    uid: doc.id,
    displayName: String(data.displayName || data.name || data.email || ''),
    ...(data.email ? { email: String(data.email) } : {}),
    role: String(data.role || ''),
    ...(data.phone ? { phone: String(data.phone) } : {}),
    ...(typeof data.createdAt === 'string' && data.createdAt.trim()
      ? { createdAt: data.createdAt }
      : {}),
  };
}

export function projectedEvaluationDoc(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...(data.studentId ? { studentId: String(data.studentId) } : {}),
    ...(data.classId ? { classId: String(data.classId) } : {}),
    ...(data.date ? { date: String(data.date) } : {}),
    ...(data.finalScore !== undefined ? { finalScore: data.finalScore } : {}),
    ...(data.totalScore !== undefined ? { totalScore: data.totalScore } : {}),
  };
}

export function projectedLedgerDoc(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...(data.studentId ? { studentId: String(data.studentId) } : {}),
    ...(data.classId ? { classId: String(data.classId) } : {}),
    ...(data.amount !== undefined ? { amount: data.amount } : {}),
    ...(data.status ? { status: String(data.status) } : {}),
    ...(data.termStart ? { termStart: String(data.termStart) } : {}),
    ...(data.termEnd ? { termEnd: String(data.termEnd) } : {}),
    ...(data.tuitionNoticeCount !== undefined
      ? { tuitionNoticeCount: data.tuitionNoticeCount }
      : {}),
    ...(data.tuitionNoticeLastSentAt
      ? { tuitionNoticeLastSentAt: String(data.tuitionNoticeLastSentAt) }
      : {}),
  };
}

export function accountingLedgerSummary(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'studentName'),
    ...pickString(data, 'studentCode'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'className'),
    ...pickValue(data, 'amount'),
    ...pickValue(data, 'balance'),
    ...pickValue(data, 'debit'),
    ...pickValue(data, 'credit'),
    ...pickString(data, 'type'),
    ...pickString(data, 'status'),
    ...pickString(data, 'description'),
    ...pickValue(data, 'period'),
    ...pickValue(data, 'month'),
    ...pickValue(data, 'year'),
    ...pickValue(data, 'date'),
    ...pickValue(data, 'dueDate'),
    ...pickValue(data, 'paidAt'),
    ...pickValue(data, 'createdAt'),
    ...pickValue(data, 'updatedAt'),
  };
}

export function projectedZaloNotificationDoc(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    type: String(data.type || ''),
    status: String(data.status || ''),
    classId: String(data.classId || ''),
    studentId: String(data.studentId || ''),
    courseId: String(data.courseId || ''),
    evaluationId: String(data.evaluationId || ''),
    evaluationVersion: String(data.evaluationVersion || ''),
    createdAt: String(data.createdAt || ''),
    date: String(data.date || ''),
    courseEndDate: String(data.courseEndDate || ''),
    nextCourseStartDate: String(data.nextCourseStartDate || ''),
    nextCourseEndDate: String(data.nextCourseEndDate || ''),
    errorMessage: String(data.errorMessage || ''),
    amount: data.amount,
  };
}

export function projectedNotificationDoc(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'classId'),
    ...pickString(data, 'studentId'),
    ...pickString(data, 'studentName'),
    ...pickString(data, 'status'),
    ...pickString(data, 'date'),
    ...pickString(data, 'sessionId'),
    ...pickString(data, 'title'),
    ...pickString(data, 'type'),
    ...pickString(data, 'start'),
    ...pickString(data, 'end'),
    ...pickString(data, 'description'),
    ...pickString(data, 'location'),
    ...pickString(data, 'message'),
    ...pickValue(data, 'isRead'),
    ...pickValue(data, 'createdAt'),
    ...pickValue(data, 'updatedAt'),
  };
}

export function buildClassStudentCounts(docs: Array<QueryDocumentSnapshot | DocumentSnapshot>) {
  const counts: Record<
    string,
    { total: number; active: number; onLeave: number; dropped: number; promoted: number }
  > = {};
  for (const doc of docs) {
    const data = doc.data() || {};
    const classId = String(data.classId || '');
    if (!classId) continue;
    counts[classId] ||= { total: 0, active: 0, onLeave: 0, dropped: 0, promoted: 0 };
    counts[classId].total += 1;
    const status = String(data.enrollmentStatus || 'active');
    if (status === 'on_leave') counts[classId].onLeave += 1;
    else if (status === 'dropped') counts[classId].dropped += 1;
    else if (status === 'promoted') counts[classId].promoted += 1;
    else counts[classId].active += 1;
  }
  return counts;
}

export type OfficeDashboardStudentCount = {
  currentTotal: number;
  active: number;
  onLeave: number;
};

function emptyOfficeDashboardStudentCount(): OfficeDashboardStudentCount {
  return { currentTotal: 0, active: 0, onLeave: 0 };
}

export function buildOfficeDashboardStudentCounts(
  docs: Array<QueryDocumentSnapshot | DocumentSnapshot>,
  visibleClassIds: ReadonlySet<string>
) {
  const counts: Record<string, OfficeDashboardStudentCount> = {};
  for (const doc of docs) {
    const data = doc.data() || {};
    const classId = String(data.classId || '');
    if (!classId || !visibleClassIds.has(classId)) continue;

    const lifecycle = String(data.studentLifecycle || '');
    if (lifecycle === 'archived' || lifecycle === 'trial') continue;

    const status = String(data.enrollmentStatus || 'active');
    if (status !== 'active' && status !== 'on_leave') continue;

    counts[classId] ||= emptyOfficeDashboardStudentCount();
    if (status === 'on_leave') counts[classId].onLeave += 1;
    else counts[classId].active += 1;
    counts[classId].currentTotal = counts[classId].active + counts[classId].onLeave;
  }
  return counts;
}

export function getRequestedStudentProjection(req: ApiRequest): StudentProjectionView {
  const requestedView = typeof req.query.view === 'string' ? req.query.view : 'academic';
  return isStudentProjectionView(requestedView) ? requestedView : 'academic';
}

export function authorizeStudentProjection(ctx: UserContext, view: StudentProjectionView) {
  if (view === 'index') {
    requireRole(ctx, ['admin', 'teacher', 'office', 'accounting']);
    return;
  }
  if (view === 'identity' || view === 'academic') {
    requireRole(ctx, ['admin', 'teacher', 'office']);
    return;
  }
  if (view === 'finance') {
    assertFinanceAccess(ctx);
    return;
  }
  if (view === 'session') {
    requireRole(ctx, ['student', 'parent']);
    return;
  }
  if (view === 'attendance') {
    requireRole(ctx, ['admin', 'teacher', 'office']);
    return;
  }
  if (view === 'directory') {
    requireRole(ctx, ['admin', 'teacher', 'office']);
  }
}

export function canReadStudentDirectory(ctx: UserContext) {
  return ctx.role === 'admin' || ctx.role === 'teacher' || ctx.role === 'office';
}

export function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export function collectStudentIds(docs: Array<QueryDocumentSnapshot | DocumentSnapshot>) {
  const ids = new Set<string>();
  for (const doc of docs) {
    const studentId = String(doc.data()?.studentId || '');
    if (studentId) ids.add(studentId);
  }
  return ids;
}

export function collectAuditUserIds(docs: Array<QueryDocumentSnapshot | DocumentSnapshot>) {
  const ids = new Set<string>();
  for (const doc of docs) {
    const data = doc.data() || {};
    const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
    if (userId) ids.add(userId);
    if (data.collection === 'users' && typeof data.documentId === 'string') {
      const targetUserId = data.documentId.trim();
      if (targetUserId) ids.add(targetUserId);
    }
  }
  return ids;
}

export async function fetchStudentDocsByIds(
  db: DocumentStore,
  studentIds: Iterable<string>,
  knownDocs: Array<QueryDocumentSnapshot | DocumentSnapshot> = []
) {
  const knownIds = new Set(knownDocs.map((doc) => doc.id));
  const ids = [...new Set([...studentIds].filter((id) => id && !knownIds.has(id)))];
  if (ids.length === 0) return [];
  const refs = ids.map((id) => db.collection('students').doc(id));
  const docs = (await Promise.all(chunks(refs, 100).map((group) => db.getAll(...group)))).flat();
  return docs.filter((doc) => doc.exists);
}

export async function fetchAuditUsersByIds(db: DocumentStore, userIds: Iterable<string>) {
  const ids = [...new Set([...userIds].filter(Boolean))];
  if (ids.length === 0) return {};
  const refs = ids.map((id) => db.collection('users').doc(id));
  const docs = (await Promise.all(chunks(refs, 100).map((group) => db.getAll(...group)))).flat();
  const users: Record<string, { displayName?: string; email?: string; role?: string }> = {};
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data() || {};
    users[doc.id] = {
      displayName:
        typeof data.displayName === 'string'
          ? data.displayName
          : typeof data.name === 'string'
            ? data.name
            : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      role: typeof data.role === 'string' ? data.role : undefined,
    };
  }
  return users;
}

export function mergeDocsById(...groups: Array<Array<QueryDocumentSnapshot | DocumentSnapshot>>) {
  const byId = new Map<string, QueryDocumentSnapshot | DocumentSnapshot>();
  for (const group of groups) {
    for (const doc of group) {
      if (doc.data()) byId.set(doc.id, doc);
    }
  }
  return [...byId.values()];
}

export type TeacherAttendanceSessionRow = {
  id: string;
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  date: string;
  startTime?: string;
  schedule?: string;
  room?: string;
  sessionStatus: 'taught' | 'cancelled' | 'makeup';
  sessionKind: 'scheduled' | 'makeup' | 'cancelled';
  isVirtual: boolean;
  teacherAttendanceStatus: 'pending' | 'present' | 'absent';
  teacherAttendanceNote?: string;
  teacherAttendanceMarkedAt?: string;
  teacherAttendanceMarkedBy?: string;
  canMark: boolean;
  disabledReason?: 'future' | 'cancelled' | 'out_of_range';
};

export function getTeacherName(
  teacherId: string,
  teacherMap: Map<string, { uid: string; displayName: string; email?: string }>
) {
  return (
    teacherMap.get(teacherId)?.displayName || teacherMap.get(teacherId)?.email || 'Unknown teacher'
  );
}

export function getSessionKind(status: string): 'scheduled' | 'makeup' | 'cancelled' {
  if (status === 'makeup') return 'makeup';
  if (status === 'cancelled') return 'cancelled';
  return 'scheduled';
}

export function getTeacherAttendanceCanMark(input: {
  date: string;
  sessionStatus: 'taught' | 'cancelled' | 'makeup';
}) {
  if (input.sessionStatus === 'cancelled') {
    return { canMark: false, disabledReason: 'cancelled' as const };
  }
  if (isFutureVietnamDate(input.date)) {
    return { canMark: false, disabledReason: 'future' as const };
  }
  return { canMark: true };
}

export function isArchivedClassDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot | undefined
): boolean {
  return String(doc?.data()?.status || 'active') === 'archived';
}

/**
 * The ISO date a class was archived on, or null when it was never recorded.
 * Classes archived before `archivedAt` was introduced have no cutoff, so callers
 * must fall back to keeping their existing rows rather than hiding history.
 */
export function getClassArchivedCutoffDate(
  doc: QueryDocumentSnapshot | DocumentSnapshot | undefined
): string | null {
  const archivedAt = doc?.data()?.archivedAt;
  if (!archivedAt) return null;
  const value =
    typeof (archivedAt as { toDate?: () => Date }).toDate === 'function'
      ? (archivedAt as { toDate: () => Date }).toDate()
      : new Date(archivedAt as string | number | Date);
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

/**
 * An archived class must never surface new teacher-attendance work. Rows that were
 * already marked stay visible because payroll is derived from them, and pending rows
 * dated on or before the archive date stay so office can still settle them.
 */
export function shouldHideArchivedClassSession(input: {
  classDoc: QueryDocumentSnapshot | DocumentSnapshot;
  session: QueryDocumentSnapshot | DocumentSnapshot;
  date: string;
}): boolean {
  if (!isArchivedClassDoc(input.classDoc)) return false;
  const status = input.session.data()?.teacherAttendanceStatus;
  if (status === 'present' || status === 'absent') return false;
  const cutoff = getClassArchivedCutoffDate(input.classDoc);
  if (!cutoff) return false;
  return input.date > cutoff;
}

export function buildTeacherAttendanceRow(input: {
  id: string;
  classDoc: QueryDocumentSnapshot | DocumentSnapshot;
  session?: QueryDocumentSnapshot | DocumentSnapshot;
  date: string;
  teacherId: string;
  teacherMap: Map<string, { uid: string; displayName: string; email?: string }>;
  isVirtual: boolean;
}): TeacherAttendanceSessionRow {
  const classData = input.classDoc.data() || {};
  const sessionData = input.session?.data() || {};
  const sessionStatus = String(sessionData.status || 'taught') as 'taught' | 'cancelled' | 'makeup';
  const markState = getTeacherAttendanceCanMark({ date: input.date, sessionStatus });

  const resolvedSession = getClassSessionForDate(
    {
      startDate: typeof classData.startDate === 'string' ? classData.startDate : undefined,
      endDate: typeof classData.endDate === 'string' ? classData.endDate : undefined,
      daysOfWeek: Array.isArray(classData.daysOfWeek) ? (classData.daysOfWeek as number[]) : [],
      startTime: typeof classData.startTime === 'string' ? classData.startTime : undefined,
      schedule: typeof classData.schedule === 'string' ? classData.schedule : undefined,
      room: typeof classData.room === 'string' ? classData.room : undefined,
      weeklySessions: Array.isArray(classData.weeklySessions)
        ? (classData.weeklySessions as any[])
        : undefined,
    },
    input.date
  );

  return {
    id: input.id,
    classId: input.classDoc.id,
    className: String(classData.name || ''),
    teacherId: input.teacherId,
    teacherName: getTeacherName(input.teacherId, input.teacherMap),
    date: input.date,
    startTime:
      resolvedSession?.startTime ||
      (typeof classData.startTime === 'string' ? classData.startTime : undefined),
    schedule:
      resolvedSession?.schedule ||
      getClassTimeRange({
        startTime: typeof classData.startTime === 'string' ? classData.startTime : undefined,
        schedule: typeof classData.schedule === 'string' ? classData.schedule : undefined,
      }),
    room:
      resolvedSession?.room || (typeof classData.room === 'string' ? classData.room : undefined),
    sessionStatus,
    sessionKind: getSessionKind(sessionStatus),
    isVirtual: input.isVirtual,
    teacherAttendanceStatus: getTeacherAttendanceDisplayStatus(
      sessionData.teacherAttendanceStatus as 'present' | 'absent' | undefined
    ),
    ...(typeof sessionData.teacherAttendanceNote === 'string'
      ? { teacherAttendanceNote: sessionData.teacherAttendanceNote }
      : {}),
    ...(typeof sessionData.teacherAttendanceMarkedAt === 'string'
      ? { teacherAttendanceMarkedAt: sessionData.teacherAttendanceMarkedAt }
      : {}),
    ...(typeof sessionData.teacherAttendanceMarkedBy === 'string'
      ? { teacherAttendanceMarkedBy: sessionData.teacherAttendanceMarkedBy }
      : {}),
    ...markState,
  };
}
