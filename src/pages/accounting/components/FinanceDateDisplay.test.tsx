// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpensesTab } from './ExpensesTab';
import { ReceiptsTab } from './ReceiptsTab';

const financePage = {
  actions: 'Actions',
  amount: 'Amount',
  category: 'Category',
  catRent: 'Rent',
  catSalary: 'Salary',
  catSupplies: 'Supplies',
  catUtilities: 'Utilities',
  className: 'Class',
  createExpense: 'Create expense',
  createReceipt: 'Create receipt',
  custom: 'Custom',
  details: 'Details',
  discount: 'Discount',
  expenseDate: 'Expense date',
  expenseNo: 'Expense no',
  hardship20: 'Hardship 20%',
  method: 'Method',
  methodOther: 'Other',
  noExpenses: 'No expenses',
  noReceipts: 'No receipts',
  payee: 'Payee',
  post: 'Post',
  receiptDate: 'Receipt date',
  receiptNo: 'Receipt no',
  status: 'Status',
  student: 'Student',
  voidAction: 'Void',
  waived100: 'Waived 100%',
};

describe('finance table date display', () => {
  it('formats receipt received dates as display dates', () => {
    render(
      <ReceiptsTab
        activeTab="receipts"
        setShowReceiptModal={vi.fn()}
        filteredReceipts={[
          {
            id: 'receipt-1',
            receiptNo: 'PT-260605-001',
            type: 'tuition',
            studentId: 'student-1',
            classId: 'class-1',
            ledgerId: 'ledger-1',
            amountReceived: 100000,
            paymentMethod: 'cash',
            receivedDate: '2026-06-05',
            createdBy: 'accounting-1',
            createdByRole: 'accounting',
            status: 'posted',
            createdAt: '2026-06-05T10:30:00.000Z',
          },
        ]}
        studentMap={{ 'student-1': { name: 'An' } as any }}
        classMap={{ 'class-1': { name: 'Class 1' } as any }}
        actionLoading={null}
        handlePostReceipt={vi.fn()}
        handleVoidReceipt={vi.fn()}
        receiptsHasMore={false}
        receiptsLoading={false}
        loadReceipts={vi.fn()}
        language="en"
        t={{ financePage }}
      />
    );

    expect(screen.getByText('05/06/2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-06-05')).toBeNull();
  });

  it('formats expense paid dates as display dates', () => {
    render(
      <ExpensesTab
        activeTab="expenses"
        setShowExpenseModal={vi.fn()}
        filteredExpenses={[
          {
            id: 'expense-1',
            expenseNo: 'PC-260605-001',
            category: 'rent',
            amount: 100000,
            paidDate: '2026-06-05',
            payee: 'Landlord',
            status: 'posted',
            createdBy: 'accounting-1',
            createdAt: '2026-06-05T10:30:00.000Z',
          },
        ]}
        actionLoading={null}
        handlePostExpense={vi.fn()}
        handleVoidExpense={vi.fn()}
        expensesHasMore={false}
        expensesLoading={false}
        loadExpenses={vi.fn()}
        language="en"
        t={{ financePage }}
      />
    );

    expect(screen.getByText('05/06/2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-06-05')).toBeNull();
  });
});
