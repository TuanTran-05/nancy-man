import { finiteMoney } from './money.js';
import {
  calculateLedgerBalance,
  deriveLedgerDisplayStatus,
  type LedgerLike,
} from './studentFinanceReport.js';

export type CenterLedgerRow = {
  id: string;
  studentId?: string;
  amount?: unknown;
  paidTotal?: unknown;
  discountTotal?: unknown;
  status?: string;
  periodType?: string;
  month?: string;
  termStart?: string;
  termEnd?: string;
  termLabel?: string;
  createdAt?: string; // normalized to a string by the repository (DocumentStore stores a Timestamp)
  dueDate?: string | null;
  classId?: string;
};

export type CenterReceiptRow = {
  id: string;
  amountReceived?: unknown;
  discountAmount?: unknown;
  discountType?: string;
  siblingDiscount?: boolean;
  siblingDiscountAmount?: number;
  originalAmount?: number;
  receivedDate?: string;
  classId?: string;
  /** True for wallet top-up receipts, which are not tied to a course. */
  walletDeposit?: boolean;
  flowVersion?: 'wallet-manual-v2';
  classIds?: string[];
  allocations?: Array<{ ledgerId: string; classId: string; amount: number }>;
};

export type CenterExpenseRow = {
  id: string;
  amount?: unknown;
  paidDate?: string;
  category?: string;
};

export type CenterStudentRow = {
  id: string;
  name?: string;
  studentId?: string;
  dob?: string;
  contact?: string;
};

export type CenterClassInfoRow = {
  id: string;
  className: string;
  teacherId: string;
  teacherName: string;
};

export type StudentPaymentStatus = 'paid' | 'partial' | 'unpaid' | 'waived';

export type StudentPaymentCourseRow = {
  id: string;
  courseLabel: string;
  termStart: string;
  termEnd: string;
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  paymentStatus: StudentPaymentStatus;
  billedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  overdueAmount: number;
};

export type StudentPaymentRow = {
  id: string;
  fullName: string;
  studentCode: string;
  dateOfBirth: string;
  phone: string;
  paymentStatus: StudentPaymentStatus;
  billedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  overdueAmount: number;
  ledgerCount: number;
  courses: StudentPaymentCourseRow[];
  studentRecordFound: boolean;
};

export type StudentPaymentSummary = {
  total: number;
  paid: number;
  partial: number;
  unpaid: number;
  waived: number;
  withOutstanding: number;
  overdue: number;
};

export type StudentPaymentReport = {
  summary: StudentPaymentSummary;
  rows: StudentPaymentRow[];
};

export type CenterMonth = {
  month: string;
  grossBilled: number;
  discountTotal: number;
  netBilled: number;
  collectedCohort: number;
  outstanding: number;
  cashIn: number;
  cashOut: number;
};

function monthOf(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : '';
}

export function ledgerCohortMonth(ledger: CenterLedgerRow): string {
  const monthValid = typeof ledger.month === 'string' && /^\d{4}-\d{2}$/.test(ledger.month);
  // Spec decision 5: monthly ledger -> its month; course ledger -> termStart month; else createdAt.
  if (ledger.periodType === 'monthly' && monthValid) return ledger.month as string;
  const fromTerm = monthOf(ledger.termStart);
  if (fromTerm) return fromTerm;
  if (monthValid) return ledger.month as string; // defensive: monthly ledger without periodType set
  return monthOf(ledger.createdAt);
}

function isApiDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function ledgerOverlapsMonth(ledger: CenterLedgerRow, month: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;

  const monthValid =
    typeof ledger.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ledger.month);
  if (ledger.periodType === 'monthly' && monthValid) return ledger.month === month;

  const start = isApiDate(ledger.termStart) ? ledger.termStart : '';
  const end = isApiDate(ledger.termEnd) ? ledger.termEnd : '';
  if (start && end) {
    if (start > end) return false;
    const [year, monthNumber] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    return start <= monthEnd && end >= monthStart;
  }
  if (start) return monthOf(start) === month;
  if (end) return monthOf(end) === month;
  if (monthValid) return ledger.month === month;
  return monthOf(ledger.createdAt) === month;
}

