import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  FinanceRepository,
  type FinanceClassLevelMap,
  type FinanceExpenseRow,
  type FinanceMonthlyAggregateDoc,
  type FinanceReceiptRow,
} from '../repositories/financeRepository.js';

const LEVEL_LABELS: Record<string, { vi: string; en: string }> = {
  primary: { vi: 'Tiểu học', en: 'Primary' },
  lower_secondary: { vi: 'THCS', en: 'Lower Secondary' },
  upper_secondary: { vi: 'THPT', en: 'Upper Secondary' },
  wallet_deposit: { vi: 'Tiền ví chưa cấn trừ', en: 'Unallocated wallet funds' },
  other: { vi: 'Khác', en: 'Other' },
};

const CATEGORY_LABELS: Record<string, { vi: string; en: string }> = {
  salary: { vi: 'Lương', en: 'Salary' },
  rent: { vi: 'Thuê mặt bằng', en: 'Rent' },
  utilities: { vi: 'Điện nước', en: 'Utilities' },
  marketing: { vi: 'Marketing', en: 'Marketing' },
  supplies: { vi: 'Vật tư', en: 'Supplies' },
  other: { vi: 'Khác', en: 'Other' },
};

const LEVEL_ORDER = ['primary', 'lower_secondary', 'upper_secondary', 'wallet_deposit', 'other'];
/** Wallet top-ups are cash in, but not yet revenue of any course. */
const WALLET_DEPOSIT_LEVEL = 'wallet_deposit';
const CATEGORY_ORDER = ['salary', 'rent', 'utilities', 'marketing', 'supplies', 'other'];
const AGGREGATE_SCHEMA_VERSION = 2;

export type DailyFinanceBreakdown = {
  date: string;
  income: number;
  expenses: number;
  balance: number;
};

export type FinanceReport = {
  success: true;
  totalIncome: number;
  totalExpenses: number;
  totalScholarships: number;
  balance: number;
  dailyBreakdown?: DailyFinanceBreakdown[];
  monthlyBreakdown: Array<{ month: string; income: number; expenses: number; balance: number }>;
  incomeByLevel: Array<{ level: string; label: { vi: string; en: string }; amount: number }>;
  expensesByCategory: Array<{
    category: string;
    label: { vi: string; en: string };
    amount: number;
  }>;
  source: 'live' | 'aggregate';
};

type ReportInput = {
  startDate?: string;
  endDate?: string;
  forceLive?: boolean;
  includeDaily?: boolean;
};

type AggregateOptions = { includeDaily?: boolean };

function toAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  // PostgreSQL's `numeric` type is decoded as a string by node-postgres. The
  // document-store compatibility snapshot therefore contains values such as
  // "1500000" after a relational export/import even though Firestore returned
  // the same field as a number. Normalize that representation at the report
  // boundary so migrated money is not silently treated as zero.
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function receiptScholarshipAmount(receipt: FinanceReceiptRow): number {
  if (receipt.flowVersion === 'wallet-manual-v2') {
    return (receipt.allocations || []).reduce(
      (sum, allocation) => sum + toAmount(allocation.discountAmount),
      0
    );
  }
  return toAmount(receipt.discountAmount);
}

function monthFromDate(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 7) : '';
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return date.toISOString().slice(0, 10);
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return date.toISOString().slice(0, 7);
}

function getClosedMonthRange(startDate?: string, endDate?: string): string[] {
  if (!startDate || !endDate) return [];
  if (!/^\d{4}-\d{2}-01$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];

  const startMonth = startDate.slice(0, 7);
  const endMonth = endDate.slice(0, 7);
  if (endDate !== lastDayOfMonth(endMonth)) return [];

  const currentMonth = new Date().toISOString().slice(0, 7);
  if (endMonth >= currentMonth) return [];
  if (startMonth > endMonth) return [];

  const months: string[] = [];
  for (let month = startMonth; month <= endMonth; month = nextMonth(month)) {
    months.push(month);
  }
  return months;
}

function getOrderedKeys(values: Record<string, number>, order: string[]): string[] {
  const orderedKeys = [...order, ...Object.keys(values).filter((key) => !order.includes(key))];
  return orderedKeys.filter((key, index) => values[key] && orderedKeys.indexOf(key) === index);
}

