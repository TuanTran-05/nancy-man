import type { DocumentStore } from '@/server/db/documentStore.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceRepository } from '../repositories/financeRepository.js';
import { aggregateFinanceReport, buildFinanceReport } from './financeReportService.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('aggregateFinanceReport', () => {
  it('aggregates income, expenses, monthly totals, class levels, and categories', () => {
    const report = aggregateFinanceReport(
      [
        {
          id: 'receipt-1',
          amountReceived: 1_000_000,
          discountAmount: 100_000,
          receivedDate: '2026-04-05',
          classId: 'class-primary',
        },
        {
          id: 'receipt-2',
          amountReceived: 2_000_000,
          receivedDate: '2026-04-20',
          classId: 'class-upper',
        },
      ],
      [
        { id: 'expense-1', amount: 500_000, paidDate: '2026-04-10', category: 'salary' },
        { id: 'expense-2', amount: 300_000, paidDate: '2026-05-02', category: 'rent' },
      ],
      {
        'class-primary': 'primary',
        'class-upper': 'upper_secondary',
      }
    );

    expect(report.totalIncome).toBe(3_000_000);
    expect(report.totalExpenses).toBe(800_000);
    expect(report.totalScholarships).toBe(100_000);
    expect(report.balance).toBe(2_200_000);
    expect(report.monthlyBreakdown).toEqual([
      { month: '2026-04', income: 3_000_000, expenses: 500_000, balance: 2_500_000 },
      { month: '2026-05', income: 0, expenses: 300_000, balance: -300_000 },
    ]);
    expect(
      report.incomeByLevel.map((item) => ({ level: item.level, amount: item.amount }))
    ).toEqual([
      { level: 'primary', amount: 1_000_000 },
      { level: 'upper_secondary', amount: 2_000_000 },
    ]);
    expect(
      report.expensesByCategory.map((item) => ({ category: item.category, amount: item.amount }))
    ).toEqual([
      { category: 'salary', amount: 500_000 },
      { category: 'rent', amount: 300_000 },
    ]);
  });

  it('normalizes PostgreSQL numeric strings from migrated finance documents', () => {
    const report = aggregateFinanceReport(
      [
        {
          id: 'migrated-receipt',
          amountReceived: '1500000',
          discountAmount: '100000',
          receivedDate: '2026-08-19T00:00:00.000Z',
          classId: 'class-primary',
        } as never,
      ],
      [
        {
          id: 'migrated-expense',
          amount: '250000',
          paidDate: '2026-08-19T00:00:00.000Z',
          category: 'supplies',
        } as never,
      ],
      { 'class-primary': 'primary' }
    );

    expect(report.totalIncome).toBe(1_500_000);
    expect(report.totalExpenses).toBe(250_000);
    expect(report.totalScholarships).toBe(100_000);
    expect(report.balance).toBe(1_250_000);
    expect(report.monthlyBreakdown).toEqual([
      { month: '2026-08', income: 1_500_000, expenses: 250_000, balance: 1_250_000 },
    ]);
  });

  it('keeps wallet top-ups out of the class-level breakdown', () => {
    const report = aggregateFinanceReport(
      [
        {
          id: 'receipt-1',
          amountReceived: 1_000_000,
          receivedDate: '2026-04-05',
          classId: 'class-primary',
        },
        {
          id: 'receipt-wallet',
          amountReceived: 500_000,
          receivedDate: '2026-04-06',
          classId: 'class-primary',
          walletDeposit: true,
        },
      ],
      [],
      { 'class-primary': 'primary' }
    );

    // Cash in is still cash in, so the top-up counts toward the total...
    expect(report.totalIncome).toBe(1_500_000);
    // ...but it is not revenue of the student's current class until allocated.
    expect(
      report.incomeByLevel.map((item) => ({ level: item.level, amount: item.amount }))
    ).toEqual([
      { level: 'primary', amount: 1_000_000 },
      { level: 'wallet_deposit', amount: 500_000 },
    ]);
    expect(report.incomeByLevel.reduce((sum, item) => sum + item.amount, 0)).toBe(
      report.totalIncome
    );
  });

  it('keeps total income equal to the actual receipt while splitting class allocation labels', () => {
    const report = aggregateFinanceReport(
      [
        {
          id: 'r1',
          flowVersion: 'wallet-manual-v2',
          amountReceived: 1_000,
          receivedDate: '2026-07-27',
          allocations: [
            { ledgerId: 'l1', classId: 'c1', amount: 600 },
            { ledgerId: 'l2', classId: 'c2', amount: 200 },
          ],
        },
      ],
      [],
      { c1: 'starter', c2: 'movers' }
    );
    expect(report.totalIncome).toBe(1_000);
    expect(report.incomeByLevel.reduce((sum, row) => sum + row.amount, 0)).toBe(1_000);
    expect(report.incomeByLevel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'starter', amount: 600 }),
        expect.objectContaining({ level: 'movers', amount: 200 }),
        expect.objectContaining({ level: 'wallet_deposit', amount: 200 }),
      ])
    );
  });

  it('sums scholarship amounts from wallet receipt allocations', () => {
    const report = aggregateFinanceReport(
      [
        {
          id: 'wallet-receipt',
          flowVersion: 'wallet-manual-v2',
          amountReceived: 1_700_000,
          allocations: [
            { ledgerId: 'l1', classId: 'c1', amount: 900_000, discountAmount: 100_000 },
            { ledgerId: 'l2', classId: 'c2', amount: 800_000, discountAmount: 200_000 },
          ],
        },
      ],
      [],
      {}
    );

    expect(report.totalScholarships).toBe(300_000);
  });

  it('does not fall back to compatibility classId for an empty v2 allocation snapshot', () => {
    const report = aggregateFinanceReport(
      [
        {
          id: 'v2',
          flowVersion: 'wallet-manual-v2',
          classId: 'c1',
          amountReceived: 500,
          allocations: [],
        },
      ],
      [],
      { c1: 'starter' }
    );
    expect(report.incomeByLevel).toEqual([
      expect.objectContaining({ level: 'wallet_deposit', amount: 500 }),
    ]);
  });

  it('keeps legacy PayOS receipts classified by their original class', () => {
    const report = aggregateFinanceReport(
      [
        {
          id: 'payos',
          source: 'payos',
          classId: 'c1',
          amountReceived: 500,
        },
      ],
      [],
      { c1: 'starter' }
    );
    expect(report.incomeByLevel).toEqual([
      expect.objectContaining({ level: 'starter', amount: 500 }),
    ]);
  });

  it('counts a wallet refund expense exactly once in cash out', () => {
    const report = aggregateFinanceReport(
      [],
      [
        {
          id: 'e1',
          type: 'wallet_refund',
          category: 'wallet_refund',
          amount: 500,
          paidDate: '2026-07-27',
        },
      ],
      {}
    );
    expect(report.totalExpenses).toBe(500);
    expect(report.monthlyBreakdown[0].expenses).toBe(500);
  });

  it('groups posted cash flow by ISO day when daily data is requested', () => {
    const report = aggregateFinanceReport(
      [
        { id: 'r1', receivedDate: '2026-08-01', amountReceived: 1_000 },
        { id: 'r2', receivedDate: '2026-08-02T09:30:00.000Z', amountReceived: 500 },
      ],
      [
        { id: 'e1', paidDate: '2026-08-01', amount: 250, category: 'other' },
        { id: 'e2', paidDate: '2026-08-03', amount: 100, category: 'wallet_refund' },
      ],
      {},
      { includeDaily: true }
    );

    expect(report.dailyBreakdown).toEqual([
      { date: '2026-08-01', income: 1_000, expenses: 250, balance: 750 },
      { date: '2026-08-02', income: 500, expenses: 0, balance: 500 },
      { date: '2026-08-03', income: 0, expenses: 100, balance: -100 },
    ]);
  });
});

