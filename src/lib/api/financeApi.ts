import type { WalletHistoryResponse, WalletStudentContext } from '../../types/finance';
import type { EnrollmentStatus, StudentLifecycle } from '../../types/student';
import type { CanonicalStudentPlacementStatus } from '../../../shared/canonicalStudentReadModel';
import type {
  CenterReportDetailsResponse,
  FinanceDetailType,
  FinanceDetailsScope,
} from '../../../shared/centerFinanceReportDetails';

export type {
  CenterReportExpenseDetailsResponse,
  CenterReportDetailsResponse,
  CenterReportIncomeDetailsResponse,
  ExpenseTransactionDetail,
  FinanceDetailType,
  FinanceDetailsScope,
  IncomeTransactionDetail,
} from '../../../shared/centerFinanceReportDetails';

const API_BASE = '/api/v1/finance';

async function getAuthHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
}

type ApiResponse = {
  success?: boolean;
  error?: string;
  errorCode?: string;
  [key: string]: unknown;
};

function parseApiResponse(text: string, status: number): ApiResponse {
  try {
    return JSON.parse(text) as ApiResponse;
  } catch {
    throw new Error(`Server returned non-JSON response (status ${status}): ${text.slice(0, 100)}`);
  }
}

async function apiPost<T extends object = Record<string, unknown>>(
  path: string,
  body?: unknown
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = parseApiResponse(await res.text(), res.status);
  if (!res.ok || !data.success) throw new Error(data.error || 'API request failed');
  return data as T;
}

import type {
  ClassReconciliationOptionsResponse,
  ClassTuitionReconciliationResponse,
  ClassTuitionStudentDetailResponse,
} from '../../../shared/classTuitionReconciliation';

export type {
  ClassReconciliationOptionsResponse,
  ClassTuitionReconciliationResponse,
  ClassTuitionStudentDetailResponse,
};

