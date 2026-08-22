import { describe, expect, it } from 'vitest';
import {
  ledgerCohortMonth,
  ledgerOverlapsMonth,
  buildCenterMonths,
  splitDiscounts,
  aggregateReceivablesByStatus,
  aggregateStudentPayments,
} from './centerFinanceReport.js';

describe('ledgerCohortMonth', () => {
  it('uses the month field for monthly ledgers', () => {
    expect(ledgerCohortMonth({ id: 'a', periodType: 'monthly', month: '2026-04' })).toBe('2026-04');
  });
  it('uses termStart month for course ledgers', () => {
    expect(
      ledgerCohortMonth({
        id: 'b',
        periodType: 'course',
        termStart: '2026-03-15',
        createdAt: '2026-01-01',
      })
    ).toBe('2026-03');
  });
  it('defensively uses month when periodType is absent', () => {
    expect(ledgerCohortMonth({ id: 'e', month: '2026-05' })).toBe('2026-05');
  });
  it('falls back to createdAt (already a string) when no month or termStart', () => {
    expect(ledgerCohortMonth({ id: 'c', createdAt: '2026-02-20T00:00:00Z' })).toBe('2026-02');
  });
  it('returns empty string when nothing usable', () => {
    expect(ledgerCohortMonth({ id: 'd' })).toBe('');
  });
});

describe('ledgerOverlapsMonth', () => {
  const firstCourse = {
    id: 'course-jul-sep',
    periodType: 'course',
    termStart: '2026-07-17',
    termEnd: '2026-09-17',
  };
  const secondCourse = {
    id: 'course-sep-nov',
    periodType: 'course',
    termStart: '2026-09-20',
    termEnd: '2026-11-20',
  };

  it('includes a course in every calendar month touched by its inclusive date range', () => {
    expect(ledgerOverlapsMonth(firstCourse, '2026-07')).toBe(true);
    expect(ledgerOverlapsMonth(firstCourse, '2026-08')).toBe(true);
    expect(ledgerOverlapsMonth(firstCourse, '2026-09')).toBe(true);
    expect(ledgerOverlapsMonth(firstCourse, '2026-10')).toBe(false);

    expect(ledgerOverlapsMonth(secondCourse, '2026-08')).toBe(false);
    expect(ledgerOverlapsMonth(secondCourse, '2026-09')).toBe(true);
    expect(ledgerOverlapsMonth(secondCourse, '2026-10')).toBe(true);
    expect(ledgerOverlapsMonth(secondCourse, '2026-11')).toBe(true);
    expect(ledgerOverlapsMonth(secondCourse, '2026-12')).toBe(false);
  });

  it('keeps monthly and incomplete legacy ledgers scoped to one month', () => {
    expect(
      ledgerOverlapsMonth({ id: 'monthly', periodType: 'monthly', month: '2026-08' }, '2026-08')
    ).toBe(true);
    expect(
      ledgerOverlapsMonth({ id: 'monthly', periodType: 'monthly', month: '2026-08' }, '2026-09')
    ).toBe(false);
    expect(ledgerOverlapsMonth({ id: 'start-only', termStart: '2026-08-10' }, '2026-08')).toBe(
      true
    );
  });
});

