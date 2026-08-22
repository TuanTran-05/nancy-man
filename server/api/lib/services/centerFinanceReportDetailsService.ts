import type { DocumentStore } from '@/server/db/documentStore.js';
import type {
  CenterReportDetailsResponse,
  FinanceDetailCursor,
  FinanceDetailType,
  FinanceDetailsScope,
  FinanceReportPeriod,
} from '../../../../shared/centerFinanceReportDetails.js';
import {
  buildExpenseTransactionDetails,
  buildIncomeTransactionDetails,
} from '../../../../shared/centerFinanceReportDetails.js';
import { FinanceRepository } from '../repositories/financeRepository.js';

export type CenterFinanceReportDetailsInput = FinanceDetailsScope & {
  type: FinanceDetailType;
  pageSize: number;
  cursor: FinanceDetailCursor | null;
};

export function centerReportMonthPeriod(month: string): FinanceReportPeriod {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    startDate: `${month}-01`,
    endDate: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  };
}

export function resolveCenterReportScope(scope: FinanceDetailsScope): {
  month?: string;
  period: FinanceReportPeriod;
} {
  if ('month' in scope) {
    return {
      month: scope.month,
      period: centerReportMonthPeriod(scope.month),
    };
  }
  return { period: scope };
}

export type DetailCursorEnvelope = FinanceDetailCursor & {
  startDate: string;
  endDate: string;
  type: FinanceDetailType;
};

export function encodeCenterReportDetailsCursor(
  cursor: FinanceDetailCursor,
  period: FinanceReportPeriod,
  type: FinanceDetailType
): string {
  const envelope: DetailCursorEnvelope = {
    ...cursor,
    startDate: period.startDate,
    endDate: period.endDate,
    type,
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

function invalidCursorError(): Error & { errorCode: string; statusCode: number } {
  return Object.assign(new Error('invalid_cursor'), {
    errorCode: 'invalid_cursor',
    statusCode: 400,
  });
}

export function decodeCenterReportDetailsCursor(
  value: string,
  scope: FinanceDetailsScope,
  type: FinanceDetailType
): FinanceDetailCursor {
  const period = resolveCenterReportScope(scope).period;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<
      DetailCursorEnvelope
    >;
    if (typeof parsed.id !== 'string' || !parsed.id) throw invalidCursorError();
    if (typeof parsed.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(parsed.date)) {
      throw invalidCursorError();
    }
    if (
      parsed.startDate !== period.startDate ||
      parsed.endDate !== period.endDate ||
      parsed.type !== type ||
      parsed.date < period.startDate ||
      parsed.date > period.endDate
    ) {
      throw invalidCursorError();
    }
    return { date: parsed.date, id: parsed.id };
  } catch (error) {
    const maybeError = error as { errorCode?: string };
    if (maybeError.errorCode === 'invalid_cursor') throw error;
    throw invalidCursorError();
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value || '')).filter(Boolean))];
}

export async function buildCenterFinanceReportDetails(
  db: DocumentStore,
  input: CenterFinanceReportDetailsInput
): Promise<CenterReportDetailsResponse> {
  const repo = new FinanceRepository(db);
  const { month, period } = resolveCenterReportScope(input);

  if (input.type === 'income') {
    const page = await repo.listPostedReceiptDetailsPage({
      startDate: period.startDate,
      endDate: period.endDate,
      pageSize: input.pageSize,
      cursor: input.cursor,
    });
    const studentIds = uniqueStrings(page.rows.map((row) => row.studentId));
    const ledgerIds = uniqueStrings(
      page.rows.flatMap((row) => [
        row.ledgerId,
        ...(row.allocations || []).map((allocation) => allocation.ledgerId),
      ])
    );
    const [students, ledgers] = await Promise.all([
      repo.listStudentsByIds(studentIds),
      repo.listLedgersByIds(ledgerIds),
    ]);
    const classIds = uniqueStrings([
      ...page.rows.flatMap((row) => [
        row.classId,
        ...(row.allocations || []).map((allocation) => allocation.classId),
      ]),
      ...ledgers.map((ledger) => ledger.classId),
    ]);
    const classes = await repo.listClassesByIds(classIds);
    return {
      success: true,
      ...(month ? { month } : {}),
      type: 'income',
      period,
      totalCount: page.totalCount,
      totalAmount: page.totalAmount,
      rows: buildIncomeTransactionDetails({ receipts: page.rows, students, ledgers, classes }),
      nextCursor: page.nextCursor
        ? encodeCenterReportDetailsCursor(page.nextCursor, period, input.type)
        : null,
    };
  }

  const page = await repo.listPostedExpenseDetailsPage({
    startDate: period.startDate,
    endDate: period.endDate,
    pageSize: input.pageSize,
    cursor: input.cursor,
  });
  const studentIds = uniqueStrings(page.rows.map((row) => row.studentId));
  const classIds = uniqueStrings(page.rows.map((row) => row.classId));
  const [students, classes] = await Promise.all([
    repo.listStudentsByIds(studentIds),
    repo.listClassesByIds(classIds),
  ]);
  return {
    success: true,
    ...(month ? { month } : {}),
    type: 'expense',
    period,
    totalCount: page.totalCount,
    totalAmount: page.totalAmount,
    rows: buildExpenseTransactionDetails({ expenses: page.rows, students, classes }),
    nextCursor: page.nextCursor
      ? encodeCenterReportDetailsCursor(page.nextCursor, period, input.type)
      : null,
  };
}
