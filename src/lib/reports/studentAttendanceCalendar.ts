/**
 * Domain module: student attendance month calendar.
 * Pure functions — no React, no ambient clock, no side-effects.
 * Mirrors the pattern of studentReportFilter.ts beside it.
 */

import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  parseISO,
  isValid,
  format,
  isSameMonth,
} from 'date-fns';
import { classifyStudentAttendanceRow } from '../../../shared/studentAttendanceReport';
import type { StudentAttendanceReportRow } from '../api/studentAdminReportApi';

export type CalendarStatusKey =
  | 'present'
  | 'late'
  | 'absent_with_permission'
  | 'absent_without_permission'
  | 'unmarked'
  /** Rendered dimmed; excluded from the attendance rate. */
  | 'not_enrolled'
  | 'on_leave';

export type CalendarSession = {
  classId: string;
  statusKey: CalendarStatusKey;
  minutesLate: number;
  isMakeup: boolean; // row.source === 'makeup'
};

/** See "expected mode is not uniformly trustworthy" in the spec. */
export type CalendarCoverage = 'covered' | 'future' | 'outside_range';

export type CalendarCell = {
  iso: string; // YYYY-MM-DD
  day: number; // 1..31
  inMonth: boolean;
  isToday: boolean;
  coverage: CalendarCoverage;
  sessions: CalendarSession[]; // empty = see the mode table, gated by coverage
};

export type CalendarDateRange = { from?: string; to?: string };

/** Module-private: normalize a reversed from/to range. */
function normalizeRange(range?: CalendarDateRange): CalendarDateRange | undefined {
  if (!range) return undefined;
  const { from, to } = range;
  if (from && to && from > to) {
    return { from: to, to: from };
  }
  return range;
}

/** YYYY-MM-DD shape check (does not guarantee calendar validity). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE_RE.test(date)) return false;
  const parsed = parseISO(date);
  return isValid(parsed);
}

/**
 * Distinct 'YYYY-MM' present in rows, ascending.
 * Empty when rows is empty.
 * Excludes any row whose date is shape-invalid or calendar-invalid (e.g. '2026-02-30').
 */
export function listAttendanceMonths(rows: StudentAttendanceReportRow[]): string[] {
  const months = new Set<string>();
  for (const row of rows) {
    if (!isValidIsoDate(row.date)) continue;
    const month = row.date.slice(0, 7); // 'YYYY-MM'
    months.add(month);
  }
  return [...months].sort();
}

/** Compute per-cell coverage. */
function computeCoverage(
  iso: string,
  todayIso: string,
  normalizedRange: CalendarDateRange | undefined
): CalendarCoverage {
  // Future takes precedence over outside_range when both apply.
  if (iso > todayIso) return 'future';
  if (normalizedRange?.from && iso < normalizedRange.from) return 'outside_range';
  if (normalizedRange?.to && iso > normalizedRange.to) return 'outside_range';
  return 'covered';
}

/**
 * Monday-first grid covering the whole month, including leading/trailing days.
 * todayIso is injected — never read from the clock.
 * range is the admin's optional date-range filter (raw, possibly reversed).
 *
 * Returns [] when month is calendar-invalid.
 */
export function buildAttendanceMonthGrid(
  rows: StudentAttendanceReportRow[],
  month: string, // 'YYYY-MM'
  todayIso: string,
  range?: CalendarDateRange
): CalendarCell[] {
  // Validate month
  const monthDateStr = `${month}-01`;
  if (!isValidIsoDate(monthDateStr)) return [];

  const normalized = normalizeRange(range);

  // Index rows by date for quick lookup
  const byDate = new Map<string, StudentAttendanceReportRow[]>();
  for (const row of rows) {
    if (!isValidIsoDate(row.date)) continue;
    const existing = byDate.get(row.date) ?? [];
    existing.push(row);
    byDate.set(row.date, existing);
  }

  const monthStart = startOfMonth(parseISO(monthDateStr));
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return days.map((day) => {
    const iso = format(day, 'yyyy-MM-dd');
    const inMonth = isSameMonth(day, monthStart);
    const isToday = iso === todayIso;
    const coverage = computeCoverage(iso, todayIso, normalized);

    const dayRows = byDate.get(iso) ?? [];
    const sessions: CalendarSession[] = dayRows.map((row) => {
      const statusKey = classifyStudentAttendanceRow({
        date: row.date,
        classId: row.classId,
        status: row.status,
        absentWithPermission: row.absentWithPermission,
        minutesLate: row.minutesLate,
        note: null,
        source: row.source,
      }) as CalendarStatusKey;

      return {
        classId: row.classId,
        statusKey,
        minutesLate: row.minutesLate,
        isMakeup: row.source === 'makeup',
      };
    });

    return { iso, day: day.getDate(), inMonth, isToday, coverage, sessions };
  });
}

/**
 * Clamp a selection to the months that still exist after a filter change.
 * Falls back to the last available month.
 * Returns null when available is empty.
 */
export function resolveSelectedMonth(available: string[], selected: string | null): string | null {
  if (available.length === 0) return null;
  if (selected !== null && available.includes(selected)) return selected;
  return available[available.length - 1];
}
