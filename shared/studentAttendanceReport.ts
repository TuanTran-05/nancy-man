/**
 * Domain module: student attendance report calculations.
 * Pure functions — no DocumentStore, no side-effects.
 */

import type { SessionEligibility, EligibilityResolver } from './studentSessionEligibility.js';

export type AttendanceStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'unmarked'
  /** Session predates the student joining this course. Not counted. */
  | 'not_enrolled'
  /** Session falls inside an approved leave window. Not counted. */
  | 'on_leave';

export type AttendanceRecord = {
  date: string; // YYYY-MM-DD
  classId: string;
  status?: string; // present | late | absent
  isVoided?: boolean;
  permission?: boolean;
  minutesLate?: number;
  note?: string;
};

export type ExpectedSession = {
  date: string; // YYYY-MM-DD
  classId: string;
  source: 'scheduled' | 'makeup';
  eligibility: SessionEligibility;
};

export type AttendanceReportRow = {
  date: string;
  classId: string;
  status: AttendanceStatus;
  absentWithPermission: boolean;
  minutesLate: number;
  note: string | null;
  source: 'scheduled' | 'makeup';
};

export type AttendanceSummary = {
  /** Sessions the student was actually on the hook for. Excludes the two below. */
  expectedSessions: number;
  markedSessions: number;
  present: number;
  absentWithPermission: number;
  absentWithoutPermission: number;
  late: number;
  unmarked: number;
  notEnrolledSessions: number;
  onLeaveSessions: number;
  /** null when expectedSessions === 0 */
  attendanceRate: number | null;
};

/**
 * Merge raw eligibility with a (possibly missing or voided) attendance record
 * into a single display status.
 *
 * Rules (in precedence order):
 *   1. A non-voided real record (`present`, `absent`, `late`) always wins.
 *   2. Voided records are treated as absent.
 *   3. Ineligible (not_enrolled / on_leave) cells with no real record show the
 *      eligibility label.
 *   4. Eligible cells with no record show `unmarked`.
 */
export function resolveAttendanceCellStatus(input: {
  attendance?: AttendanceRecord | null;
  eligibility: SessionEligibility;
}): AttendanceStatus {
  const rawStatus = input.attendance?.isVoided === true ? undefined : input.attendance?.status;
  if (rawStatus === 'present' || rawStatus === 'absent' || rawStatus === 'late') return rawStatus;
  if (input.eligibility === 'not_enrolled') return 'not_enrolled';
  if (input.eligibility === 'on_leave') return 'on_leave';
  return 'unmarked';
}

/**
 * Build the unique set of expected sessions for a student.
 * Deduplicates by classId + date (actual class_sessions win over
 * weekly-schedule generated dates).
 *
 * Ineligible sessions are RETAINED and labelled, not dropped: the report
 * renders them dimmed so a gap in the calendar has a visible reason. Excluding
 * them from the attendance rate is the summary's job, not this function's.
 *
 * @param scheduledDates      Dates generated from weekly schedule (already filtered
 *                            for holidays, class date-range, and future-date exclusion)
 * @param makeupSessions      Makeup / rescheduled session dates with their classId
 * @param cancelledDates      Set of "classId|date" keys for cancelled sessions
 * @param resolveEligibility  Optional; every session defaults to 'eligible'
 */