export function buildCenterMonths(
  monthsWindow: string[],
  ledgers: CenterLedgerRow[],
  receipts: CenterReceiptRow[],
  expenses: CenterExpenseRow[]
): CenterMonth[] {
  const base = new Map<string, CenterMonth>();
  for (const month of monthsWindow) {
    base.set(month, {
      month,
      grossBilled: 0,
      discountTotal: 0,
      netBilled: 0,
      collectedCohort: 0,
      outstanding: 0,
      cashIn: 0,
      cashOut: 0,
    });
  }

  for (const ledger of ledgers) {
    const row = base.get(ledgerCohortMonth(ledger));
    if (!row) continue;
    // Reuse the canonical ledger math (Global Constraint) instead of re-deriving thresholds.
    const bal = calculateLedgerBalance(ledger as LedgerLike);
    row.grossBilled += bal.grossAmount;
    row.discountTotal += bal.discount;
    row.netBilled += bal.netAmount;
    // Cap collected at net so the waterfall invariant holds even with overpayment/legacy anomalies
    // (paidTotal > net): netBilled − collectedCohort === outstanding, always. Overpayment is not
    // revenue, so it must not inflate the "collected" bar. Cash actually received is tracked
    // separately via `cashIn` (receipts).
    row.collectedCohort += Math.min(bal.paid, bal.netAmount);
    row.outstanding += bal.outstanding;
  }

  for (const receipt of receipts) {
    const row = base.get(monthOf(receipt.receivedDate));
    if (row) row.cashIn += finiteMoney(receipt.amountReceived);
  }

  for (const expense of expenses) {
    const row = base.get(monthOf(expense.paidDate));
    if (row) row.cashOut += finiteMoney(expense.amount);
  }

  return monthsWindow.map((month) => base.get(month)!);
}

export const DISCOUNT_KIND_TYPES = ['first_prize', 'second_prize', 'custom'] as const;
export const WAIVER_KIND_TYPES = ['full_waiver', 'hardship'] as const;

export type DiscountBreakdown = { discount: number; waiver: number; unclassified: number };

export function splitDiscounts(receipts: CenterReceiptRow[]): DiscountBreakdown {
  const result: DiscountBreakdown = { discount: 0, waiver: 0, unclassified: 0 };
  for (const receipt of receipts) {
    const amount = finiteMoney(receipt.discountAmount);
    if (amount <= 0) continue;

    // The sibling scholarship is always a commercial reduction, and it stacks on
    // top of any other kind. Peel it off first so a hardship receipt that also
    // carries it reports 10% as giảm giá and the rest as miễn giảm, instead of
    // forcing the whole receipt into one bucket.
    const explicitSiblingPart = Math.max(0, finiteMoney(receipt.siblingDiscountAmount));
    const inferredLegacyPart =
      explicitSiblingPart <= 0 && receipt.siblingDiscount === true
        ? Math.round(Math.max(0, finiteMoney(receipt.originalAmount)) * 0.1)
        : 0;
    const siblingPart = Math.min(explicitSiblingPart || inferredLegacyPart, amount);
    result.discount += siblingPart;

    const remainder = amount - siblingPart;
    if (remainder <= 0) continue;

    const type = receipt.discountType || 'none';
    if ((DISCOUNT_KIND_TYPES as readonly string[]).includes(type)) result.discount += remainder;
    else if ((WAIVER_KIND_TYPES as readonly string[]).includes(type)) result.waiver += remainder;
    else result.unclassified += remainder;
  }
  return result;
}

export type ReceivableStatusRow = { status: string; count: number; outstanding: number };

export function aggregateReceivablesByStatus(
  ledgers: CenterLedgerRow[],
  todayStr: string
): ReceivableStatusRow[] {
  const map = new Map<string, ReceivableStatusRow>();
  for (const ledger of ledgers) {
    const info = deriveLedgerDisplayStatus(ledger as LedgerLike, todayStr);
    if (info.outstanding <= 0) continue;
    const current = map.get(info.displayStatus) || {
      status: info.displayStatus,
      count: 0,
      outstanding: 0,
    };
    current.count += 1;
    current.outstanding += info.outstanding;
    map.set(info.displayStatus, current);
  }
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding);
}

