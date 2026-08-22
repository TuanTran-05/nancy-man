import {
  calculateStudentAttendanceSummary,
  type AttendanceReportRow,
  type AttendanceSummary,
} from '../../../shared/studentAttendanceReport';
import {
  calculateStudentFinanceSummary,
  type FinanceSummary,
} from '../../../shared/studentFinanceReport';
import type {
  StudentAdminReportResponse,
  StudentAttendanceReportRow,
  StudentLedgerReportRow,
  StudentTimelineSegment,
} from '../api/studentAdminReportApi';
import type { StudentCourseFinanceSummary } from '../../../shared/accountingStudentFinance';

/** Sentinel for "no narrowing" in either dropdown. */
export const ALL = 'all' as const;

/**
 * The course selection is a termKey (`classId::termId`), never a bare termId:
 * every class has a course with termId 'current', so termId alone collides
 * across classes when the class filter is ALL.
 */
export type ReportFilter = {
  classId: string | typeof ALL;
  termKey: string | typeof ALL;
  from?: string;
  to?: string;
};

export type FilteredReport = {
  segments: StudentTimelineSegment[];
  attendanceRows: StudentAttendanceReportRow[];
  ledgers: StudentLedgerReportRow[];
  courseSummaries: StudentCourseFinanceSummary[];
  attendanceSummary: AttendanceSummary;
  financeSummary: FinanceSummary;
  /**
   * 'mixed' when the selection spans both modes — the UI must not claim either.
   * 'none' when it spans no course at all, which is not the same as 'mixed':
   * there is no calculation to describe, so the UI must stay silent.
   */
  attendanceMode: 'expected' | 'marked_only' | 'mixed' | 'none';
};

export type FilterClassOption = {
  classId: string;
  className: string;
  classMissing: boolean;
};

/** Distinct classes in timeline order — the first dropdown. */
export function listFilterClasses(timeline: StudentTimelineSegment[]): FilterClassOption[] {
  const seen = new Set<string>();
  const options: FilterClassOption[] = [];
  for (const segment of timeline) {
    if (seen.has(segment.classId)) continue;
    seen.add(segment.classId);
    options.push({
      classId: segment.classId,
      className: segment.className,
      classMissing: segment.classMissing,
    });
  }
  return options;
}

/** Courses available for the chosen class — the second, dependent dropdown. */
export function listFilterTerms(
  timeline: StudentTimelineSegment[],
  classId: string | typeof ALL
): StudentTimelineSegment[] {
  if (classId === ALL) return timeline;
  return timeline.filter((segment) => segment.classId === classId);
}

function selectSegments(
  timeline: StudentTimelineSegment[],
  filter: ReportFilter
): StudentTimelineSegment[] {
  return timeline.filter((segment) => {
    if (filter.classId !== ALL && segment.classId !== filter.classId) return false;
    if (filter.termKey !== ALL && segment.key !== filter.termKey) return false;
    return true;
  });
}

function withinRange(date: string, filter: ReportFilter): boolean {
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  return true;
}

function resolveMode(segments: StudentTimelineSegment[]): FilteredReport['attendanceMode'] {
  if (segments.length === 0) return 'none';
  const modes = new Set(segments.map((s) => s.attendanceMode));
  if (modes.size === 1) return [...modes][0];
  return 'mixed';
}

/**
 * Narrow a full-history report to the current filter and recompute summaries.
 * Rows are pre-tagged with `termKey` by the read channel, so this never
 * re-derives course attribution.
 */
export function filterStudentReport(
  report: StudentAdminReportResponse,
  filter: ReportFilter,
  todayStr: string
): FilteredReport {
  // Normalise a reversed date range (swap) rather than silently matching nothing.
  const range =
    filter.from && filter.to && filter.from > filter.to
      ? { ...filter, from: filter.to, to: filter.from }
      : filter;

  const segments = selectSegments(report.timeline, range);
  const keys = new Set(segments.map((s) => s.key));

  const attendanceRows = report.attendanceRows.filter(
    (row) => keys.has(row.termKey) && withinRange(row.date, range)
  );

  const ledgers = report.ledgers.filter((ledger) => {
    if (!ledger.termKey || !keys.has(ledger.termKey)) return false;
    // A ledger belongs to a course, not a day: keep it when its course overlaps
    // the date range rather than filtering on dueDate, which may be unset.
    if (!range.from && !range.to) return true;
    const start = ledger.termStart || '';
    const end = ledger.termEnd || '9999-12-31';
    if (range.to && start && start > range.to) return false;
    if (range.from && end < range.from) return false;
    return true;
  });
  const courseSummaries = (report.courseSummaries || []).filter((course) =>
    keys.has(course.termKey)
  );

  const summaryRows: AttendanceReportRow[] = attendanceRows.map((row) => ({
    date: row.date,
    classId: row.classId,
    status: row.status,
    absentWithPermission: row.absentWithPermission,
    minutesLate: row.minutesLate,
    note: null,
    source: row.source,
  }));

  return {
    segments,
    attendanceRows,
    ledgers,
    courseSummaries,
    attendanceSummary: calculateStudentAttendanceSummary(summaryRows),
    financeSummary: calculateStudentFinanceSummary(
      ledgers.map((l) => ({
        id: l.id,
        amount: l.grossAmount,
        discountTotal: l.discount,
        paidTotal: l.paid,
        dueDate: l.dueDate,
        classId: l.classId ?? undefined,
      })),
      todayStr
    ),
    attendanceMode: resolveMode(segments),
  };
}
