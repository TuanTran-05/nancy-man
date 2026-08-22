import type { DocumentStore } from '@/server/db/documentStore.js';
import { finiteMoney } from '../../../../shared/money.js';
import {
  dateToApiDateInTimeZone,
  dateToApiMonthInTimeZone,
  isApiMonth,
} from '../../../../shared/dateTimeFormat.js';
import {
  FinanceRepository,
  type FinanceClassInfoRow,
  type FinanceLedgerRow,
  type FinanceStudentRow,
} from '../repositories/financeRepository.js';
import { aggregateFinanceReport } from './financeReportService.js';
import {
  buildCenterMonths,
  splitDiscounts,
  aggregateReceivablesByStatus,
  aggregateStudentPayments,
  ledgerOverlapsMonth,
  type CenterMonth,
  type DiscountBreakdown,
  type ReceivableStatusRow,
  type CenterReceiptRow,
  type CenterExpenseRow,
  type StudentPaymentReport,
} from '../../../../shared/centerFinanceReport.js';

export type CenterFinanceReport = {
  success: true;
  selectedMonth: string;
  months: CenterMonth[];
  current: CenterMonth;
  discountBreakdown: DiscountBreakdown;
  incomeByLevel: Array<{ level: string; label: { vi: string; en: string }; amount: number }>;
  expensesByCategory: Array<{
    category: string;
    label: { vi: string; en: string };
    amount: number;
  }>;
  receivablesByStatus: ReceivableStatusRow[];
  studentPayments: StudentPaymentReport;
  source: 'live';
};

const EMPTY_MONTH = (month: string): CenterMonth => ({
  month,
  grossBilled: 0,
  discountTotal: 0,
  netBilled: 0,
  collectedCohort: 0,
  outstanding: 0,
  cashIn: 0,
  cashOut: 0,
});

export function monthWindow(selectedMonth: string, count: number): string[] {
  const size = Math.max(1, Math.floor(count));
  const [year, month] = selectedMonth.split('-').map(Number);
  const out: string[] = [];
  for (let i = size - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

type AssembleInput = {
  selectedMonth: string;
  months: string[];
  ledgers: FinanceLedgerRow[];
  windowReceipts: CenterReceiptRow[];
  windowExpenses: CenterExpenseRow[];
  selectedMonthReceipts: CenterReceiptRow[];
  selectedMonthExpenses: CenterExpenseRow[];
  selectedMonthLedgers: FinanceLedgerRow[];
  students: FinanceStudentRow[];
  classes: FinanceClassInfoRow[];
  classLevelMap: Record<string, string>;
  todayStr: string;
};

export function assembleCenterReport(input: AssembleInput): CenterFinanceReport {
  const monthRows = buildCenterMonths(
    input.months,
    input.ledgers,
    input.windowReceipts,
    input.windowExpenses
  );
  const current =
    monthRows.find((m) => m.month === input.selectedMonth) ?? EMPTY_MONTH(input.selectedMonth);

  const categorized = aggregateFinanceReport(
    input.selectedMonthReceipts.map((r) => ({
      id: r.id,
      amountReceived: finiteMoney(r.amountReceived),
      receivedDate: r.receivedDate,
      classId: r.classId,
      walletDeposit: r.walletDeposit,
      flowVersion: r.flowVersion,
      classIds: r.classIds,
      allocations: r.allocations,
    })),
    input.selectedMonthExpenses.map((e) => ({
      id: e.id,
      amount: finiteMoney(e.amount),
      paidDate: e.paidDate,
      category: e.category,
    })),
    input.classLevelMap
  );
  const studentPayments = aggregateStudentPayments(
    input.selectedMonthLedgers,
    input.students,
    input.todayStr,
    input.classes
  );

  return {
    success: true,
    selectedMonth: input.selectedMonth,
    months: monthRows,
    current,
    discountBreakdown: splitDiscounts(input.selectedMonthReceipts),
    incomeByLevel: categorized.incomeByLevel,
    expensesByCategory: categorized.expensesByCategory,
    receivablesByStatus: aggregateReceivablesByStatus(input.selectedMonthLedgers, input.todayStr),
    studentPayments,
    source: 'live',
  };
}

export async function buildCenterFinanceReport(
  db: DocumentStore,
  { month, months }: { month: string; months: number }
): Promise<CenterFinanceReport> {
  const selectedMonth = isApiMonth(month) ? month : dateToApiMonthInTimeZone(new Date());
  const window = monthWindow(selectedMonth, months);
  const windowStart = `${window[0]}-01`;
  const windowEnd = lastDayOfMonth(window[window.length - 1]);

  const repo = new FinanceRepository(db);
  const [ledgers, windowReceipts, windowExpenses, classInfo] = await Promise.all([
    repo.listLedgersByCohortMonths(window),
    repo.listPostedReceipts(windowStart, windowEnd),
    repo.listPostedExpenses(windowStart, windowEnd),
    repo.getClassReportContext(),
  ]);

  const selectedReceipts = windowReceipts.filter(
    (receipt) => receipt.receivedDate?.slice(0, 7) === selectedMonth
  );
  const selectedExpenses = windowExpenses.filter(
    (expense) => expense.paidDate?.slice(0, 7) === selectedMonth
  );
  const selectedMonthLedgers = ledgers.filter((ledger) =>
    ledgerOverlapsMonth(ledger, selectedMonth)
  );
  const students = await repo.listStudentsByIds(
    selectedMonthLedgers.map((ledger) => ledger.studentId || '')
  );

  return assembleCenterReport({
    selectedMonth,
    months: window,
    ledgers,
    windowReceipts,
    windowExpenses,
    selectedMonthReceipts: selectedReceipts,
    selectedMonthExpenses: selectedExpenses,
    selectedMonthLedgers,
    students,
    classes: classInfo.classes,
    classLevelMap: classInfo.classLevelMap,
    todayStr: dateToApiDateInTimeZone(new Date()),
  });
}