export function buildExpectedStudentSessions(
  scheduledDates: { date: string; classId: string }[],
  makeupSessions: { date: string; classId: string }[],
  cancelledDates: Set<string>,
  resolveEligibility?: EligibilityResolver | null,
): ExpectedSession[] {
  const seen = new Set<string>();
  const result: ExpectedSession[] = [];

  const addIfNew = (date: string, classId: string, source: ExpectedSession['source']) => {
    const key = `${classId}|${date}`;
    if (cancelledDates.has(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      date,
      classId,
      source,
      eligibility: resolveEligibility ? resolveEligibility(date, classId) : 'eligible',
    });
  };

  for (const s of scheduledDates) addIfNew(s.date, s.classId, 'scheduled');
  for (const m of makeupSessions) addIfNew(m.date, m.classId, 'makeup');

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Merge expected sessions with raw attendance records.
 * Returns one row per expected session; extra attendance records
 * (no matching expected session) are ignored.
 */
export function mergeExpectedSessionsWithAttendance(
  expected: ExpectedSession[],
  attendance: AttendanceRecord[],
): AttendanceReportRow[] {
  // Index non-voided attendance by classId|date
  const index = new Map<string, AttendanceRecord>();
  for (const rec of attendance) {
    if (rec.isVoided) continue;
    const key = `${rec.classId}|${rec.date}`;
    index.set(key, rec);
  }

  return expected.map((session) => {
    const key = `${session.classId}|${session.date}`;
    const rec = index.get(key);

    // Use the shared cell merge helper: real non-voided record always wins.
    if (!rec) {
      const status = resolveAttendanceCellStatus({ attendance: null, eligibility: session.eligibility });
      return {
        date: session.date,
        classId: session.classId,
        status,
        absentWithPermission: false,
        minutesLate: 0,
        note: null,
        source: session.source,
      };
    }

    const rawStatus = rec.status ?? '';
    let status: AttendanceStatus;
    if (rawStatus === 'present') {
      status = 'present';
    } else if (rawStatus === 'late') {
      status = 'late';
    } else if (rawStatus === 'absent') {
      status = 'absent';
    } else {
      status = 'unmarked';
    }

    return {
      date: session.date,
      classId: session.classId,
      status,
      absentWithPermission: status === 'absent' ? Boolean(rec.permission) : false,
      minutesLate: status === 'late' ? (rec.minutesLate ?? 0) : 0,
      note: typeof rec.note === 'string' && rec.note ? rec.note : null,
      source: session.source,
    };
  });
}

/**
 * Aggregate a list of attendance rows into a summary object.
 *
 * Formula:
 *   attended = present + late
 *   attendanceRate = expectedSessions > 0 ? attended / expectedSessions * 100 : null
 */
export function calculateStudentAttendanceSummary(rows: AttendanceReportRow[]): AttendanceSummary {
  let present = 0;
  let absentWithPermission = 0;
  let absentWithoutPermission = 0;
  let late = 0;
  let unmarked = 0;
  let notEnrolledSessions = 0;
  let onLeaveSessions = 0;

  for (const row of rows) {
    switch (row.status) {
      case 'present':
        present++;
        break;
      case 'late':
        late++;
        break;
      case 'absent':
        if (row.absentWithPermission) absentWithPermission++;
        else absentWithoutPermission++;
        break;
      case 'unmarked':
        unmarked++;
        break;
      case 'not_enrolled':
        notEnrolledSessions++;
        break;
      case 'on_leave':
        onLeaveSessions++;
        break;
    }
  }

  // Spec D6: sessions the student was never on the hook for must not drag the
  // rate down. A mid-course joiner is not 50% absent.
  const expectedSessions = rows.length - notEnrolledSessions - onLeaveSessions;
  const markedSessions = present + late + absentWithPermission + absentWithoutPermission;
  const attended = present + late;
  const attendanceRate = expectedSessions > 0 ? (attended / expectedSessions) * 100 : null;

  return {
    expectedSessions,
    markedSessions,
    present,
    absentWithPermission,
    absentWithoutPermission,
    late,
    unmarked,
    notEnrolledSessions,
    onLeaveSessions,
    attendanceRate,
  };
}

/**
 * Classify a single attendance row for display purposes.
 * Returns a human-readable label key.
 */
export function classifyStudentAttendanceRow(row: AttendanceReportRow): string {
  switch (row.status) {
    case 'present':
      return 'present';
    case 'late':
      return 'late';
    case 'absent':
      return row.absentWithPermission ? 'absent_with_permission' : 'absent_without_permission';
    case 'unmarked':
      return 'unmarked';
    case 'not_enrolled':
      return 'not_enrolled';
    case 'on_leave':
      return 'on_leave';
    default:
      return 'unmarked';
  }
}
