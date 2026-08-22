import { RealtimeEventKey } from '../../hooks/useInvalidationRefresh';

export const ROLE_ALLOWED_CHANNELS: Record<string, RealtimeEventKey[]> = {
  admin: [
    'students',
    'finance-ledger',
    'finance-receipt',
    'finance-expense',
    'parent-tuition',
    'parent-dashboard',
    'admin-summary',
    'admissions',
    'accounting-students',
    'accounting-student-finance',
    'knowledge-bank',
    'payroll',
    'teacher-availability',
    'course-closing',
  ],
  accounting: [
    'students',
    'finance-ledger',
    'finance-receipt',
    'finance-expense',
    'accounting-students',
    'accounting-student-finance',
    'knowledge-bank',
    'payroll',
    'course-closing',
  ],
  office: [
    'students',
    'admissions',
    'accounting-students',
    'knowledge-bank',
    'teacher-availability',
    'course-closing',
  ],
  teacher: ['students', 'knowledge-bank', 'payroll', 'teacher-availability', 'course-closing'],
  parent: ['parent-tuition', 'parent-dashboard'],
  student: ['parent-tuition', 'parent-dashboard'],
};

export function isChannelAllowedForRole(role: string, channelKey: RealtimeEventKey): boolean {
  const allowed = ROLE_ALLOWED_CHANNELS[role];
  return allowed ? allowed.includes(channelKey) : false;
}
