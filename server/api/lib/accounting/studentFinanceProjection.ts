import {
  buildAccountingSearchTokens,
  calculatePriorityRank,
  deriveAccountingPaymentStatus,
  normalizeAccountingSearch,
  type AccountingPaymentStatus,
  type AccountingStudentSummary,
} from '../../../../shared/accountingStudentFinance.js';
import type { StudentCourseEnrollment } from '../../../../shared/studentCourseEnrollment.js';
import { ledgerAmount, ledgerDiscountTotal, ledgerPaidTotal, ledgerRemaining } from '../../../../shared/money.js';

export type FinanceProjectionLedger = {
  id: string;
  classId?: string | null;
  termStart?: string | null;
  amount?: unknown;
  discountTotal?: unknown;
  paidTotal?: unknown;
  dueDate?: string | null;
  waived?: boolean;
  tuitionReminderCount?: unknown;
  tuitionReminderLastSentAt?: unknown;
};

export function buildAccountingStudentSummary(input: {
  student: Record<string, unknown> & { id: string };
  enrollments: StudentCourseEnrollment[];
  ledgers: FinanceProjectionLedger[];
  today: string;
  sourceVersion?: number;
  rebuiltAt?: string;
}): AccountingStudentSummary {
  const name = String(input.student.name || input.student.fullName || input.student.displayName || '').trim();
  const normalized = normalizeAccountingSearch(name);
  const open = input.enrollments.filter((row) => ['trial', 'active', 'on_leave'].includes(row.status));
  const current = open[0] || null;
  const currentClassId = current?.classId || null;
  const ledgerByTuple = new Map<string, FinanceProjectionLedger>();
  const ledgerByClass = new Map<string, FinanceProjectionLedger>();
  for (const ledger of input.ledgers) {
    if (ledger.classId) {
      ledgerByTuple.set(`${ledger.classId}|${ledger.termStart || ''}`, ledger);
      ledgerByClass.set(ledger.classId, ledger);
    }
  }
  let totalPaid = 0;
  let totalOutstanding = 0;
  let overdueCourseCount = 0;
  let priorityRank = 3;
  let tuitionReminderCount = 0;
  let lastTuitionReminderAt: string | null = null;
  let currentPayment: AccountingPaymentStatus = current ? 'missing_ledger' : 'paid';
  const countedLedgerIds = new Set<string>();
  const ledgerStatus = (ledger: FinanceProjectionLedger): AccountingPaymentStatus =>
    deriveAccountingPaymentStatus({
      ledgerExists: true,
      netAmount: Math.max(0, ledgerAmount(ledger) - ledgerDiscountTotal(ledger)),
      paid: ledgerPaidTotal(ledger),
      dueDate: ledger.dueDate,
      today: input.today,
      waived: ledger.waived,
    });
  const countLedger = (ledger: FinanceProjectionLedger, status: AccountingPaymentStatus) => {
    if (countedLedgerIds.has(ledger.id)) return;
    countedLedgerIds.add(ledger.id);
    if (!ledger.waived) {
      totalPaid += Math.min(ledgerPaidTotal(ledger), Math.max(0, ledgerAmount(ledger) - ledgerDiscountTotal(ledger)));
      totalOutstanding += ledgerRemaining(ledger);
    }
    if (status === 'overdue') overdueCourseCount += 1;
  };
  for (const enrollment of input.enrollments) {
    const ledger = ledgerByTuple.get(`${enrollment.classId}|${enrollment.termStart}`) || ledgerByClass.get(enrollment.classId);
    const net = Math.max(0, ledgerAmount(ledger || {}) - ledgerDiscountTotal(ledger || {}));
    const paid = ledgerPaidTotal(ledger || {});
    const status = deriveAccountingPaymentStatus({
      ledgerExists: Boolean(ledger), netAmount: net, paid, dueDate: ledger?.dueDate, today: input.today, waived: ledger?.waived,
    });
    if (ledger) countLedger(ledger, status);
    if (status !== 'missing_ledger' || current?.id === enrollment.id) {
      priorityRank = Math.min(priorityRank, calculatePriorityRank(status));
    }
    if (current?.id === enrollment.id) currentPayment = status;
  }
  /**
   * A ledger no enrollment row points at still holds real money — a course that
   * ended, a class the enrollment backfill never reached. Leaving it out of the
   * totals is what let the list show "Đã đóng · 0 ₫" for students the receipt
   * dialog, which reads ledgers directly, still billed.
   */
  for (const ledger of input.ledgers) {
    if (countedLedgerIds.has(ledger.id)) continue;
    const status = ledgerStatus(ledger);
    countLedger(ledger, status);
    priorityRank = Math.min(priorityRank, calculatePriorityRank(status));
  }
  /**
   * The badge sits beside the outstanding column, so a settled badge has to mean
   * the student owes nothing anywhere — not merely that the current course is
   * clear. Whenever money is still due, fall back to the worst status among the
   * ledgers carrying it: an open course keeps its own status when that status
   * already reports the debt, and a paid-up current course cannot hide an older
   * unpaid one.
   */
  if (totalOutstanding > 0) {
    for (const ledger of input.ledgers) {
      if (ledgerRemaining(ledger) <= 0) continue;
      const status = ledgerStatus(ledger);
      if (calculatePriorityRank(status) < calculatePriorityRank(currentPayment)) currentPayment = status;
    }
  }
  for (const ledger of input.ledgers) {
    tuitionReminderCount += Math.max(0, Number(ledger.tuitionReminderCount || 0));
    if (typeof ledger.tuitionReminderLastSentAt === 'string' && (!lastTuitionReminderAt || ledger.tuitionReminderLastSentAt > lastTuitionReminderAt)) lastTuitionReminderAt = ledger.tuitionReminderLastSentAt;
  }
  return {
    studentId: input.student.id,
    studentName: name,
    studentNameNormalized: normalized,
    studentCode: String(input.student.studentId || input.student.code || ''),
    searchTokens: buildAccountingSearchTokens(name, String(input.student.studentId || input.student.code || '')),
    studentLifecycle: String(input.student.studentLifecycle || 'enrolled'),
    currentClassId,
    currentEnrollmentId: current?.id || null,
    currentEnrollmentStatus: current?.status || null,
    currentCoursePaymentStatus: currentPayment,
    classCount: new Set(input.enrollments.map((row) => row.classId)).size,
    courseCount: input.enrollments.length,
    totalPaid,
    totalOutstanding,
    overdueCourseCount,
    priorityRank,
    tuitionReminderCount,
    lastTuitionReminderAt,
    enrollmentClassIds: [...new Set(input.enrollments.map((row) => row.classId).filter(Boolean))],
    enrollmentStatuses: [...new Set(input.enrollments.map((row) => row.status))],
    sourceVersion: input.sourceVersion || 2,
    rebuiltAt: input.rebuiltAt || new Date().toISOString(),
  };
}
