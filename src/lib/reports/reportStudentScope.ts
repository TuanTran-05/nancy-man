import type { StudentIdentityRecord } from '../student/currentRecords';
import { matchesStudentStatusFilter } from '../student/statusFilters';

export type ReportStudentScope<T> = {
  /** The canonical roster the whole report is computed from. */
  roster: T[];
  /**
   * Ids of the roster. Attendance, submissions and evaluations are scoped with this
   * rather than by class, so every rate on the report shares one denominator
   * population with the headcount.
   */
  studentIds: Set<string>;
  total: number;
  learning: number;
  trial: number;
  onLeave: number;
  /** Kept for the status breakdown only - dropped students are not in the roster. */
  dropped: number;
};

/**
 * Reports used to scope students with `students.filter(s => activeClassIds.has(s.classId))`,
 * which both double counted duplicate identity records and hid every student whose class
 * was archived or unset. That made the report headcount disagree with the students
 * directory. Both surfaces now take the rows the server returned and apply the same
 * status filter, so the two agree without either of them re-deciding which physical
 * rows are the same child.
 */
export function buildReportStudentScope<T extends StudentIdentityRecord>(
  students: T[],
  classId?: string
): ReportStudentScope<T> {
  const scopedStudents = classId
    ? students.filter((student) => student.classId === classId)
    : students;
  const roster = scopedStudents.filter(
    (student) =>
      matchesStudentStatusFilter(student, 'active') ||
      matchesStudentStatusFilter(student, 'trial') ||
      matchesStudentStatusFilter(student, 'on_leave')
  );

  let learning = 0;
  let trial = 0;
  let onLeave = 0;
  for (const student of roster) {
    if (matchesStudentStatusFilter(student, 'active')) learning += 1;
    if (matchesStudentStatusFilter(student, 'trial')) trial += 1;
    if (matchesStudentStatusFilter(student, 'on_leave')) onLeave += 1;
  }

  const dropped = scopedStudents.filter((student) =>
    matchesStudentStatusFilter(student, 'dropped')
  ).length;

  const studentIds = new Set(roster.map((student) => String(student.id || '')).filter(Boolean));

  return { roster, studentIds, total: roster.length, learning, trial, onLeave, dropped };
}
