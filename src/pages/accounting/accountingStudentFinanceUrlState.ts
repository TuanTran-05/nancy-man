import type { AccountingPaymentStatus } from '../../../shared/accountingStudentFinance';
import type { StudentCourseEnrollmentStatus } from '../../../shared/studentCourseEnrollment';

export type AccountingStudentFinanceUrlState = {
  search: string;
  paymentStatus: AccountingPaymentStatus | 'all';
  lifecycleScope: 'current' | 'all';
  enrollmentStatus: StudentCourseEnrollmentStatus | 'all';
  classId: string;
  expandedStudentId: string;
};

const PAYMENT_STATUSES = new Set<AccountingStudentFinanceUrlState['paymentStatus']>([
  'all',
  'overdue',
  'partial',
  'unpaid',
  'missing_ledger',
  'paid',
  'waived',
]);
const ENROLLMENT_STATUSES = new Set<AccountingStudentFinanceUrlState['enrollmentStatus']>([
  'all',
  'trial',
  'active',
  'on_leave',
  'completed',
  'transferred',
  'dropped',
]);

export function parseAccountingStudentFinanceUrl(search: string): AccountingStudentFinanceUrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const paymentStatus = params.get('studentPaymentStatus') || 'all';
  const enrollmentStatus = params.get('studentEnrollmentStatus') || 'all';
  return {
    search: params.get('studentSearch') || '',
    paymentStatus: PAYMENT_STATUSES.has(
      paymentStatus as AccountingStudentFinanceUrlState['paymentStatus']
    )
      ? (paymentStatus as AccountingStudentFinanceUrlState['paymentStatus'])
      : 'all',
    lifecycleScope: params.get('studentLifecycleScope') === 'all' ? 'all' : 'current',
    enrollmentStatus: ENROLLMENT_STATUSES.has(
      enrollmentStatus as AccountingStudentFinanceUrlState['enrollmentStatus']
    )
      ? (enrollmentStatus as AccountingStudentFinanceUrlState['enrollmentStatus'])
      : 'all',
    classId: params.get('studentClassId') || '',
    expandedStudentId: params.get('studentExpandedId') || '',
  };
}

export function serializeAccountingStudentFinanceUrl(
  state: Partial<AccountingStudentFinanceUrlState> &
    Pick<AccountingStudentFinanceUrlState, 'search' | 'paymentStatus'>,
  currentSearch = ''
): string {
  const params = new URLSearchParams(
    currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch
  );
  if (state.search.trim()) params.set('studentSearch', state.search.trim());
  else params.delete('studentSearch');
  if (state.paymentStatus !== 'all') params.set('studentPaymentStatus', state.paymentStatus);
  else params.delete('studentPaymentStatus');
  if (state.lifecycleScope === 'all') params.set('studentLifecycleScope', 'all');
  else params.delete('studentLifecycleScope');
  if (state.enrollmentStatus && state.enrollmentStatus !== 'all')
    params.set('studentEnrollmentStatus', state.enrollmentStatus);
  else params.delete('studentEnrollmentStatus');
  if (state.classId) params.set('studentClassId', state.classId);
  else params.delete('studentClassId');
  if (state.expandedStudentId) params.set('studentExpandedId', state.expandedStudentId);
  else params.delete('studentExpandedId');
  const result = params.toString();
  return result ? `?${result}` : '';
}
