import { finiteMoney } from './money.js';
import { calculateLedgerBalance, type LedgerLike } from './studentFinanceReport.js';

export type FinanceDetailType = 'income' | 'expense';
export type FinanceDetailCursor = { date: string; id: string };

export type FinanceReportPeriod = {
  startDate: string;
  endDate: string;
};

export type FinanceDetailsScope = { month: string } | FinanceReportPeriod;

export type DetailStudentSource = {
  id: string;
  name?: string;
  studentId?: string;
  contact?: string;
  walletBalance?: unknown;
};

export type DetailClassSource = { id: string; className?: string };

export type DetailLedgerSource = LedgerLike & {
  id: string;
  classId?: string;
};

export type DetailReceiptSource = {
  id: string;
  receiptNo?: string;
  invoiceNo?: string;
  receivedDate?: string;
  studentId?: string;
  classId?: string;
  ledgerId?: string;
  paymentMethod?: string;
  amountReceived?: unknown;
  walletDeposit?: boolean;
  flowVersion?: string;
  note?: string;
  allocations?: Array<{
    ledgerId?: string;
    classId?: string;
    amount?: unknown;
  }>;
};

export type DetailExpenseSource = {
  id: string;
  expenseNo?: string;
  paidDate?: string;
  category?: string;
  amount?: unknown;
  purpose?: string;
  reason?: string;
  note?: string;
  payee?: string;
  createdBy?: string;
  createdByName?: string;
  type?: string;
  studentId?: string;
  classId?: string;
};

export type IncomeDetailMapperInput = {
  receipts: readonly DetailReceiptSource[];
  students: readonly DetailStudentSource[];
  ledgers: readonly DetailLedgerSource[];
  classes: readonly DetailClassSource[];
};

export type ExpenseDetailMapperInput = {
  expenses: readonly DetailExpenseSource[];
  students: readonly DetailStudentSource[];
  classes?: readonly DetailClassSource[];
};

export type IncomeAllocationDetail = {
  ledgerId: string;
  classId: string;
  className: string;
  allocatedAmount: number;
  amountDue: number;
  remainingAmount: number;
  dataAvailable: boolean;
};

export type IncomeTransactionDetail = {
  id: string;
  receiptNo: string;
  invoiceNo: string;
  receivedDate: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  phone: string;
  paymentMethod: string;
  amountReceived: number;
  amountDue: number;
  remainingAmount: number;
  walletBalance: number;
  walletDeposit: boolean;
  note: string;
  allocations: IncomeAllocationDetail[];
};

export type ExpenseTransactionDetail = {
  id: string;
  expenseNo: string;
  paidDate: string;
  category: string;
  amount: number;
  purpose: string;
  reason: string;
  note: string;
  payee: string;
  createdBy: string;
  createdByName: string;
  type: 'activity' | 'wallet_refund';
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  walletBalance: number | null;
};

type CenterReportDetailsBase = {
  success: true;
  month?: string;
  period: FinanceReportPeriod;
  totalCount: number;
  totalAmount: number;
  nextCursor: string | null;
};

export type CenterReportIncomeDetailsResponse = CenterReportDetailsBase & {
  type: 'income';
  rows: IncomeTransactionDetail[];
};

export type CenterReportExpenseDetailsResponse = CenterReportDetailsBase & {
  type: 'expense';
  rows: ExpenseTransactionDetail[];
};

export type CenterReportDetailsResponse =
  | CenterReportIncomeDetailsResponse
  | CenterReportExpenseDetailsResponse;

type SourceAllocation = {
  ledgerId?: string;
  classId?: string;
  amount?: unknown;
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function receiptAllocations(receipt: DetailReceiptSource): SourceAllocation[] {
  const explicitAllocations = Array.isArray(receipt.allocations) ? receipt.allocations : [];
  if (explicitAllocations.length > 0) {
    return explicitAllocations;
  }

  if (receipt.ledgerId || receipt.classId) {
    return [
      {
        ledgerId: receipt.ledgerId,
        classId: receipt.classId,
        amount: receipt.amountReceived,
      },
    ];
  }

  return [];
}

export function buildIncomeTransactionDetails(
  input: IncomeDetailMapperInput,
): IncomeTransactionDetail[] {
  const studentById = mapById(input.students);
  const ledgerById = mapById(input.ledgers);
  const classById = mapById(input.classes);

  return input.receipts.map((receipt) => {
    const student = receipt.studentId ? studentById.get(receipt.studentId) : undefined;
    const sourceAllocations = receiptAllocations(receipt);
    const walletDeposit =
      receipt.walletDeposit === true ||
      (receipt.flowVersion === 'wallet-manual-v2' && sourceAllocations.length === 0);
    const countedLedgers = new Set<string>();
    let amountDue = 0;
    let remainingAmount = 0;

    const allocations = sourceAllocations.map((allocation) => {
      const ledgerId = stringValue(allocation.ledgerId);
      const ledger = ledgerId ? ledgerById.get(ledgerId) : undefined;
      const classId = String(allocation.classId || ledger?.classId || receipt.classId || '');
      const balance = ledger ? calculateLedgerBalance(ledger) : null;

      if (ledgerId && balance && !countedLedgers.has(ledgerId)) {
        amountDue += balance.netAmount;
        remainingAmount += balance.outstanding;
        countedLedgers.add(ledgerId);
      }

      return {
        ledgerId,
        classId,
        className: classById.get(classId)?.className || '',
        allocatedAmount: finiteMoney(allocation.amount),
        amountDue: balance?.netAmount ?? 0,
        remainingAmount: balance?.outstanding ?? 0,
        dataAvailable: Boolean(ledger),
      };
    });

    return {
      id: receipt.id,
      receiptNo: stringValue(receipt.receiptNo),
      invoiceNo: stringValue(receipt.invoiceNo),
      receivedDate: stringValue(receipt.receivedDate),
      studentId: stringValue(receipt.studentId),
      studentName: stringValue(student?.name),
      studentCode: stringValue(student?.studentId),
      phone: stringValue(student?.contact),
      paymentMethod: stringValue(receipt.paymentMethod),
      amountReceived: finiteMoney(receipt.amountReceived),
      amountDue,
      remainingAmount,
      walletBalance: finiteMoney(student?.walletBalance),
      walletDeposit,
      note: stringValue(receipt.note),
      allocations,
    };
  });
}

export function buildExpenseTransactionDetails(
  input: ExpenseDetailMapperInput,
): ExpenseTransactionDetail[] {
  const studentById = mapById(input.students);
  const classById = mapById(input.classes ?? []);

  return input.expenses.map((expense) => {
    const student = expense.studentId ? studentById.get(expense.studentId) : undefined;
    const classId = stringValue(expense.classId);

    return {
      id: expense.id,
      expenseNo: stringValue(expense.expenseNo),
      paidDate: stringValue(expense.paidDate),
      category: stringValue(expense.category),
      amount: finiteMoney(expense.amount),
      purpose: stringValue(expense.purpose),
      reason: stringValue(expense.reason),
      note: stringValue(expense.note),
      payee: stringValue(expense.payee),
      createdBy: stringValue(expense.createdBy),
      createdByName: stringValue(expense.createdByName),
      type: expense.type === 'wallet_refund' ? 'wallet_refund' : 'activity',
      studentId: stringValue(expense.studentId),
      studentName: stringValue(student?.name),
      classId,
      className: stringValue(classById.get(classId)?.className),
      walletBalance: student ? finiteMoney(student.walletBalance) : null,
    };
  });
}
