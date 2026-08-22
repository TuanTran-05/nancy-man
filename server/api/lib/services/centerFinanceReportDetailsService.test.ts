import type { DocumentStore } from '@/server/db/documentStore.js';
import { afterEach, expect, it, vi } from 'vitest';
import { FinanceRepository } from '../repositories/financeRepository.js';
import {
  buildCenterFinanceReportDetails,
  centerReportMonthPeriod,
  decodeCenterReportDetailsCursor,
  encodeCenterReportDetailsCursor,
} from './centerFinanceReportDetailsService.js';

afterEach(() => vi.restoreAllMocks());

it('uses the exact first and last day of leap-year February', () => {
  expect(centerReportMonthPeriod('2028-02')).toEqual({
    startDate: '2028-02-01',
    endDate: '2028-02-29',
  });
});

it('round-trips a month-scoped opaque cursor and rejects another month', () => {
  const encoded = encodeCenterReportDetailsCursor(
    { date: '2026-07-30', id: 'r1' },
    { startDate: '2026-07-01', endDate: '2026-07-31' },
    'income'
  );
  expect(decodeCenterReportDetailsCursor(encoded, { month: '2026-07' }, 'income')).toEqual({
    date: '2026-07-30',
    id: 'r1',
  });
  expect(() => decodeCenterReportDetailsCursor(encoded, { month: '2026-08' }, 'income')).toThrow('invalid_cursor');
});

it('joins receipt pages to current students, ledgers and classes', async () => {
  vi.spyOn(FinanceRepository.prototype, 'listPostedReceiptDetailsPage').mockResolvedValue({
    rows: [
      {
        id: 'r1',
        receiptNo: 'PT-1',
        receivedDate: '2026-07-30',
        studentId: 's1',
        amountReceived: 1_000_000,
        allocations: [{ ledgerId: 'l1', classId: 'c1', amount: 1_000_000 }],
      },
    ],
    totalCount: 1,
    totalAmount: 1_000_000,
    nextCursor: { date: '2026-07-30', id: 'r1' },
  });
  vi.spyOn(FinanceRepository.prototype, 'listStudentsByIds').mockResolvedValue([
    { id: 's1', name: 'Nguyễn An', walletBalance: 25_000 },
  ]);
  vi.spyOn(FinanceRepository.prototype, 'listLedgersByIds').mockResolvedValue([
    { id: 'l1', classId: 'c1', amount: 1_200_000, paidTotal: 1_000_000 },
  ]);
  vi.spyOn(FinanceRepository.prototype, 'listClassesByIds').mockResolvedValue([
    { id: 'c1', className: 'IELTS 6.5' },
  ]);

  const result = await buildCenterFinanceReportDetails({} as DocumentStore, {
    month: '2026-07',
    type: 'income',
    pageSize: 25,
    cursor: null,
  });

  expect(result).toMatchObject({
    type: 'income',
    period: { startDate: '2026-07-01', endDate: '2026-07-31' },
    totalCount: 1,
    totalAmount: 1_000_000,
    rows: [
      expect.objectContaining({
        studentName: 'Nguyễn An',
        walletBalance: 25_000,
        amountDue: 1_200_000,
        remainingAmount: 200_000,
      }),
    ],
  });
  expect(result.nextCursor).toEqual(expect.any(String));
});

it('joins refund expenses to students and classes without reading ledgers', async () => {
  vi.spyOn(FinanceRepository.prototype, 'listPostedExpenseDetailsPage').mockResolvedValue({
    rows: [
      {
        id: 'e1',
        expenseNo: 'PC-1',
        paidDate: '2026-07-30',
        type: 'wallet_refund',
        studentId: 's1',
        classId: 'c1',
        amount: 200_000,
      },
    ],
    totalCount: 1,
    totalAmount: 200_000,
    nextCursor: null,
  });
  vi.spyOn(FinanceRepository.prototype, 'listStudentsByIds').mockResolvedValue([
    { id: 's1', name: 'Nguyễn An', walletBalance: 0 },
  ]);
  vi.spyOn(FinanceRepository.prototype, 'listClassesByIds').mockResolvedValue([
    { id: 'c1', className: 'IELTS 6.5' },
  ]);
  const ledgerSpy = vi.spyOn(FinanceRepository.prototype, 'listLedgersByIds');

  const result = await buildCenterFinanceReportDetails({} as DocumentStore, {
    month: '2026-07',
    type: 'expense',
    pageSize: 25,
    cursor: null,
  });

  expect(result).toMatchObject({
    type: 'expense',
    totalAmount: 200_000,
    rows: [expect.objectContaining({ studentName: 'Nguyễn An', walletBalance: 0 })],
  });
  expect(result.rows[0]).toMatchObject({
    classId: 'c1',
    className: 'IELTS 6.5',
    walletBalance: 0,
  });
  expect(ledgerSpy).not.toHaveBeenCalled();
});
