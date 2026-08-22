import { describe, expect, it } from 'vitest';
import { buildExpenseTransactionDetails } from './centerFinanceReportDetails.js';

describe('buildExpenseTransactionDetails expense class context', () => {
  it('preserves an expense class id and joins the current class name', () => {
    const [row] = buildExpenseTransactionDetails({
      expenses: [
        {
          id: 'e-class',
          expenseNo: 'PC-260730-010',
          paidDate: '2026-07-30',
          category: 'supplies',
          amount: 350_000,
          purpose: 'Class materials',
          classId: 'c1',
        },
      ],
      students: [],
      classes: [{ id: 'c1', className: 'IELTS 6.5' }],
    });

    expect(row).toMatchObject({
      classId: 'c1',
      className: 'IELTS 6.5',
    });
  });
});
