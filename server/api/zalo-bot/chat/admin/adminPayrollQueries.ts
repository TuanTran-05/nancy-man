import type { ApiRequest } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { resolvePeriodBounds } from '../../../../../shared/adminChatMetrics.js';
import { buildTeacherPayrollMonthView } from '../../../../../src/lib/payroll/teacherPayrollMonth.js';
import type { UserContext } from '../../../lib/auth/authz.js';
import { readTeacherMonthPayload } from '../../../read/handlers/readers.js';
import type { AdminDataQualityIssue, AdminTeacherPayrollResult } from './adminChatTypes.js';
import type { ResolvedTeacher } from './adminEntityResolver.js';

/** Uses the same server loader and pure payroll view as the Office payroll report. */
export async function queryAdminTeacherPayroll(
  db: DocumentStore,
  options: {
    period?: string | null;
    teacher?: ResolvedTeacher | null;
    actor: UserContext;
  },
  now = new Date()
): Promise<AdminTeacherPayrollResult> {
  const computedAt = now.toISOString();
  const period = resolvePeriodBounds(options.period, now);
  const monthKey = period.monthKey ?? now.toISOString().slice(0, 7);
  const request = {
    query: { month: monthKey, limit: '2000' },
  } as unknown as ApiRequest;

  const payload = await readTeacherMonthPayload(db, options.actor, request, ['admin']);
  const truncatedSources = payload.truncatedSources ?? [];
  const issues: AdminDataQualityIssue[] = truncatedSources.map((source) => ({
    code: 'result_cap_reached',
    source,
  }));

  if (truncatedSources.length > 0) {
    return {
      kind: 'teacher_payroll',
      period,
      teacherId: options.teacher?.teacherId ?? null,
      teacherName: options.teacher?.teacherName ?? null,
      totalSessions: null,
      accruedSalary: null,
      classBreakdown: [],
      quality: { status: 'failed', issues },
      computedAt,
      source: 'teacher_payroll_month_v2',
    };
  }

  const view = buildTeacherPayrollMonthView({
    ...(payload as unknown as Parameters<typeof buildTeacherPayrollMonthView>[0]),
    teacherIdFilter: options.teacher?.teacherId,
  });

  if (options.teacher) {
    const row = view.rows.find((candidate) => candidate.teacher.uid === options.teacher!.teacherId);
    return {
      kind: 'teacher_payroll',
      period,
      teacherId: options.teacher.teacherId,
      teacherName: options.teacher.teacherName,
      totalSessions: row?.totalSessions ?? 0,
      accruedSalary: row?.totalSalary ?? 0,
      classBreakdown: row
        ? Object.entries(row.classes).map(([classId, item]) => ({
            classId,
            className: item.class.name,
            sessionCount: item.count,
            salary: item.salary,
          }))
        : [],
      quality: { status: 'complete', issues: [] },
      computedAt,
      source: 'teacher_payroll_month_v2',
    };
  }

  return {
    kind: 'teacher_payroll',
    period,
    teacherId: null,
    teacherName: null,
    totalSessions: view.rows.reduce((total, row) => total + row.totalSessions, 0),
    accruedSalary: view.rows.reduce((total, row) => total + row.totalSalary, 0),
    classBreakdown: [],
    quality: { status: 'complete', issues: [] },
    computedAt,
    source: 'teacher_payroll_month_v2',
  };
}