async function apiGet<T extends object>(path: string, signal?: AbortSignal): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, { method: 'GET', headers, signal });
  const data = parseApiResponse(await res.text(), res.status);
  if (!res.ok || !data.success) {
    const err = new Error(data.error || 'API request failed') as Error & {
      errorCode?: string;
      status?: number;
    };
    err.errorCode = data.errorCode;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export async function postReceipt(receiptId: string) {
  return apiPost(`/receipts/${receiptId}/post`);
}

export async function voidReceipt(
  receiptId: string,
  body: { idempotencyKey: string; reason: string }
) {
  return apiPost<{ success: true; newBalance?: number }>(`/receipts/${receiptId}/void`, body);
}

export async function postExpense(expenseId: string) {
  return apiPost(`/expenses/${expenseId}/post`);
}

export async function voidExpense(expenseId: string) {
  return apiPost(`/expenses/${expenseId}/void`);
}

export async function createAndPostReceipt(body: Record<string, unknown>) {
  return apiPost('/receipts/create-and-post', body);
}

export async function createAndPostExpense(body: Record<string, unknown>) {
  return apiPost('/expenses/create-and-post', body);
}

export async function getNextReceiptNumber(): Promise<string> {
  const data = await apiGet<{ receiptNo: string }>('/receipts/next-number');
  return data.receiptNo;
}

export async function getNextExpenseNumber(): Promise<string> {
  const data = await apiGet<{ expenseNo: string }>('/expenses/next-number');
  return data.expenseNo;
}

interface LevelBreakdown {
  level: string;
  label: { vi: string; en: string };
  amount: number;
}

interface CategoryBreakdown {
  category: string;
  label: { vi: string; en: string };
  amount: number;
}

export interface DailyFinanceBreakdown {
  date: string;
  income: number;
  expenses: number;
  balance: number;
}

export interface FinanceReport {
  totalIncome: number;
  totalExpenses: number;
  totalScholarships?: number;
  balance: number;
  monthlyBreakdown: { month: string; income: number; expenses: number; balance: number }[];
  dailyBreakdown?: DailyFinanceBreakdown[];
  incomeByLevel?: LevelBreakdown[];
  expensesByCategory?: CategoryBreakdown[];
  source?: 'live' | 'aggregate';
}

export async function fetchFinanceReport(
  startDate: string,
  endDate: string,
  options: { forceLive?: boolean; includeDaily?: boolean } = {}
): Promise<FinanceReport> {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (options.forceLive) params.set('forceLive', '1');
  if (options.includeDaily) params.set('includeDaily', '1');
  const qs = params.toString();
  return apiGet<FinanceReport>(`/report${qs ? `?${qs}` : ''}`);
}

export interface CenterMonth {
  month: string;
  grossBilled: number;
  discountTotal: number;
  netBilled: number;
  collectedCohort: number;
  outstanding: number;
  cashIn: number;
  cashOut: number;
}

export interface CenterFinanceReport {
  success: true;
  selectedMonth: string;
  months: CenterMonth[];
  current: CenterMonth;
  discountBreakdown: { discount: number; waiver: number; unclassified: number };
  incomeByLevel: Array<{ level: string; label: { vi: string; en: string }; amount: number }>;
  expensesByCategory: Array<{
    category: string;
    label: { vi: string; en: string };
    amount: number;
  }>;
  receivablesByStatus: Array<{ status: string; count: number; outstanding: number }>;
  studentPayments: {
    summary: {
      total: number;
      paid: number;
      partial: number;
      unpaid: number;
      waived: number;
      withOutstanding: number;
      overdue: number;
    };
    rows: Array<{
      id: string;
      fullName: string;
      studentCode: string;
      dateOfBirth: string;
      phone: string;
      paymentStatus: 'paid' | 'partial' | 'unpaid' | 'waived';
      billedAmount: number;
      paidAmount: number;
      outstandingAmount: number;
      overdueAmount: number;
      ledgerCount: number;
      courses: Array<{
        id: string;
        courseLabel: string;
        termStart: string;
        termEnd: string;
        classId: string;
        className: string;
        teacherId: string;
        teacherName: string;
        paymentStatus: 'paid' | 'partial' | 'unpaid' | 'waived';
        billedAmount: number;
        paidAmount: number;
        outstandingAmount: number;
        overdueAmount: number;
      }>;
      studentRecordFound: boolean;
    }>;
  };
  source: 'live';
}

export async function fetchCenterFinanceReport(
  month: string,
  months = 12
): Promise<CenterFinanceReport> {
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  params.set('months', String(months));
  return apiGet<CenterFinanceReport>(`/center-report?${params.toString()}`);
}

export function fetchCenterFinanceReportDetails(
  input: FinanceDetailsScope & {
    type: FinanceDetailType;
    pageSize?: number;
    cursor?: string | null;
  }
): Promise<CenterReportDetailsResponse> {
  const params = new URLSearchParams();
  if ('month' in input) {
    params.set('month', input.month);
  } else {
    params.set('startDate', input.startDate);
    params.set('endDate', input.endDate);
  }
  params.set('type', input.type);
  params.set('pageSize', String(input.pageSize ?? 25));
  if (input.cursor) params.set('cursor', input.cursor);
  return apiGet<CenterReportDetailsResponse>(`/center-report-details?${params.toString()}`);
}

export async function voidWalletTransaction(
  transactionId: string,
  reason: string,
  idempotencyKey: string
) {
  return apiPost<{ newBalance: number }>(`/wallet/${transactionId}/void`, {
    reason,
    idempotencyKey,
  });
}

export async function fetchWalletTransactions(studentId: string) {
  return apiGet<WalletHistoryResponse>(
    `/wallet/transactions?studentId=${encodeURIComponent(studentId)}`
  );
}

export function fetchWalletStudentContext(studentId: string) {
  return apiGet<WalletStudentContext>(
    `/wallet/student-context?studentId=${encodeURIComponent(studentId)}`
  );
}

export function allocateStudentWallet(body: {
  idempotencyKey: string;
  studentId: string;
  allocations: Array<{ ledgerId: string; amount: number }>;
}) {
  return apiPost<{ transactionGroupId: string; newBalance: number }>(
    '/wallet/allocate-and-post',
    body
  );
}

export async function fetchWalletBalances() {
  return apiGet<{
    students: Array<{
      id: string;
      name: string;
      code: string;
      dob?: string;
      classId?: string;
      className?: string;
      classStatus?: string;
      contact?: string;
      studentLifecycle?: StudentLifecycle;
      enrollmentStatus?: EnrollmentStatus;
      /** Enrollment-derived; supersedes `enrollmentStatus` where present. */
      placementStatus?: CanonicalStudentPlacementStatus;
      isRevoked?: boolean;
      walletBalance: number;
    }>;
  }>('/wallet/balances');
}

export async function fetchClassReconciliationOptions(
  classId?: string,
  signal?: AbortSignal
): Promise<ClassReconciliationOptionsResponse> {
  const query = classId ? `?classId=${encodeURIComponent(classId)}` : '';
  return apiGet<ClassReconciliationOptionsResponse>(
    `/class-reconciliation-options${query}`,
    signal
  );
}

export async function fetchClassTuitionReconciliation(input: {
  classId: string;
  termStart: string;
  signal?: AbortSignal;
}): Promise<ClassTuitionReconciliationResponse> {
  const params = new URLSearchParams({
    classId: input.classId,
    termStart: input.termStart,
  });
  return apiGet<ClassTuitionReconciliationResponse>(
    `/class-reconciliation?${params.toString()}`,
    input.signal
  );
}

export async function fetchClassTuitionStudentDetail(input: {
  classId: string;
  termStart: string;
  studentId?: string;
  ledgerId?: string;
  signal?: AbortSignal;
}): Promise<ClassTuitionStudentDetailResponse> {
  const params = new URLSearchParams({
    classId: input.classId,
    termStart: input.termStart,
  });
  if (input.studentId) params.set('studentId', input.studentId);
  if (input.ledgerId) params.set('ledgerId', input.ledgerId);

  return apiGet<ClassTuitionStudentDetailResponse>(
    `/class-reconciliation-student?${params.toString()}`,
    input.signal
  );
}
