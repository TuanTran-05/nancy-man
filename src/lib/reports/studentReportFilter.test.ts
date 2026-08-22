import { describe, expect, it } from 'vitest';
import {
  ALL,
  filterStudentReport,
  listFilterClasses,
  listFilterTerms,
} from './studentReportFilter';
import type { StudentAdminReportResponse } from '../api/studentAdminReportApi';

const REPORT: StudentAdminReportResponse = {
  student: { id: 'stu-1', name: 'A' },
  timeline: [
    {
      key: 'cls-3b::term_1',
      classId: 'cls-3b',
      className: 'Lớp 3B',
      classMissing: false,
      grade: 3,
      attendanceMode: 'marked_only',
      enrollment: null,
      term: {
        termId: 'term_1',
        classId: 'cls-3b',
        index: 1,
        startDate: '2025-09-01',
        endDate: '2025-12-31',
        isCurrent: false,
        schedule: null,
      },
    },
    {
      key: 'cls-4a::current',
      classId: 'cls-4a',
      className: 'Lớp 4A',
      classMissing: false,
      grade: 4,
      attendanceMode: 'expected',
      enrollment: null,
      term: {
        termId: 'current',
        classId: 'cls-4a',
        index: 1,
        startDate: '2026-01-01',
        endDate: '',
        isCurrent: true,
        schedule: null,
      },
    },
  ],
  attendanceRows: [
    {
      date: '2025-10-07',
      classId: 'cls-3b',
      termKey: 'cls-3b::term_1',
      status: 'present',
      absentWithPermission: false,
      minutesLate: 0,
      source: 'scheduled',
    },
    {
      date: '2025-11-04',
      classId: 'cls-3b',
      termKey: 'cls-3b::term_1',
      status: 'absent',
      absentWithPermission: false,
      minutesLate: 0,
      source: 'scheduled',
    },
    {
      date: '2026-02-03',
      classId: 'cls-4a',
      termKey: 'cls-4a::current',
      status: 'present',
      absentWithPermission: false,
      minutesLate: 0,
      source: 'scheduled',
    },
  ],
  sessionValueByTerm: {},
  ledgers: [
    {
      id: 'l1',
      periodKey: 'p1',
      classId: 'cls-3b',
      termKey: 'cls-3b::term_1',
      termStart: '2025-09-01',
      termEnd: '2025-12-31',
      termLabel: null,
      dueDate: '2025-09-10',
      grossAmount: 1000,
      discount: 0,
      netAmount: 1000,
      paid: 1000,
      outstanding: 0,
      displayStatus: 'paid',
      isOverdue: false,
      hasDueDate: true,
    },
    {
      id: 'l2',
      periodKey: 'p2',
      classId: 'cls-4a',
      termKey: 'cls-4a::current',
      termStart: '2026-01-01',
      termEnd: '',
      termLabel: null,
      dueDate: '2026-01-10',
      grossAmount: 2000,
      discount: 0,
      netAmount: 2000,
      paid: 0,
      outstanding: 2000,
      displayStatus: 'unpaid',
      isOverdue: false,
      hasDueDate: true,
    },
  ],
  receipts: [],
  truncation: { attendance: false, ledgers: false, classSessions: false },
  generatedAt: '2026-07-17T00:00:00.000Z',
};

const TODAY = '2026-07-17';

describe('listFilterClasses', () => {
  it('lists each class once, in timeline order', () => {
    expect(listFilterClasses(REPORT.timeline)).toEqual([
      { classId: 'cls-3b', className: 'Lớp 3B', classMissing: false },
      { classId: 'cls-4a', className: 'Lớp 4A', classMissing: false },
    ]);
  });
});

describe('listFilterTerms', () => {
  it('lists only the chosen classterms', () => {
    expect(listFilterTerms(REPORT.timeline, 'cls-3b').map((s) => s.key)).toEqual([
      'cls-3b::term_1',
    ]);
  });

  it('lists every course when the class filter is ALL', () => {
    expect(listFilterTerms(REPORT.timeline, ALL).map((s) => s.key)).toEqual([
      'cls-3b::term_1',
      'cls-4a::current',
    ]);
  });
});

