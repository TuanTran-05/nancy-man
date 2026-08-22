import type { DocumentStore } from '@/server/db/documentStore.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceRepository } from '../repositories/financeRepository.js';
import {
  monthWindow,
  assembleCenterReport,
  buildCenterFinanceReport,
} from './centerFinanceReportService.js';

afterEach(() => vi.restoreAllMocks());

describe('monthWindow', () => {
  it('returns ascending months ending at the selected month', () => {
    expect(monthWindow('2026-03', 4)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
  });
  it('clamps count to at least 1', () => {
    expect(monthWindow('2026-03', 0)).toEqual(['2026-03']);
  });
});

describe('assembleCenterReport', () => {
  it('keeps v2 cash-in whole while splitting its allocation levels', () => {
    const receipt = {
      id: 'r1',
      amountReceived: 1_000,
      receivedDate: '2026-07-27',
      flowVersion: 'wallet-manual-v2' as const,
      allocations: [
        { ledgerId: 'l1', classId: 'c1', amount: 600 },
        { ledgerId: 'l2', classId: 'c2', amount: 200 },
      ],
    };
    const report = assembleCenterReport({
      selectedMonth: '2026-07',
      months: ['2026-07'],
      ledgers: [],
      windowReceipts: [receipt],
      windowExpenses: [],
      selectedMonthReceipts: [receipt],
      selectedMonthExpenses: [],
      selectedMonthLedgers: [],
      students: [],
      classes: [],
      classLevelMap: { c1: 'starter', c2: 'movers' },
      todayStr: '2026-07-27',
    });
    expect(report.current.cashIn).toBe(1_000);
    expect(report.incomeByLevel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'starter', amount: 600 }),
        expect.objectContaining({ level: 'movers', amount: 200 }),
        expect.objectContaining({ level: 'wallet_deposit', amount: 200 }),
      ])
    );
  });

  it('assembles months, headline, discount split, and status from inputs', () => {
    const report = assembleCenterReport({
      selectedMonth: '2026-04',
      months: ['2026-03', '2026-04'],
      ledgers: [
        {
          id: 'l1',
          amount: 3_000_000,
          discountTotal: 300_000,
          paidTotal: 1_000_000,
          termStart: '2026-03-01',
          dueDate: '2026-04-01',
        },
        {
          id: 'l2',
          studentId: 'student-2',
          classId: 'c1',
          amount: 2_000_000,
          discountTotal: 0,
          paidTotal: 500_000,
          month: '2026-04',
          dueDate: '2999-01-01',
        },
      ],
      windowReceipts: [
        { id: 'r1', amountReceived: 1_000_000, receivedDate: '2026-03-05' },
        {
          id: 'r2',
          amountReceived: 500_000,
          receivedDate: '2026-04-10',
          discountType: 'first_prize',
          discountAmount: 100_000,
        },
      ],
      windowExpenses: [{ id: 'e1', amount: 500_000, paidDate: '2026-04-12', category: 'salary' }],
      selectedMonthReceipts: [
        {
          id: 'r2',
          amountReceived: 500_000,
          receivedDate: '2026-04-10',
          discountType: 'first_prize',
          discountAmount: 100_000,
          classId: 'c1',
        },
      ],
      selectedMonthExpenses: [
        { id: 'e1', amount: 500_000, paidDate: '2026-04-12', category: 'salary' },
      ],
      selectedMonthLedgers: [
        {
          id: 'l2',
          studentId: 'student-2',
          classId: 'c1',
          amount: 2_000_000,
          discountTotal: 0,
          paidTotal: 500_000,
          month: '2026-04',
          dueDate: '2999-01-01',
        },
      ],
      students: [
        {
          id: 'student-2',
          name: 'Le Minh Anh',
          studentId: 'HS002',
          dob: '2012-03-14',
          contact: '0901234567',
        },
      ],
      classes: [
        {
          id: 'c1',
          className: 'IELTS 6.5',
          teacherId: 'teacher-1',
          teacherName: 'Ms. Lan',
        },
      ],
      classLevelMap: { c1: 'primary' },
      todayStr: '2026-07-18',
    });

    expect(report.success).toBe(true);
    expect(report.selectedMonth).toBe('2026-04');
    expect(report.months).toHaveLength(2);
    expect(report.current.month).toBe('2026-04');
    expect(report.current.netBilled).toBe(2_000_000);
    expect(report.current.outstanding).toBe(1_500_000);
    expect(report.discountBreakdown).toEqual({ discount: 100_000, waiver: 0, unclassified: 0 });
    expect(report.incomeByLevel.map((l) => l.level)).toContain('primary');
    expect(report.receivablesByStatus.some((s) => s.status === 'partial')).toBe(true);
    expect(report.studentPayments.summary.partial).toBe(1);
    expect(report.studentPayments.rows[0]).toEqual(
      expect.objectContaining({
        fullName: 'Le Minh Anh',
        studentCode: 'HS002',
        paidAmount: 500_000,
        outstandingAmount: 1_500_000,
      })
    );
    expect(report.studentPayments.rows[0].courses[0]).toEqual(
      expect.objectContaining({ className: 'IELTS 6.5', teacherName: 'Ms. Lan' })
    );
    expect(report.source).toBe('live');
  });
});

describe('buildCenterFinanceReport', () => {
  it('derives the selected month from the window snapshot without duplicate receipt/expense reads', async () => {
    vi.spyOn(FinanceRepository.prototype, 'listLedgersByCohortMonths').mockResolvedValue([]);
    const receiptSpy = vi
      .spyOn(FinanceRepository.prototype, 'listPostedReceipts')
      .mockResolvedValue([
        {
          id: 'r1',
          amountReceived: 500_000,
          receivedDate: '2026-04-10',
          discountType: 'first_prize',
          discountAmount: 100_000,
          classId: 'c1',
        },
      ]);
    const expenseSpy = vi
      .spyOn(FinanceRepository.prototype, 'listPostedExpenses')
      .mockResolvedValue([
        { id: 'e1', amount: 200_000, paidDate: '2026-04-12', category: 'salary' },
      ]);
    vi.spyOn(FinanceRepository.prototype, 'getClassReportContext').mockResolvedValue({
      classLevelMap: { c1: 'primary' },
      classes: [],
      classCount: 1,
    });

    const report = await buildCenterFinanceReport({} as DocumentStore, {
      month: '2026-04',
      months: 2,
    });

    expect(receiptSpy).toHaveBeenCalledTimes(1);
    expect(expenseSpy).toHaveBeenCalledTimes(1);
    expect(report.current.cashIn).toBe(500_000);
    expect(report.discountBreakdown.discount).toBe(100_000);
    expect(report.incomeByLevel.map((row) => row.level)).toContain('primary');
    expect(report.current.cashOut).toBe(200_000);
    expect(report.expensesByCategory.map((row) => row.category)).toContain('salary');
  });
});