function buildLevelBreakdown(values: Record<string, number>) {
  return getOrderedKeys(values, LEVEL_ORDER).map((level) => ({
    level,
    label: LEVEL_LABELS[level] || LEVEL_LABELS.other,
    amount: values[level],
  }));
}

function buildCategoryBreakdown(values: Record<string, number>) {
  return getOrderedKeys(values, CATEGORY_ORDER).map((category) => ({
    category,
    label: CATEGORY_LABELS[category] || CATEGORY_LABELS.other,
    amount: values[category],
  }));
}

export function aggregateFinanceReport(
  receipts: FinanceReceiptRow[],
  expenses: FinanceExpenseRow[],
  classLevelMap: FinanceClassLevelMap,
  options: AggregateOptions = {}
): Omit<FinanceReport, 'success' | 'source'> {
  const totalIncome = receipts.reduce((sum, receipt) => sum + toAmount(receipt.amountReceived), 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + toAmount(expense.amount), 0);
  const totalScholarships = receipts.reduce(
    (sum, receipt) => sum + receiptScholarshipAmount(receipt),
    0
  );

  const dailyMap: Record<string, { income: number; expenses: number }> = {};
  const addDailyAmount = (rawDate: unknown, field: 'income' | 'expenses', amount: number) => {
    if (!options.includeDaily || typeof rawDate !== 'string') return;
    const date = rawDate.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (!dailyMap[date]) dailyMap[date] = { income: 0, expenses: 0 };
    dailyMap[date][field] += amount;
  };

  const monthlyMap: Record<string, { income: number; expenses: number }> = {};
  for (const receipt of receipts) {
    const amount = toAmount(receipt.amountReceived);
    addDailyAmount(receipt.receivedDate, 'income', amount);
    const month = monthFromDate(receipt.receivedDate);
    if (!month) continue;
    if (!monthlyMap[month]) monthlyMap[month] = { income: 0, expenses: 0 };
    monthlyMap[month].income += amount;
  }
  for (const expense of expenses) {
    const amount = toAmount(expense.amount);
    addDailyAmount(expense.paidDate, 'expenses', amount);
    const month = monthFromDate(expense.paidDate);
    if (!month) continue;
    if (!monthlyMap[month]) monthlyMap[month] = { income: 0, expenses: 0 };
    monthlyMap[month].expenses += amount;
  }

  const dailyBreakdown = Object.entries(dailyMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, data]) => ({ date, ...data, balance: data.income - data.expenses }));

  const monthlyBreakdown = Object.entries(monthlyMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, data]) => ({ month, ...data, balance: data.income - data.expenses }));

  const incomeByLevelMap: Record<string, number> = {};
  const addIncome = (level: string, amount: number) => {
    if (amount <= 0) return;
    incomeByLevelMap[level] = (incomeByLevelMap[level] || 0) + amount;
  };
  for (const receipt of receipts) {
    if (receipt.walletDeposit === true) {
      addIncome(WALLET_DEPOSIT_LEVEL, toAmount(receipt.amountReceived));
      continue;
    }
    if (receipt.flowVersion !== 'wallet-manual-v2') {
      addIncome(classLevelMap[receipt.classId || ''] || 'other', toAmount(receipt.amountReceived));
      continue;
    }

    let unclassifiedCash = toAmount(receipt.amountReceived);
    for (const allocation of receipt.allocations || []) {
      if (unclassifiedCash <= 0) break;
      const classifiedAmount = Math.min(unclassifiedCash, toAmount(allocation.amount));
      addIncome(classLevelMap[allocation.classId] || 'other', classifiedAmount);
      unclassifiedCash -= classifiedAmount;
    }
    addIncome(WALLET_DEPOSIT_LEVEL, unclassifiedCash);
  }

  const expensesByCategoryMap: Record<string, number> = {};
  for (const expense of expenses) {
    const category = expense.category || 'other';
    expensesByCategoryMap[category] =
      (expensesByCategoryMap[category] || 0) + toAmount(expense.amount);
  }

  return {
    totalIncome,
    totalExpenses,
    totalScholarships,
    balance: totalIncome - totalExpenses,
    ...(options.includeDaily ? { dailyBreakdown } : {}),
    monthlyBreakdown,
    incomeByLevel: buildLevelBreakdown(incomeByLevelMap),
    expensesByCategory: buildCategoryBreakdown(expensesByCategoryMap),
  };
}