describe('buildCenterMonths', () => {
  it('computes the waterfall and cash per cohort month', () => {
    const rows = buildCenterMonths(
      ['2026-03', '2026-04'],
      [
        {
          id: 'l1',
          periodType: 'course',
          amount: 3_000_000,
          discountTotal: 300_000,
          paidTotal: 1_000_000,
          termStart: '2026-03-01',
        },
        {
          id: 'l2',
          periodType: 'monthly',
          amount: 2_000_000,
          discountTotal: 0,
          paidTotal: 2_000_000,
          month: '2026-04',
        },
      ],
      [
        { id: 'r1', amountReceived: 1_000_000, receivedDate: '2026-03-05' },
        { id: 'r2', amountReceived: 2_000_000, receivedDate: '2026-04-10' },
      ],
      [{ id: 'e1', amount: 500_000, paidDate: '2026-04-12' }]
    );

    expect(rows).toEqual([
      {
        month: '2026-03',
        grossBilled: 3_000_000,
        discountTotal: 300_000,
        netBilled: 2_700_000,
        collectedCohort: 1_000_000,
        outstanding: 1_700_000,
        cashIn: 1_000_000,
        cashOut: 0,
      },
      {
        month: '2026-04',
        grossBilled: 2_000_000,
        discountTotal: 0,
        netBilled: 2_000_000,
        collectedCohort: 2_000_000,
        outstanding: 0,
        cashIn: 2_000_000,
        cashOut: 500_000,
      },
    ]);
  });

  it('clamps overpayment so the waterfall invariant holds (net − collected === outstanding)', () => {
    // paidTotal (5M) exceeds net (1M): overpayment must not inflate the collected bar.
    const [row] = buildCenterMonths(
      ['2026-05'],
      [
        {
          id: 'l',
          periodType: 'monthly',
          amount: 1_000_000,
          discountTotal: 0,
          paidTotal: 5_000_000,
          month: '2026-05',
        },
      ],
      [],
      []
    );
    expect(row.netBilled).toBe(1_000_000);
    expect(row.collectedCohort).toBe(1_000_000); // capped at net, not 5M
    expect(row.outstanding).toBe(0);
    expect(row.netBilled - row.collectedCohort).toBe(row.outstanding); // invariant
  });
});

describe('splitDiscounts', () => {
  it('classifies discount vs waiver vs unclassified by discountType', () => {
    const result = splitDiscounts([
      { id: 'r1', discountType: 'first_prize', discountAmount: 100_000 },
      { id: 'r2', discountType: 'custom', discountAmount: 50_000 },
      { id: 'r3', discountType: 'full_waiver', discountAmount: 800_000 },
      { id: 'r4', discountType: 'hardship', discountAmount: 200_000 },
      { id: 'r5', discountType: 'mystery', discountAmount: 10_000 },
      { id: 'r6', discountType: 'none' },
    ]);
    expect(result).toEqual({ discount: 150_000, waiver: 1_000_000, unclassified: 10_000 });
  });

  it('counts a sibling-only receipt as a discount, not unclassified', () => {
    expect(
      splitDiscounts([
        { id: 'r1', siblingDiscount: true, siblingDiscountAmount: 100_000, discountAmount: 100_000 },
      ])
    ).toEqual({ discount: 100_000, waiver: 0, unclassified: 0 });
  });

  it('splits a stacked hardship + sibling receipt across both categories', () => {
    expect(
      splitDiscounts([
        {
          id: 'r1',
          discountType: 'hardship',
          siblingDiscount: true,
          siblingDiscountAmount: 100_000,
          discountAmount: 300_000,
        },
      ])
    ).toEqual({ discount: 100_000, waiver: 200_000, unclassified: 0 });
  });

  it('splits a stacked first prize + sibling receipt entirely into discount', () => {
    expect(
      splitDiscounts([
        {
          id: 'r1',
          discountType: 'first_prize',
          siblingDiscount: true,
          siblingDiscountAmount: 100_000,
          discountAmount: 200_000,
        },
      ])
    ).toEqual({ discount: 200_000, waiver: 0, unclassified: 0 });
  });

  it('infers the sibling part on a legacy flagged receipt', () => {
    expect(
      splitDiscounts([
        {
          id: 'r1',
          siblingDiscount: true,
          originalAmount: 1_000_000,
          discountAmount: 100_000,
        },
      ])
    ).toEqual({ discount: 100_000, waiver: 0, unclassified: 0 });
  });

  it('does not invent a grant for a legacy sibling flag with no actual reduction', () => {
    expect(
      splitDiscounts([
        { id: 'r1', siblingDiscount: true, originalAmount: 1_000_000, discountAmount: 0 },
      ])
    ).toEqual({ discount: 0, waiver: 0, unclassified: 0 });
  });

  it('ignores a sibling amount larger than the receipt discount', () => {
    expect(
      splitDiscounts([
        { id: 'r1', siblingDiscount: true, siblingDiscountAmount: 500_000, discountAmount: 100_000 },
      ])
    ).toEqual({ discount: 100_000, waiver: 0, unclassified: 0 });
  });
});

