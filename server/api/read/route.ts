import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { createHash } from 'node:crypto';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { getDb, verifyAuthContext } from '../lib/auth/verifyAuth.js';
import { assertActiveUser } from '../lib/auth/authz.js';
import { createServerTiming } from '../lib/http/serverTiming.js';
import {
  setServerTimingHeader,
  jsonSuccess,
  jsonError,
} from './handlers/utils.js';
import {
  readFinance,
  readDashboardAggregate,
  readAdminDashboardSummary,
  readCalendarWindow,
  readReportsMonthly,
  readJobs,
  readAccountingStudents,
  readStudents,
  readClasses,
  readOfficeAcademic,
  readOfficeTeachersMonth,
  readTeacherPayrollMonth,
  readTeacherAttendanceWeek,
  readClassDetail,
  readAssignments,
  readNotifications,
  readParentDashboard,
  readParentTuition,
  readAuditLog,
  readPasswordResetRequests,
  readOfficeWeeklyDashboard,
  readStudentAdminReport,
} from './handlers/readers.js';
import { readAccountingStudentFinanceWorkspace } from './handlers/accountingStudentFinance.js';
import { readAttendanceStudentQuickProfile } from './handlers/attendanceStudentQuickProfile.js';
import { getPostgresPool } from '../../db/client.js';
import {
  readAdminAccessConfigSql,
  readStudentDirectoryReferencesSql,
} from './handlers/frontendCollectionsSql.js';
import {
  readKnowledgeBankDocuments,
  readPrintRequestDocuments,
  readStaffPasswordResetRequestDocuments,
  readSubstituteRequestDocuments,
  readTeacherAvailabilityDocuments,
} from './handlers/frontendCollectionsDocument.js';

const NATIVE_POSTGRES_CHANNELS = new Set([
  'admin-access-config',
  'student-directory-references',
]);