describe('buildFinanceReport', () => {
  it('bypasses closed-month aggregates when daily data is requested', async () => {
    const aggregateSpy = vi
      .spyOn(FinanceRepository.prototype, 'getMonthlyAggregates')
      .mockResolvedValue([]);
    vi.spyOn(FinanceRepository.prototype, 'listPostedReceipts').mockResolvedValue([]);
    vi.spyOn(FinanceRepository.prototype, 'listPostedExpenses').mockResolvedValue([]);
    vi.spyOn(FinanceRepository.prototype, 'getClassLevelMap').mockResolvedValue({
      classLevelMap: {},
      classCount: 0,
    });

    const result = await buildFinanceReport({} as DocumentStore, {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      includeDaily: true,
    });

    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(result.source).toBe('live');
    expect(result.dailyBreakdown).toEqual([]);
  });

  it('bypasses closed-month aggregates when a live refresh is requested', async () => {
    const aggregateSpy = vi
      .spyOn(FinanceRepository.prototype, 'getMonthlyAggregates')
      .mockResolvedValue([
        {
          month: '2025-06',
          totalIncome: 900_000,
          totalExpenses: 100_000,
          incomeByLevel: [],
          expensesByCategory: [],
          sourceCounts: { receipts: 1, expenses: 1, classes: 0 },
          range: { startDate: '2025-06-01', endDate: '2025-06-30' },
          generatedAt: '2025-07-01T00:00:00.000Z',
          schemaVersion: 1,
        },
      ]);
    vi.spyOn(FinanceRepository.prototype, 'listPostedReceipts').mockResolvedValue([]);
    vi.spyOn(FinanceRepository.prototype, 'listPostedExpenses').mockResolvedValue([]);
    vi.spyOn(FinanceRepository.prototype, 'getClassLevelMap').mockResolvedValue({
      classLevelMap: {},
      classCount: 0,
    });

    const result = await buildFinanceReport({} as DocumentStore, {
      startDate: '2025-06-01',
      endDate: '2025-06-30',
      forceLive: true,
    });

    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(result.source).toBe('live');
    expect(result.totalIncome).toBe(0);
  });
});
