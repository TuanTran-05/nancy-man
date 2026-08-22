import { describe, expect, it } from 'vitest';
import {
  buildAttendanceMonthGrid,
  listAttendanceMonths,
  resolveSelectedMonth,
} from './studentAttendanceCalendar';
import type { StudentAttendanceReportRow } from '../api/studentAdminReportApi';

// --- helpers ---

function makeRow(
  date: string,
  classId: string,
  status: StudentAttendanceReportRow['status'] = 'present',
  opts: Partial<StudentAttendanceReportRow> = {}
): StudentAttendanceReportRow {
  return {
    date,
    classId,
    termKey: `${classId}::current`,
    status,
    absentWithPermission: false,
    minutesLate: 0,
    source: 'scheduled',
    ...opts,
  };
}

// --- listAttendanceMonths ---

describe('listAttendanceMonths', () => {
  it('returns [] for empty rows', () => {
    expect(listAttendanceMonths([])).toEqual([]);
  });

  it('returns distinct months in ascending order', () => {
    const rows = [
      makeRow('2026-07-10', 'cls-a'),
      makeRow('2026-05-20', 'cls-a'),
      makeRow('2026-07-15', 'cls-a'),
    ];
    expect(listAttendanceMonths(rows)).toEqual(['2026-05', '2026-07']);
  });

  it('excludes shape-invalid dates', () => {
    const rows = [makeRow('not-a-date', 'cls-a'), makeRow('2026-07-10', 'cls-a')];
    expect(listAttendanceMonths(rows)).toEqual(['2026-07']);
  });

  it('excludes calendar-invalid dates like 2026-02-30', () => {
    const rows = [makeRow('2026-02-30', 'cls-a'), makeRow('2026-07-10', 'cls-a')];
    expect(listAttendanceMonths(rows)).toEqual(['2026-07']);
  });
});

// --- buildAttendanceMonthGrid ---

const TODAY = '2026-07-17';

describe('buildAttendanceMonthGrid', () => {
  it('returns [] for a calendar-invalid month', () => {
    expect(buildAttendanceMonthGrid([], '2026-13', TODAY)).toEqual([]);
  });

  it('grid starts on Monday', () => {
    // July 2026: first day is Wednesday; Monday-first week starts 2026-06-29
    const grid = buildAttendanceMonthGrid([], '2026-07', TODAY);
    expect(grid[0].iso).toBe('2026-06-29');
  });

  it('grid ends on Sunday', () => {
    // July 2026 ends on Friday July 31; the Monday-first last week ends Sunday August 2
    const grid = buildAttendanceMonthGrid([], '2026-07', TODAY);
    expect(grid[grid.length - 1].iso).toBe('2026-08-02');
  });

  it('leading/trailing cells are flagged inMonth: false', () => {
    const grid = buildAttendanceMonthGrid([], '2026-07', TODAY);
    // 2026-06-29 is before July
    const june29 = grid.find((c) => c.iso === '2026-06-29');
    expect(june29?.inMonth).toBe(false);
    // 2026-08-02 is after July (last trailing cell for July 2026)
    const aug2 = grid.find((c) => c.iso === '2026-08-02');
    expect(aug2?.inMonth).toBe(false);
  });

  it('flagged inMonth: true for days inside the month', () => {
    const grid = buildAttendanceMonthGrid([], '2026-07', TODAY);
    const jul1 = grid.find((c) => c.iso === '2026-07-01');
    expect(jul1?.inMonth).toBe(true);
  });

  it('isToday from injected todayIso, not the clock', () => {
    const grid = buildAttendanceMonthGrid([], '2026-07', '2026-07-10');
    const jul10 = grid.find((c) => c.iso === '2026-07-10');
    const jul17 = grid.find((c) => c.iso === '2026-07-17');
    expect(jul10?.isToday).toBe(true);
    expect(jul17?.isToday).toBe(false);
  });

  it('a leading/trailing cell that equals todayIso is still flagged isToday', () => {
    // June 29 is a leading out-of-month cell for July 2026
    // If today is June 29, it should still be flagged isToday
    const grid = buildAttendanceMonthGrid([], '2026-07', '2026-06-29');
    const jun29 = grid.find((c) => c.iso === '2026-06-29');
    expect(jun29?.inMonth).toBe(false);
    expect(jun29?.isToday).toBe(true);
  });

  it('coverage is future for days after todayIso', () => {
    const grid = buildAttendanceMonthGrid([], '2026-07', '2026-07-17');
    const jul20 = grid.find((c) => c.iso === '2026-07-20');
    expect(jul20?.coverage).toBe('future');
  });

  it('coverage is covered for past days within range', () => {
    const grid = buildAttendanceMonthGrid([], '2026-07', '2026-07-17');
    const jul10 = grid.find((c) => c.iso === '2026-07-10');
    expect(jul10?.coverage).toBe('covered');
  });

  it('coverage is outside_range when day is before range.from', () => {
    const grid = buildAttendanceMonthGrid([], '2026-07', '2026-07-17', {
      from: '2026-07-10',
    });
    const jul05 = grid.find((c) => c.iso === '2026-07-05');
    expect(jul05?.coverage).toBe('outside_range');
  });

  it('coverage is outside_range when day is after range.to', () => {
    const grid = buildAttendanceMonthGrid([], '2026-07', '2026-07-17', {
      from: '2026-07-01',
      to: '2026-07-15',
    });
    const jul16 = grid.find((c) => c.iso === '2026-07-16');
    expect(jul16?.coverage).toBe('outside_range');
  });

  it('future takes precedence over outside_range when both apply', () => {
    // Day is in the future AND outside range.to
    const grid = buildAttendanceMonthGrid([], '2026-07', '2026-07-10', {
      from: '2026-07-01',
      to: '2026-07-08', // to before today
    });
    // July 12 is future (>2026-07-10) and also outside range (>2026-07-08)
    const jul12 = grid.find((c) => c.iso === '2026-07-12');
    expect(jul12?.coverage).toBe('future');
  });

  it('a reversed range is normalized before coverage is computed', () => {
    // from=2026-07-20, to=2026-07-05 => swapped to from=2026-07-05, to=2026-07-20.
    // todayIso is pinned past the whole month so "future" never masks the
    // outside_range/covered distinction this test is isolating.
    const rows = [makeRow('2026-07-12', 'cls-a')];
    const grid = buildAttendanceMonthGrid(rows, '2026-07', '2026-07-31', {
      from: '2026-07-20',
      to: '2026-07-05',
    });
    const jul12 = grid.find((c) => c.iso === '2026-07-12');
    expect(jul12?.coverage).toBe('covered');
    expect(jul12?.sessions).toHaveLength(1);

    expect(grid.find((c) => c.iso === '2026-07-04')?.coverage).toBe('outside_range');
    expect(grid.find((c) => c.iso === '2026-07-21')?.coverage).toBe('outside_range');
    expect(grid.find((c) => c.iso === '2026-07-05')?.coverage).toBe('covered');
    expect(grid.find((c) => c.iso === '2026-07-20')?.coverage).toBe('covered');
  });

  it('several classes on one day → several sessions in one cell', () => {
    const rows = [
      makeRow('2026-07-10', 'cls-a'),
      makeRow('2026-07-10', 'cls-b', 'absent', { absentWithPermission: true }),
    ];
    const grid = buildAttendanceMonthGrid(rows, '2026-07', TODAY);
    const cell = grid.find((c) => c.iso === '2026-07-10');
    expect(cell?.sessions).toHaveLength(2);
  });

  it('isMakeup from row.source', () => {
    const rows = [makeRow('2026-07-10', 'cls-a', 'present', { source: 'makeup' })];
    const grid = buildAttendanceMonthGrid(rows, '2026-07', TODAY);
    const cell = grid.find((c) => c.iso === '2026-07-10');
    expect(cell?.sessions[0].isMakeup).toBe(true);
  });

  it('unmarked rows produce a chip, not an empty cell', () => {
    const rows = [makeRow('2026-07-10', 'cls-a', 'unmarked')];
    const grid = buildAttendanceMonthGrid(rows, '2026-07', TODAY);
    const cell = grid.find((c) => c.iso === '2026-07-10');
    expect(cell?.sessions).toHaveLength(1);
    expect(cell?.sessions[0].statusKey).toBe('unmarked');
  });

  it('statusKey uses classifyStudentAttendanceRow (absent split)', () => {
    const rows = [
      makeRow('2026-07-10', 'cls-a', 'absent', { absentWithPermission: true }),
      makeRow('2026-07-11', 'cls-a', 'absent', { absentWithPermission: false }),
    ];
    const grid = buildAttendanceMonthGrid(rows, '2026-07', TODAY);
    const cell10 = grid.find((c) => c.iso === '2026-07-10');
    const cell11 = grid.find((c) => c.iso === '2026-07-11');
    expect(cell10?.sessions[0].statusKey).toBe('absent_with_permission');
    expect(cell11?.sessions[0].statusKey).toBe('absent_without_permission');
  });

  it('shape-valid but calendar-invalid row date is skipped without throwing', () => {
    const rows = [makeRow('2026-02-30', 'cls-a')];
    expect(() => buildAttendanceMonthGrid(rows, '2026-02', TODAY)).not.toThrow();
    const grid = buildAttendanceMonthGrid(rows, '2026-02', TODAY);
    // No cell should have a session for that invalid date
    const hasSessions = grid.some((c) => c.sessions.length > 0);
    expect(hasSessions).toBe(false);
  });
});

