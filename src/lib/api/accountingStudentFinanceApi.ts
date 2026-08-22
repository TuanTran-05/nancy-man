import { readChannel } from './readApi';
import type {
  AccountingStudentFinancePage,
  AccountingStudentFinanceQuery,
  AccountingStudentSummary,
} from '../../../shared/accountingStudentFinance';

/** Server cap for this channel, so each round trip carries as much as it may. */
export const ACCOUNTING_STUDENT_FINANCE_PAGE_SIZE = 100;

/** Matches the student directory's index cap; beyond it the list is truncated. */
export const ACCOUNTING_STUDENT_FINANCE_ROW_CAP = 3000;

export type AccountingStudentFinanceList = {
  rows: AccountingStudentSummary[];
  dataIncomplete: boolean;
  truncated: boolean;
};

export async function fetchAccountingStudentFinance(
  query: AccountingStudentFinanceQuery = {}
): Promise<AccountingStudentFinancePage> {
  return readChannel<AccountingStudentFinancePage>('accounting-student-finance', query);
}

/**
 * Loads the whole debt list for the given filters so the search box can filter it
 * in memory instead of asking the server on every keystroke. Search is deliberately
 * not a parameter: filtering happens on the client.
 */
export async function fetchAllAccountingStudentFinance(
  query: Omit<AccountingStudentFinanceQuery, 'cursor' | 'limit' | 'search'> = {}
): Promise<AccountingStudentFinanceList> {
  const rows: AccountingStudentSummary[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let dataIncomplete = false;

  while (rows.length < ACCOUNTING_STUDENT_FINANCE_ROW_CAP) {
    const data = await fetchAccountingStudentFinance({
      ...query,
      limit: ACCOUNTING_STUDENT_FINANCE_PAGE_SIZE,
      cursor,
    });
    if (data.dataIncomplete) dataIncomplete = true;

    for (const row of data.rows || []) {
      if (seenIds.has(row.studentId)) {
        throw new Error('Accounting student finance pagination returned a duplicate student');
      }
      seenIds.add(row.studentId);
      rows.push(row);
    }

    if (!data.page?.hasMore) return { rows, dataIncomplete, truncated: false };

    const nextCursor = String(data.page.nextCursor || '').trim();
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error('Accounting student finance pagination cursor did not advance');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    rows: rows.slice(0, ACCOUNTING_STUDENT_FINANCE_ROW_CAP),
    dataIncomplete,
    truncated: true,
  };
}