describe('aggregateReceivablesByStatus', () => {
  it('groups outstanding and counts by display status', () => {
    const rows = aggregateReceivablesByStatus(
      [
        { id: 'l1', amount: 1_000_000, paidTotal: 0, dueDate: '2026-01-01', status: 'unpaid' }, // overdue
        { id: 'l2', amount: 1_000_000, paidTotal: 1_000_000, dueDate: '2026-01-01' }, // paid
        { id: 'l3', amount: 1_000_000, paidTotal: 400_000, dueDate: '2999-01-01' }, // partial
      ],
      '2026-07-18'
    );
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r]));
    expect(byStatus.overdue).toEqual({ status: 'overdue', count: 1, outstanding: 1_000_000 });
    expect(byStatus.partial).toEqual({ status: 'partial', count: 1, outstanding: 600_000 });
    expect(byStatus.paid).toBeUndefined(); // zero-outstanding statuses are omitted
  });
});

describe('aggregateStudentPayments', () => {
  it('groups multiple ledgers per student and keeps paid, outstanding, waived and overdue counts distinct', () => {
    const report = aggregateStudentPayments(
      [
        {
          id: 'l1',
          studentId: 's1',
          amount: 1_000_000,
          paidTotal: 1_000_000,
          dueDate: '2026-04-10',
        },
        {
          id: 'l2',
          studentId: 's1',
          amount: 2_000_000,
          paidTotal: 500_000,
          dueDate: '2999-04-10',
        },
        {
          id: 'l3',
          studentId: 's2',
          amount: 1_500_000,
          paidTotal: 0,
          dueDate: '2026-01-10',
        },
        {
          id: 'l4',
          studentId: 's3',
          amount: 1_000_000,
          discountTotal: 1_000_000,
          paidTotal: 0,
        },
        {
          id: 'l5',
          studentId: 's4',
          amount: 800_000,
          paidTotal: 800_000,
        },
      ],
      [
        { id: 's1', name: 'Nguyen An', studentId: 'HS001', dob: '2012-02-03', contact: '0901' },
        { id: 's2', name: 'Le Binh', studentId: 'HS002', dob: '2011-05-06', contact: '0902' },
        { id: 's3', name: 'Tran Chi', studentId: 'HS003' },
        { id: 's4', name: 'Pham Dung', studentId: 'HS004' },
      ],
      '2026-07-18'
    );

    expect(report.summary).toEqual({
      total: 4,
      paid: 1,
      partial: 1,
      unpaid: 1,
      waived: 1,
      withOutstanding: 2,
      overdue: 1,
    });
    expect(report.rows.find((row) => row.id === 's1')).toEqual(
      expect.objectContaining({
        fullName: 'Nguyen An',
        studentCode: 'HS001',
        paymentStatus: 'partial',
        billedAmount: 3_000_000,
        paidAmount: 1_500_000,
        outstandingAmount: 1_500_000,
        ledgerCount: 2,
        studentRecordFound: true,
      })
    );
    expect(report.rows.find((row) => row.id === 's2')?.overdueAmount).toBe(1_500_000);
  });

  it('marks a new unpaid course as unpaid even when an older overlapping course was paid', () => {
    const report = aggregateStudentPayments(
      [
        {
          id: 'old-course',
          studentId: 's1',
          classId: 'class-1',
          amount: 1_000_000,
          paidTotal: 1_000_000,
          termStart: '2026-07-17',
          termEnd: '2026-09-17',
        },
        {
          id: 'new-course',
          studentId: 's1',
          classId: 'class-1',
          amount: 2_000_000,
          paidTotal: 0,
          termStart: '2026-09-20',
          termEnd: '2026-11-20',
        },
      ],
      [{ id: 's1', name: 'Nguyen An', studentId: 'HS001' }],
      '2026-09-01',
      [
        {
          id: 'class-1',
          className: 'IELTS 6.5',
          teacherId: 'teacher-1',
          teacherName: 'Ms. Lan',
        },
      ]
    );

    expect(report.rows[0].paymentStatus).toBe('unpaid');
    expect(report.rows[0].courses).toEqual([
      expect.objectContaining({
        id: 'new-course',
        paymentStatus: 'unpaid',
        className: 'IELTS 6.5',
        teacherName: 'Ms. Lan',
      }),
      expect.objectContaining({ id: 'old-course', paymentStatus: 'paid' }),
    ]);
  });
});
