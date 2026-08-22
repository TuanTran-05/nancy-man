import { describe, expect, it } from 'vitest';
import {
  buildExpenseTransactionDetails,
  buildIncomeTransactionDetails,
} from './centerFinanceReportDetails.js';

describe('buildIncomeTransactionDetails', () => {
  it('counts cash once while exposing multiple current ledger allocations', () => {
    const [row] = buildIncomeTransactionDetails({
      receipts: [
        {
          id: 'r1',
          receiptNo: 'PT-260730-001',
          invoiceNo: 'INV-260730-001',
          receivedDate: '2026-07-30',
          studentId: 's1',
          paymentMethod: 'transfer',
          amountReceived: 1_000_000,
          flowVersion: 'wallet-manual-v2',
          allocations: [
            { ledgerId: 'l1', classId: 'c1', amount: 900_000 },
            { ledgerId: 'l2', classId: 'c2', amount: 600_000 },
          ],
        },
      ],
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          studentId: 'HS001',
          contact: '0901234567',
          walletBalance: 250_000,
        },
      ],
      ledgers: [
        { id: 'l1', classId: 'c1', amount: 2_000_000, discountTotal: 200_000, paidTotal: 900_000 },
        { id: 'l2', classId: 'c2', amount: 1_000_000, discountTotal: 0, paidTotal: 600_000 },
      ],
      classes: [
        { id: 'c1', className: 'IELTS 6.5' },
        { id: 'c2', className: 'Cambridge B1' },
      ],
    });

    expect(row.amountReceived).toBe(1_000_000);
    expect(row.allocations.map((item) => item.allocatedAmount)).toEqual([900_000, 600_000]);
    expect(row.amountDue).toBe(2_800_000);
    expect(row.remainingAmount).toBe(1_300_000);
    expect(row.walletBalance).toBe(250_000);
    expect(row.studentName).toBe('Nguyễn An');
    expect(row.allocations.map((item) => item.className)).toEqual(['IELTS 6.5', 'Cambridge B1']);
  });

  it('keeps a wallet-only receipt and marks a missing legacy ledger unavailable', () => {
    const rows = buildIncomeTransactionDetails({
      receipts: [
        {
          id: 'wallet',
          receiptNo: 'PT-260730-002',
          receivedDate: '2026-07-30',
          studentId: 's1',
          amountReceived: 400_000,
          flowVersion: 'wallet-manual-v2',
          allocations: [],
        },
        {
          id: 'legacy',
          receiptNo: 'PT-260730-003',
          receivedDate: '2026-07-30',
          studentId: 'missing',
          ledgerId: 'missing-ledger',
          classId: 'missing-class',
          amountReceived: 300_000,
        },
      ],
      students: [{ id: 's1', walletBalance: 400_000 }],
      ledgers: [],
      classes: [],
    });

    expect(rows[0]).toMatchObject({
      walletDeposit: true,
      amountDue: 0,
      remainingAmount: 0,
      walletBalance: 400_000,
    });
    expect(rows[1].allocations[0]).toMatchObject({
      ledgerId: 'missing-ledger',
      dataAvailable: false,
      amountDue: 0,
      remainingAmount: 0,
    });
  });

  it('deduplicates a repeated ledger when calculating receipt totals', () => {
    const [row] = buildIncomeTransactionDetails({
      receipts: [
        {
          id: 'r2',
          receivedDate: '2026-07-30',
          studentId: 's1',
          amountReceived: 500_000,
          allocations: [
            { ledgerId: 'l1', classId: 'c1', amount: 300_000 },
            { ledgerId: 'l1', classId: 'c1', amount: 200_000 },
          ],
        },
      ],
      students: [],
      ledgers: [{ id: 'l1', classId: 'c1', amount: 1_000_000, paidTotal: 500_000 }],
      classes: [],
    });

    expect(row.amountDue).toBe(1_000_000);
    expect(row.remainingAmount).toBe(500_000);
  });

  it('never returns a negative current balance for an overpaid ledger', () => {
    const [row] = buildIncomeTransactionDetails({
      receipts: [
        {
          id: 'overpaid',
          receivedDate: '2026-07-30',
          studentId: 's1',
          ledgerId: 'l1',
          amountReceived: 100_000,
        },
      ],
      students: [],
      ledgers: [
        {
          id: 'l1',
          amount: 1_000_000,
          discountTotal: 200_000,
          paidTotal: 1_100_000,
        },
      ],
      classes: [],
    });

    expect(row.amountDue).toBe(800_000);
    expect(row.remainingAmount).toBe(0);
  });
});

describe('buildExpenseTransactionDetails', () => {
  it('shows both payee and creator and joins the current wallet for a refund', () => {
    const [row] = buildExpenseTransactionDetails({
      expenses: [
        {
          id: 'e1',
          expenseNo: 'PC-260730-001',
          paidDate: '2026-07-30',
          type: 'wallet_refund',
          category: 'wallet_refund',
          amount: 200_000,
          payee: 'Phụ huynh Nguyễn An',
          reason: 'Hoàn học phí thừa',
          createdBy: 'accountant-1',
          createdByName: 'Kế toán Lan',
          studentId: 's1',
        },
      ],
      students: [{ id: 's1', name: 'Nguyễn An', walletBalance: 50_000 }],
    });

    expect(row).toMatchObject({
      amount: 200_000,
      payee: 'Phụ huynh Nguyễn An',
      createdByName: 'Kế toán Lan',
      studentName: 'Nguyễn An',
      walletBalance: 50_000,
    });
  });
});
