import { queryOptions } from '@tanstack/react-query';
import { readTeacherPayrollMonth } from '../api/teacherPayrollApi';

export const TEACHER_PAYROLL_STALE_TIME_MS = 15 * 60_000;
export const TEACHER_PAYROLL_GC_TIME_MS = 30 * 60_000;

type TeacherPayrollQueryIdentity = {
  uid: string;
  role: string;
};

export const teacherPayrollQueryKeys = {
  // `teacher-payroll-month` is scoped by the caller's context server-side —
  // office has salary stripped, a teacher sees only their own rows — and
  // `queryClient` is a module-level singleton that outlives sign-out, so the
  // key has to carry identity or one role reads another's payroll.
  month: ({ uid, role }: TeacherPayrollQueryIdentity, month: string) =>
    ['teacher-payroll', uid, role, 'month', month] as const,
};

export function teacherPayrollMonthQueryOptions(
  identity: TeacherPayrollQueryIdentity,
  month: string,
  enabled: boolean
) {
  return queryOptions({
    queryKey: teacherPayrollQueryKeys.month(identity, month),
    queryFn: () => readTeacherPayrollMonth(month),
    enabled,
    staleTime: TEACHER_PAYROLL_STALE_TIME_MS,
    gcTime: TEACHER_PAYROLL_GC_TIME_MS,
    refetchInterval: TEACHER_PAYROLL_STALE_TIME_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