// --- resolveSelectedMonth ---

describe('resolveSelectedMonth', () => {
  it('returns null for empty available', () => {
    expect(resolveSelectedMonth([], null)).toBeNull();
    expect(resolveSelectedMonth([], '2026-07')).toBeNull();
  });

  it('keeps selected month if still available', () => {
    expect(resolveSelectedMonth(['2026-05', '2026-07'], '2026-05')).toBe('2026-05');
  });

  it('falls back to last available month when selected is no longer available', () => {
    expect(resolveSelectedMonth(['2026-05', '2026-07'], '2026-06')).toBe('2026-07');
  });

  it('falls back to last available month when selected is null', () => {
    expect(resolveSelectedMonth(['2026-05', '2026-07'], null)).toBe('2026-07');
  });
});

describe('ineligible session rendering', () => {
  it('maps a not_enrolled row to its own calendar status key', () => {
    const grid = buildAttendanceMonthGrid(
      [
        {
          date: '2026-03-02',
          classId: 'class-1',
          termKey: 'class-1::current',
          status: 'not_enrolled',
          absentWithPermission: false,
          minutesLate: 0,
          source: 'scheduled',
        },
      ],
      '2026-03',
      '2026-03-31'
    );
    const cell = grid.find((c) => c.iso === '2026-03-02');
    expect(cell?.sessions[0].statusKey).toBe('not_enrolled');
  });

  it('maps an on_leave row to its own calendar status key', () => {
    const grid = buildAttendanceMonthGrid(
      [
        {
          date: '2026-03-23',
          classId: 'class-1',
          termKey: 'class-1::current',
          status: 'on_leave',
          absentWithPermission: false,
          minutesLate: 0,
          source: 'scheduled',
        },
      ],
      '2026-03',
      '2026-03-31'
    );
    const cell = grid.find((c) => c.iso === '2026-03-23');
    expect(cell?.sessions[0].statusKey).toBe('on_leave');
  });
});