function sendStudentIndexResponse(
  req: ApiRequest,
  res: ApiResponse,
  ctx: { uid: string; role: string },
  data: unknown
) {
  if (
    String(req.query.view || '').trim() !== 'index' ||
    typeof data !== 'object' ||
    data === null
  ) {
    return jsonSuccess(res, data);
  }

  const payload = data as {
    students?: unknown[];
    meta?: { complete?: boolean; version?: number };
  };
  if (!payload.meta?.complete || !Array.isArray(payload.students)) {
    return jsonSuccess(res, data);
  }

  const scope = ctx.role === 'teacher' ? ctx.role + ':' + ctx.uid : ctx.role;
  const checksum = createHash('sha256')
    .update(scope)
    .update(JSON.stringify(payload.students))
    .digest('hex')
    .slice(0, 16);
  const quote = String.fromCharCode(34);
  const etag = quote + 'students-' + Number(payload.meta.version || 0) + '-' + checksum + quote;

  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('ETag', etag);

  const ifNoneMatch = Array.isArray(req.headers?.['if-none-match'])
    ? req.headers?.['if-none-match'][0]
    : req.headers?.['if-none-match'];
  if (ifNoneMatch === etag) {
    return res.status(304).end();
  }

  return jsonSuccess(res, data);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'GET') {
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  const timing = createServerTiming();
  const sendSuccess = async (metric: string, read: () => Promise<unknown> | unknown) => {
    const data = await timing.measure(metric, read);
    setServerTimingHeader(res, timing);
    return jsonSuccess(res, data);
  };

  const verified = await timing.measure('auth', () => verifyAuthContext(req, res));
  if (!verified) return;

  try {
    const ctx = verified.context;
    assertActiveUser(ctx);
    const channel = String(req.query.channel || '').trim();

    if (NATIVE_POSTGRES_CHANNELS.has(channel)) {
      const pool = getPostgresPool();
      if (channel === 'admin-access-config')
        return await sendSuccess('read_admin-access-config_postgres', () =>
          readAdminAccessConfigSql(pool, ctx, req)
        );
      if (channel === 'student-directory-references')
        return await sendSuccess('read_student-directory-references_postgres', () =>
          readStudentDirectoryReferencesSql(pool, ctx, req)
        );
    }

    const db = getDb();

    if (channel === 'knowledge-bank') {
      return await sendSuccess('read_knowledge-bank', () =>
        readKnowledgeBankDocuments(db, ctx, req)
      );
    }
    if (channel === 'print-requests') {
      return await sendSuccess('read_print-requests', () =>
        readPrintRequestDocuments(db, ctx, req)
      );
    }
    if (channel === 'staff-password-reset-requests') {
      return await sendSuccess('read_staff-password-reset-requests', () =>
        readStaffPasswordResetRequestDocuments(db, ctx, req)
      );
    }
    if (channel === 'substitute-requests') {
      return await sendSuccess('read_substitute-requests', () =>
        readSubstituteRequestDocuments(db, ctx, req)
      );
    }
    if (channel === 'teacher-availability') {
      return await sendSuccess('read_teacher-availability', () =>
        readTeacherAvailabilityDocuments(db, ctx, req)
      );
    }

    if (channel === 'finance')
      return await sendSuccess('read_finance', () => readFinance(db, ctx, req));
    if (channel === 'dashboard-aggregate') {
      return await sendSuccess('read_dashboard-aggregate', () => readDashboardAggregate(db, ctx));
    }
    if (channel === 'admin-dashboard-summary') {
      return await sendSuccess('read_admin-dashboard-summary', () =>
        readAdminDashboardSummary(db, ctx)
      );
    }
    if (channel === 'calendar-window') {
      return await sendSuccess('read_calendar-window', () => readCalendarWindow(db, ctx, req));
    }
    if (channel === 'reports-monthly') {
      return await sendSuccess('read_reports-monthly', () => readReportsMonthly(db, ctx, req));
    }
    if (channel === 'jobs') return await sendSuccess('read_jobs', () => readJobs(db, ctx, req));
    if (channel === 'accounting-students') {
      return await sendSuccess('read_accounting-students', () =>
        readAccountingStudents(db, ctx, req)
      );
    }
    if (channel === 'accounting-student-finance') {
      return await sendSuccess('read_accounting-student-finance', () =>
        readAccountingStudentFinanceWorkspace(db, ctx, req)
      );
    }
    if (channel === 'students') {
      const data = await timing.measure('read_students', () => readStudents(db, ctx, req));
      setServerTimingHeader(res, timing);
      return sendStudentIndexResponse(req, res, ctx, data);
    }
    if (channel === 'classes')
      return await sendSuccess('read_classes', () => readClasses(db, ctx, req));
    if (channel === 'office-academic') {
      return await sendSuccess('read_office-academic', () => readOfficeAcademic(db, ctx, req));
    }
    if (channel === 'office-weekly-dashboard') {
      return await sendSuccess('read_office-weekly-dashboard', () =>
        readOfficeWeeklyDashboard(db, ctx, req)
      );
    }
    if (channel === 'office-teachers-month') {
      return await sendSuccess('read_office-teachers-month', () =>
        readOfficeTeachersMonth(db, ctx, req)
      );
    }
    if (channel === 'teacher-payroll-month') {
      return await sendSuccess('read_teacher-payroll-month', () =>
        readTeacherPayrollMonth(db, ctx, req)
      );
    }
    if (channel === 'teacher-attendance-week') {
      return await sendSuccess('read_teacher-attendance-week', () =>
        readTeacherAttendanceWeek(db, ctx, req)
      );
    }
    if (channel === 'class-detail')
      return await sendSuccess('read_class-detail', () => readClassDetail(db, ctx, req));
    if (channel === 'attendance-student-quick-profile') {
      return await sendSuccess('read_attendance-student-quick-profile', () =>
        readAttendanceStudentQuickProfile(db, ctx, req)
      );
    }
    if (channel === 'student-admin-report') {
      return await sendSuccess('read_student-admin-report', () =>
        readStudentAdminReport(db, ctx, req)
      );
    }
    if (channel === 'assignments')
      return await sendSuccess('read_assignments', () => readAssignments(db, ctx, req));
    if (channel === 'parent-dashboard') {
      return await sendSuccess('read_parent-dashboard', () => readParentDashboard(db, ctx, req));
    }
    if (channel === 'parent-tuition')
      return await sendSuccess('read_parent-tuition', () => readParentTuition(db, ctx, req));
    if (channel === 'audit-log')
      return await sendSuccess('read_audit-log', () => readAuditLog(db, ctx, req));
    if (channel === 'password-reset-requests') {
      return await sendSuccess('read_password-reset-requests', () =>
        readPasswordResetRequests(db, ctx, req)
      );
    }
    if (channel === 'notifications') {
      return await sendSuccess('read_notifications', () => readNotifications(db, ctx, req));
    }

    setServerTimingHeader(res, timing);
    return jsonError(res, 404, 'unknown_channel', 'Unknown read channel');
  } catch (err) {
    setServerTimingHeader(res, timing);
    const statusCode =
      typeof err === 'object' &&
      err !== null &&
      'statusCode' in err &&
      typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    const message =
      statusCode >= 500
        ? 'Read request failed'
        : err instanceof Error
          ? err.message
          : 'Request failed';
    const explicitErrorCode =
      typeof err === 'object' &&
      err !== null &&
      'errorCode' in err &&
      typeof (err as { errorCode?: unknown }).errorCode === 'string'
        ? (err as { errorCode: string }).errorCode
        : null;
    return jsonError(
      res,
      statusCode,
      explicitErrorCode || (statusCode >= 500 ? 'internal_error' : 'forbidden'),
      message
    );
  }
}