export function aggregateStudentPayments(
  ledgers: CenterLedgerRow[],
  students: CenterStudentRow[],
  todayStr: string,
  classes: CenterClassInfoRow[] = []
): StudentPaymentReport {
  const studentsById = new Map(students.map((student) => [student.id, student]));
  const classesById = new Map(classes.map((classInfo) => [classInfo.id, classInfo]));
  const grouped = new Map<
    string,
    {
      studentId: string;
      billedAmount: number;
      paidAmount: number;
      outstandingAmount: number;
      overdueAmount: number;
      paidTowardOpenCourses: number;
      ledgerCount: number;
      courses: StudentPaymentCourseRow[];
    }
  >();

  for (const ledger of ledgers) {
    const studentId = ledger.studentId || '';
    const key = studentId || `missing:${ledger.id}`;
    const current = grouped.get(key) || {
      studentId,
      billedAmount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      overdueAmount: 0,
      paidTowardOpenCourses: 0,
      ledgerCount: 0,
      courses: [],
    };
    const balance = deriveLedgerDisplayStatus(ledger as LedgerLike, todayStr);
    const coursePaymentStatus: StudentPaymentStatus =
      balance.netAmount === 0
        ? 'waived'
        : balance.outstanding === 0
          ? 'paid'
          : balance.paid > 0
            ? 'partial'
            : 'unpaid';
    const classInfo = ledger.classId ? classesById.get(ledger.classId) : undefined;
    current.billedAmount += balance.netAmount;
    current.paidAmount += balance.paid;
    current.outstandingAmount += balance.outstanding;
    current.overdueAmount += balance.isOverdue ? balance.outstanding : 0;
    current.paidTowardOpenCourses += balance.outstanding > 0 ? balance.paid : 0;
    current.ledgerCount += 1;
    current.courses.push({
      id: ledger.id,
      courseLabel: ledger.termLabel || '',
      termStart: ledger.termStart || '',
      termEnd: ledger.termEnd || '',
      classId: ledger.classId || '',
      className: classInfo?.className || '',
      teacherId: classInfo?.teacherId || '',
      teacherName: classInfo?.teacherName || '',
      paymentStatus: coursePaymentStatus,
      billedAmount: balance.netAmount,
      paidAmount: balance.paid,
      outstandingAmount: balance.outstanding,
      overdueAmount: balance.isOverdue ? balance.outstanding : 0,
    });
    grouped.set(key, current);
  }

  const rows = [...grouped.entries()].map(([key, totals]): StudentPaymentRow => {
    const student = totals.studentId ? studentsById.get(totals.studentId) : undefined;
    const paymentStatus: StudentPaymentStatus =
      totals.billedAmount === 0
        ? 'waived'
        : totals.outstandingAmount === 0
          ? 'paid'
          : totals.paidTowardOpenCourses > 0
            ? 'partial'
            : 'unpaid';

    totals.courses.sort(
      (a, b) =>
        b.termStart.localeCompare(a.termStart) ||
        a.className.localeCompare(b.className, 'vi') ||
        a.id.localeCompare(b.id)
    );

    return {
      id: totals.studentId || key,
      fullName: student?.name || '',
      studentCode: student?.studentId || '',
      dateOfBirth: student?.dob || '',
      phone: student?.contact || '',
      paymentStatus,
      billedAmount: totals.billedAmount,
      paidAmount: totals.paidAmount,
      outstandingAmount: totals.outstandingAmount,
      overdueAmount: totals.overdueAmount,
      ledgerCount: totals.ledgerCount,
      courses: totals.courses,
      studentRecordFound: Boolean(student),
    };
  });

  rows.sort(
    (a, b) =>
      b.outstandingAmount - a.outstandingAmount ||
      a.fullName.localeCompare(b.fullName, 'vi') ||
      a.id.localeCompare(b.id)
  );

  const summary: StudentPaymentSummary = {
    total: rows.length,
    paid: 0,
    partial: 0,
    unpaid: 0,
    waived: 0,
    withOutstanding: 0,
    overdue: 0,
  };
  for (const row of rows) {
    summary[row.paymentStatus] += 1;
    if (row.outstandingAmount > 0) summary.withOutstanding += 1;
    if (row.overdueAmount > 0) summary.overdue += 1;
  }

  return { summary, rows };
}
