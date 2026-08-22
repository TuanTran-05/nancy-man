import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingStudentFinancePage } from '../../../shared/accountingStudentFinance';
import { readChannel } from './readApi';
import {
  ACCOUNTING_STUDENT_FINANCE_PAGE_SIZE,
  ACCOUNTING_STUDENT_FINANCE_ROW_CAP,
  fetchAllAccountingStudentFinance,
} from './accountingStudentFinanceApi';

vi.mock('./readApi', () => ({ readChannel: vi.fn() }));

function page(
  ids: string[],
  nextCursor: string | null,
  extra: Partial<AccountingStudentFinancePage> = {}
): AccountingStudentFinancePage {
  return {
    rows: ids.map((id) => ({ studentId: id })) as AccountingStudentFinancePage['rows'],
    page: { nextCursor, hasMore: Boolean(nextCursor) },
    dataIncomplete: false,
    generatedAt: '2026-08-04T00:00:00.000Z',
    ...extra,
  };
}

const ids = (result: { rows: Array<{ studentId: string }> }) =>
  result.rows.map((row) => row.studentId);

describe('fetchAllAccountingStudentFinance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows the cursor until the collection is exhausted', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(page(['a', 'b'], 'cursor-1'))
      .mockResolvedValueOnce(page(['c', 'd'], 'cursor-2'))
      .mockResolvedValueOnce(page(['e'], null));

    const result = await fetchAllAccountingStudentFinance();

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.truncated).toBe(false);
    expect(readChannel).toHaveBeenCalledTimes(3);
  });

  it('passes the dropdown filters through and never sends a search term', async () => {
    vi.mocked(readChannel).mockResolvedValue(page(['a'], null));

    await fetchAllAccountingStudentFinance({
      classId: 'class-1',
      lifecycleScope: 'all',
      paymentStatus: 'overdue',
    });

    expect(readChannel).toHaveBeenCalledWith('accounting-student-finance', {
      classId: 'class-1',
      lifecycleScope: 'all',
      paymentStatus: 'overdue',
      limit: ACCOUNTING_STUDENT_FINANCE_PAGE_SIZE,
      cursor: undefined,
    });
  });

  it('reports the list as incomplete when any page was still syncing', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(page(['a'], 'cursor-1', { dataIncomplete: true }))
      .mockResolvedValueOnce(page(['b'], null));

    expect((await fetchAllAccountingStudentFinance()).dataIncomplete).toBe(true);
  });

  it('stops at the row cap and reports the list as truncated', async () => {
    const fullPage = Array.from(
      { length: ACCOUNTING_STUDENT_FINANCE_PAGE_SIZE },
      (_, index) => index
    );
    let served = 0;
    vi.mocked(readChannel).mockImplementation(async () => {
      const start = served;
      served += ACCOUNTING_STUDENT_FINANCE_PAGE_SIZE;
      return page(
        fullPage.map((offset) => `s${start + offset}`),
        `cursor-${served}`
      );
    });

    const result = await fetchAllAccountingStudentFinance();

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(ACCOUNTING_STUDENT_FINANCE_ROW_CAP);
  });

  it('fails loudly when the server repeats a cursor instead of advancing', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(page(['a'], 'cursor-1'))
      .mockResolvedValueOnce(page(['b'], 'cursor-1'));

    await expect(fetchAllAccountingStudentFinance()).rejects.toThrow(/cursor/i);
  });

  it('fails loudly when a page repeats a student already collected', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(page(['a'], 'cursor-1'))
      .mockResolvedValueOnce(page(['a'], null));

    await expect(fetchAllAccountingStudentFinance()).rejects.toThrow(/duplicate/i);
  });
});
