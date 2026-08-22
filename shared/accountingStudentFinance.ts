import type { StudentCourseEnrollmentStatus } from './studentCourseEnrollment.js';

export type AccountingPaymentStatus =
  | 'overdue'
  | 'partial'
  | 'unpaid'
  | 'missing_ledger'
  | 'paid'
  | 'waived';

export type StudentCourseEnrollmentView = {
  id: string;
  status: StudentCourseEnrollmentStatus;
  joinedAt: string;
  endedAt: string | null;
  source: 'system' | 'backfill' | 'manual';
  confidence: 'confirmed' | 'inferred';
};

export type StudentCourseSessionSummary = {
  attended: number;
  attendedSessions?: number;
  elapsed: number;
  occurredSessions?: number;
  absentExcused: number;
  absentUnexcused: number;
  onLeave: number;
  complete: boolean;
  completedSessions?: number;
  completeKnown?: boolean;
};

export type StudentCourseFinanceSummary = {
  enrollment: StudentCourseEnrollmentView;
  termKey: string;
  className: string;
  termIndex: number;
  sessions: StudentCourseSessionSummary;
  finance: {
    ledgerId: string | null;
    grossAmount: number;
    discount: number;
    netAmount: number;
    paid: number;
    outstanding: number;
    dueDate: string | null;
    status: AccountingPaymentStatus;
    tuitionReminderCount?: number;
    lastTuitionReminderAt?: string | null;
  };
};

export type AccountingStudentSummary = {
  studentId: string;
  studentName: string;
  studentNameNormalized: string;
  studentCode: string;
  searchTokens: string[];
  studentLifecycle: string;
  currentClassId: string | null;
  currentEnrollmentId: string | null;
  currentEnrollmentStatus: StudentCourseEnrollmentStatus | null;
  currentCoursePaymentStatus: AccountingPaymentStatus;
  classCount: number;
  courseCount: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueCourseCount: number;
  priorityRank: number;
  tuitionReminderCount?: number;
  lastTuitionReminderAt?: string | null;
  enrollmentClassIds?: string[];
  enrollmentStatuses?: StudentCourseEnrollmentStatus[];
  sourceVersion: number;
  rebuiltAt: string;
};

export type AccountingStudentFinanceQuery = {
  cursor?: string;
  limit?: number;
  search?: string;
  classId?: string;
  lifecycleScope?: 'current' | 'all';
  enrollmentStatus?: StudentCourseEnrollmentStatus;
  paymentStatus?: AccountingPaymentStatus;
};

export type AccountingStudentFinancePage = {
  rows: AccountingStudentSummary[];
  page: { nextCursor: string | null; hasMore: boolean };
  dataIncomplete: boolean;
  generatedAt: string;
};

export function normalizeAccountingSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Longest word prefix stored in `searchTokens`, so the index stays bounded. */
export const ACCOUNTING_SEARCH_PREFIX_MAX = 12;

/**
 * The words a search box query is made of. Every word has to match, which is what
 * lets a pasted full name find its student even though tokens are indexed per word.
 */
export function parseAccountingSearchTerms(value: string): string[] {
  return normalizeAccountingSearch(value).split(/\s+/).filter(Boolean);
}

export function buildAccountingSearchTokens(name: string, code: string): string[] {
  const words = parseAccountingSearchTerms(`${name} ${code}`);
  return [
    ...new Set(
      words.flatMap((word) => [
        word,
        ...Array.from({ length: Math.min(ACCOUNTING_SEARCH_PREFIX_MAX, word.length) }, (_, index) =>
          word.slice(0, index + 1)
        ),
      ])
    ),
  ];
}

/**
 * DocumentStore `array-contains` takes a single value, so one term narrows the query and
 * the rest are applied in memory. Only prefixes up to ACCOUNTING_SEARCH_PREFIX_MAX are
 * indexed, so the term is truncated to stay inside the stored set \u2014 the in-memory pass
 * re-applies the untruncated word.
 */
export function selectAccountingSearchIndexTerm(terms: readonly string[]): string | null {
  let longest = '';
  for (const term of terms) if (term.length > longest.length) longest = term;
  return longest ? longest.slice(0, ACCOUNTING_SEARCH_PREFIX_MAX) : null;
}

export function matchesAccountingSearchTerms(
  row: { studentName?: unknown; studentNameNormalized?: unknown; studentCode?: unknown },
  terms: readonly string[]
): boolean {
  if (terms.length === 0) return true;
  const name =
    typeof row.studentNameNormalized === 'string' && row.studentNameNormalized
      ? row.studentNameNormalized
      : normalizeAccountingSearch(String(row.studentName || ''));
  const haystack = `${name} ${normalizeAccountingSearch(String(row.studentCode || ''))}`;
  return terms.every((term) => haystack.includes(term));
}

export function deriveAccountingPaymentStatus(input: {
  ledgerExists: boolean;
  netAmount: number;
  paid: number;
  dueDate?: string | null;
  today?: string;
  waived?: boolean;
}): AccountingPaymentStatus {
  if (input.waived) return 'waived';
  if (!input.ledgerExists) return 'missing_ledger';
  if (input.netAmount <= 0) return 'paid';
  if (input.paid >= input.netAmount) return 'paid';
  if (input.paid > 0) return input.dueDate && input.today && input.dueDate < input.today ? 'overdue' : 'partial';
  if (input.dueDate && input.today && input.dueDate < input.today) return 'overdue';
  return 'unpaid';
}

export function calculatePriorityRank(status: AccountingPaymentStatus): number {
  if (status === 'overdue') return 0;
  if (status === 'partial') return 1;
  if (status === 'unpaid' || status === 'missing_ledger') return 2;
  return 3;
}