describe('filterStudentReport', () => {
  it('scopes rows and summaries to one course', () => {
    const result = filterStudentReport(
      REPORT,
      { classId: 'cls-3b', termKey: 'cls-3b::term_1' },
      TODAY
    );

    expect(result.attendanceRows).toHaveLength(2);
    expect(result.ledgers).toHaveLength(1);
    expect(result.financeSummary.grossAmount).toBe(1000);
    expect(result.financeSummary.outstandingTotal).toBe(0);
    expect(result.attendanceSummary.present).toBe(1);
    expect(result.attendanceMode).toBe('marked_only');
  });

  it('aggregates every course when both filters are ALL', () => {
    const result = filterStudentReport(REPORT, { classId: ALL, termKey: ALL }, TODAY);

    expect(result.attendanceRows).toHaveLength(3);
    expect(result.financeSummary.grossAmount).toBe(3000);
    expect(result.financeSummary.outstandingTotal).toBe(2000);
  });

  it('narrows to a whole class when only the term filter is ALL', () => {
    const result = filterStudentReport(REPORT, { classId: 'cls-3b', termKey: ALL }, TODAY);

    expect(result.attendanceRows).toHaveLength(2);
    expect(result.ledgers.map((l) => l.id)).toEqual(['l1']);
  });

  it('does not conflate current courses of different classes', () => {
    // Both classes have a course with termId 'current' — filtering must key on
    // termKey, or "current of 4A" would also match "current of 3B".
    const withSecondCurrent: StudentAdminReportResponse = {
      ...REPORT,
      timeline: [
        ...REPORT.timeline,
        {
          key: 'cls-3b::current',
          classId: 'cls-3b',
          className: 'Lớp 3B',
          classMissing: false,
          grade: 3,
          attendanceMode: 'expected',
          enrollment: null,
          term: {
            termId: 'current',
            classId: 'cls-3b',
            index: 2,
            startDate: '2026-01-05',
            endDate: '',
            isCurrent: true,
            schedule: null,
          },
        },
      ],
      attendanceRows: [
        ...REPORT.attendanceRows,
        {
          date: '2026-02-10',
          classId: 'cls-3b',
          termKey: 'cls-3b::current',
          status: 'present',
          absentWithPermission: false,
          minutesLate: 0,
          source: 'scheduled',
        },
      ],
    };

    const result = filterStudentReport(
      withSecondCurrent,
      { classId: ALL, termKey: 'cls-4a::current' },
      TODAY
    );

    expect(result.attendanceRows.map((r) => r.termKey)).toEqual(['cls-4a::current']);
    expect(result.segments.map((s) => s.key)).toEqual(['cls-4a::current']);
  });

  it('intersects an explicit date range with the course filter', () => {
    const result = filterStudentReport(
      REPORT,
      { classId: 'cls-3b', termKey: 'cls-3b::term_1', from: '2025-11-01', to: '2025-11-30' },
      TODAY
    );

    expect(result.attendanceRows.map((r) => r.date)).toEqual(['2025-11-04']);
    expect(result.attendanceSummary.present).toBe(0);
    expect(result.attendanceSummary.absentWithoutPermission).toBe(1);
  });

  it('normalises a reversed date range instead of matching nothing', () => {
    const result = filterStudentReport(
      REPORT,
      { classId: 'cls-3b', termKey: 'cls-3b::term_1', from: '2025-11-30', to: '2025-11-01' },
      TODAY
    );

    expect(result.attendanceRows.map((r) => r.date)).toEqual(['2025-11-04']);
  });

  it('reports mixed mode when the selection spans both modes', () => {
    const result = filterStudentReport(REPORT, { classId: ALL, termKey: ALL }, TODAY);

    expect(result.attendanceMode).toBe('mixed');
  });

  it('returns empty summaries for a selection with no data', () => {
    const result = filterStudentReport(
      REPORT,
      { classId: 'cls-3b', termKey: 'cls-3b::term_1', from: '2030-01-01', to: '2030-12-31' },
      TODAY
    );

    expect(result.attendanceRows).toEqual([]);
    expect(result.attendanceSummary.attendanceRate).toBeNull();
    expect(result.financeSummary.grossAmount).toBe(0);
  });

  it('reports no mode for a student with an empty timeline', () => {
    // 'mixed' would claim the selection spans several differently-calculated
    // courses when it spans none at all, and the KPI note would say so.
    const result = filterStudentReport(
      { ...REPORT, timeline: [], attendanceRows: [], ledgers: [] },
      { classId: ALL, termKey: ALL },
      TODAY
    );

    expect(result.segments).toEqual([]);
    expect(result.attendanceMode).toBe('none');
  });

  it('reports no mode when the filter matches no course', () => {
    const result = filterStudentReport(REPORT, { classId: 'cls-gone', termKey: ALL }, TODAY);

    expect(result.attendanceMode).toBe('none');
  });
});