function combineAggregates(
  aggregates: FinanceMonthlyAggregateDoc[]
): Omit<FinanceReport, 'success' | 'source'> {
  const monthlyMap: Record<string, { income: number; expenses: number }> = {};
  const incomeByLevelMap: Record<string, number> = {};
  const expensesByCategoryMap: Record<string, number> = {};

  let totalIncome = 0;
  let totalExpenses = 0;
  let totalScholarships = 0;

  for (const aggregate of aggregates) {
    totalIncome += toAmount(aggregate.totalIncome);
    totalExpenses += toAmount(aggregate.totalExpenses);
    totalScholarships += toAmount(aggregate.totalScholarships);
    monthlyMap[aggregate.month] = {
      income: toAmount(aggregate.totalIncome),
      expenses: toAmount(aggregate.totalExpenses),
    };

    for (const item of aggregate.incomeByLevel || []) {
      incomeByLevelMap[item.level] = (incomeByLevelMap[item.level] || 0) + toAmount(item.amount);
    }
    for (const item of aggregate.expensesByCategory || []) {
      expensesByCategoryMap[item.category] =
        (expensesByCategoryMap[item.category] || 0) + toAmount(item.amount);
    }
  }

  const monthlyBreakdown = Object.entries(monthlyMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, data]) => ({ month, ...data, balance: data.income - data.expenses }));

  return {
    totalIncome,
    totalExpenses,
    totalScholarships,
    balance: totalIncome - totalExpenses,
    monthlyBreakdown,
    incomeByLevel: buildLevelBreakdown(incomeByLevelMap),
    expensesByCategory: buildCategoryBreakdown(expensesByCategoryMap),
  };
}

export async function buildFinanceReport(
  db: DocumentStore,
  { startDate = '', endDate = '', forceLive = false, includeDaily = false }: ReportInput
): Promise<FinanceReport> {
  const repository = new FinanceRepository(db);
  const closedMonths = forceLive || includeDaily ? [] : getClosedMonthRange(startDate, endDate);

  if (closedMonths.length > 0) {
    const aggregates = await repository.getMonthlyAggregates(closedMonths);
    if (
      aggregates.length === closedMonths.length &&
      aggregates.every((aggregate) => aggregate.schemaVersion === AGGREGATE_SCHEMA_VERSION)
    ) {
      return { success: true, source: 'aggregate', ...combineAggregates(aggregates) };
    }
  }

  const [receipts, expenses, { classLevelMap }] = await Promise.all([
    repository.listPostedReceipts(startDate, endDate),
    repository.listPostedExpenses(startDate, endDate),
    repository.getClassLevelMap(),
  ]);

  return {
    success: true,
    source: 'live',
    ...aggregateFinanceReport(receipts, expenses, classLevelMap, { includeDaily }),
  };
}

export async function aggregateFinanceMonth(
  db: DocumentStore,
  month: string
): Promise<FinanceMonthlyAggregateDoc> {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const err = new Error('month must use YYYY-MM format');
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  const repository = new FinanceRepository(db);
  const startDate = `${month}-01`;
  const endDate = lastDayOfMonth(month);
  const [receipts, expenses, classInfo] = await Promise.all([
    repository.listPostedReceipts(startDate, endDate),
    repository.listPostedExpenses(startDate, endDate),
    repository.getClassLevelMap(),
  ]);
  const report = aggregateFinanceReport(receipts, expenses, classInfo.classLevelMap);

  const aggregate: FinanceMonthlyAggregateDoc = {
    month,
    totalIncome: report.totalIncome,
    totalExpenses: report.totalExpenses,
    totalScholarships: report.totalScholarships,
    incomeByLevel: report.incomeByLevel.map(({ level, amount }) => ({ level, amount })),
    expensesByCategory: report.expensesByCategory.map(({ category, amount }) => ({
      category,
      amount,
    })),
    sourceCounts: {
      receipts: receipts.length,
      expenses: expenses.length,
      classes: classInfo.classCount,
    },
    range: { startDate, endDate },
    generatedAt: new Date().toISOString(),
    schemaVersion: AGGREGATE_SCHEMA_VERSION,
  };

  await repository.saveMonthlyAggregate(aggregate);
  return aggregate;
}
