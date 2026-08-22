import { describe, expect, it } from 'vitest';
import { buildStudentTuitionDebtSnapshot } from './studentTuitionDebt';

describe('buildStudentTuitionDebtSnapshot', () => {
  it('lists every indebted course newest-first and subtracts wallet balance once', () => {
    const result = buildStudentTuitionDebtSnapshot({
      walletBalance: 100_000,
      ledgers: [
        {
          id: 'ledger-old',
          classId: 'class-old',
          termStart: '2026-08-22',
          termEnd: '2026-12-09',
          amount: 700_000,
          paidTotal: 100_000,
          discountTotal: 0,
          status: 'partial',
          tuitionReminderCount: 1,
        },
        {
          id: 'ledger-new',
          classId: 'class-new',
          termStart: '2026-08-27',
          termEnd: '2026-11-09',
          amount: 900_000,
          paidTotal: 0,
          discountTotal: 100_000,
          status: 'unpaid',
          tuitionReminderCount: 2,
        },
        {
          id: 'ledger-paid',
          classId: 'class-paid',
          termStart: '2026-01-01',
          termEnd: '2026-03-01',
          amount: 500_000,
          paidTotal: 500_000,
          status: 'paid',
        },
      ],
    });

    expect(result).toMatchObject({
      ledgerIds: ['ledger-new', 'ledger-old'],
      grossOutstanding: 1_400_000,
      walletBalanceApplied: 100_000,
      netOutstanding: 1_300_000,
      semester: 'Khóa 27/08 - 09/11, Khóa 22/08 - 09/12',
      nextReminderCount: 3,
    });
  });

  it('rejects an indebted ledger whose course period is incomplete', () => {
    expect(() =>
      buildStudentTuitionDebtSnapshot({
        walletBalance: 0,
        ledgers: [
          {
            id: 'ledger-1',
            classId: 'class-1',
            termStart: '2026-08-27',
            termEnd: '',
            amount: 900_000,
            paidTotal: 0,
            status: 'unpaid',
          },
        ],
      })
    ).toThrow(/ledger-1.*termStart.*termEnd/i);
  });

  it('rejects when wallet balance covers every open ledger', () => {
    expect(() =>
      buildStudentTuitionDebtSnapshot({
        walletBalance: 900_000,
        ledgers: [
          {
            id: 'ledger-1',
            classId: 'class-1',
            termStart: '2026-08-27',
            termEnd: '2026-11-09',
            amount: 900_000,
            paidTotal: 0,
            status: 'unpaid',
          },
        ],
      })
    ).toThrow(/no outstanding tuition debt/i);
  });

  it('error for missing term dates has statusCode and errorCode properties', () => {
    try {
      buildStudentTuitionDebtSnapshot({
        walletBalance: 0,
        ledgers: [
          {
            id: 'ledger-1',
            classId: 'class-1',
            termStart: '2026-08-27',
            termEnd: '',
            amount: 900_000,
            paidTotal: 0,
            status: 'unpaid',
          },
        ],
      });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err).toHaveProperty('statusCode', 400);
      expect(err).toHaveProperty('errorCode', 'TUITION_DEBT_TERM_DATES_MISSING');
    }
  });

  it.each(['2026-13-40', '2026-02-30', '2026-08-27-extra'])(
    'rejects the invalid calendar date %s',
    (termStart) => {
      let caught: unknown;
      try {
        buildStudentTuitionDebtSnapshot({
          walletBalance: 0,
          ledgers: [
            {
              id: 'ledger-1',
              classId: 'class-1',
              termStart,
              termEnd: '2026-11-09',
              amount: 900_000,
              paidTotal: 0,
              status: 'unpaid',
            },
          ],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        statusCode: 400,
        errorCode: 'TUITION_DEBT_TERM_DATES_MISSING',
      });
    }
  );

  it('rejects a semester parameter that exceeds the configured ZNS field limit', () => {
    const ledgers = Array.from({ length: 8 }, (_, index) => ({
      id: `ledger-${index + 1}`,
      classId: `class-${index + 1}`,
      termStart: `2026-${String(index + 1).padStart(2, '0')}-01`,
      termEnd: `2026-${String(index + 1).padStart(2, '0')}-28`,
      amount: 900_000,
      paidTotal: 0,
      status: 'unpaid',
    }));

    let caught: unknown;
    try {
      buildStudentTuitionDebtSnapshot({
        walletBalance: 0,
        ledgers,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      statusCode: 400,
      errorCode: 'TUITION_DEBT_SEMESTER_TOO_LONG',
    });
  });

  it('error for empty debt has statusCode and errorCode properties', () => {
    try {
      buildStudentTuitionDebtSnapshot({
        walletBalance: 900_000,
        ledgers: [
          {
            id: 'ledger-1',
            classId: 'class-1',
            termStart: '2026-08-27',
            termEnd: '2026-11-09',
            amount: 900_000,
            paidTotal: 0,
            status: 'unpaid',
          },
        ],
      });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err).toHaveProperty('statusCode', 400);
      expect(err).toHaveProperty('errorCode', 'TUITION_DEBT_EMPTY');
    }
  });
});
