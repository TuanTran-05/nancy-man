/**
 * Pure helpers that produce the next value of a student's courseJoins /
 * leavePeriods arrays. No DocumentStore access — callers write the result inside
 * their own transaction.
 *
 * DocumentStore has no atomic "append if absent" for object arrays, so these read
 * the prior value and return a whole replacement array. Every caller must
 * already hold the student doc inside a transaction.
 */

import {
  readCourseJoins,
  readLeavePeriods,
  type StudentCourseJoin,
  type StudentLeavePeriod,
} from '../../../../shared/studentEnrollmentWindows.js';

/**
 * Append a join entry unless that course already has one.
 *
 * Spec D3: keyed by (classId, termStart), never overwritten. A student who
 * leaves class A and returns for a later course gets a second entry; the first
 * one still describes the earlier course correctly.
 */
export function appendCourseJoin(
  before: Record<string, unknown>,
  entry: StudentCourseJoin
): StudentCourseJoin[] {
  const existing = readCourseJoins(before.courseJoins);
  const alreadyRecorded = existing.some(
    (join) => join.classId === entry.classId && join.termStart === entry.termStart
  );
  if (alreadyRecorded) return existing;
  return [...existing, entry];
}

/** Open a leave window. No-op when one is already open (guards double-submits). */
export function openLeavePeriod(
  before: Record<string, unknown>,
  period: StudentLeavePeriod
): StudentLeavePeriod[] {
  const existing = readLeavePeriods(before.leavePeriods);
  if (existing.some((p) => p.until === null)) return existing;
  return [...existing, period];
}

/**
 * Close every open window at `until`.
 *
 * `until` is the ACTUAL return date, which overrides any planned `plannedUntil`.
 * A student who planned four weeks off and came back after two owes attendance
 * for those two weeks.
 */
export function closeOpenLeavePeriods(
  before: Record<string, unknown>,
  until: string
): StudentLeavePeriod[] {
  return readLeavePeriods(before.leavePeriods).map((period) =>
    period.until === null ? { ...period, until } : period
  );
}
