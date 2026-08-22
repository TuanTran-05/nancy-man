/**
 * Domain module: is a student on the hook for this session?
 * Pure functions — no DocumentStore, no side-effects.
 *
 * Three answers:
 *   eligible     — counts toward attendance rate
 *   not_enrolled — session predates the student joining that course
 *   on_leave     — session falls inside an approved leave window
 *
 * The last two are displayed but excluded from the attendance denominator.
 */

import type { StudentCourseJoin, StudentLeavePeriod } from './studentEnrollmentWindows.js';

export type SessionEligibility = 'eligible' | 'not_enrolled' | 'on_leave';

export type EligibilityResolver = (date: string, classId: string) => SessionEligibility;

/**
 * A canonical enrollment window from `student_course_enrollments`.
 * Has higher precedence than legacy `courseJoins` and centre-wide `enrollmentDate`.
 * `endedAt` is inclusive: dates after it are `not_enrolled`.
 */
export type CanonicalCourseEnrollmentWindow = StudentCourseJoin & {
  endedAt?: string | null;
};

export type EligibilityContext = {
  /**
   * Exact canonical enrollment windows from `student_course_enrollments`.
   * These have the highest precedence and override courseJoins and enrollmentDate
   * for the matching class+term pair.
   */
  canonicalCourseEnrollments?: CanonicalCourseEnrollmentWindow[];
  courseJoins: StudentCourseJoin[];
  leavePeriods: StudentLeavePeriod[];
  /** Maps a (classId, date) to that course's startDate, or null outside any course. */
  resolveTermStart: (classId: string, date: string) => string | null;
  /**
   * Centre-wide join date, used ONLY as a floor for courses with no join entry.
   * This is what today's `buildExpectedStudentSessions` filter already uses, and
   * it is the only signal covering assignment paths that never stamp courseJoins
   * (admissions/handlers/createTrial.ts:81). Omitting it would regress those
   * students into phantom blank rows.
   */
  enrollmentDate?: string | null;
};

/**
 * Build a resolver closed over one student's history.
 *
 * Precedence, most specific first:
 *   1. An exact canonical enrollment window (from student_course_enrollments)
 *   2. An exact courseJoins entry
 *   3. The enrollmentDate floor
 *   4. Eligible (missing evidence is never treated as absence)
 *
 * For leave periods: `from <= date < until` (until is the eligible return date).
 * An open leave (until === null) covers everything from `from` onward.
 */
export function createEligibilityResolver(ctx: EligibilityContext): EligibilityResolver {
  // Build enrollment map: start with legacy courseJoins, then let canonical
  // enrollments override for the same class+term key.
  const enrollmentByCourse = new Map<
    string,
    { joinedAt: string; endedAt: string | null }
  >();
  for (const join of ctx.courseJoins) {
    const key = `${join.classId}|${join.termStart}`;
    const existing = enrollmentByCourse.get(key);
    // Earliest join wins if a course somehow accumulated duplicates.
    if (existing === undefined || join.joinedAt < existing.joinedAt) {
      enrollmentByCourse.set(key, { joinedAt: join.joinedAt, endedAt: null });
    }
  }
  // Canonical enrollments override legacy courseJoins for the same class+term.
  for (const enrollment of ctx.canonicalCourseEnrollments ?? []) {
    enrollmentByCourse.set(`${enrollment.classId}|${enrollment.termStart}`, {
      joinedAt: enrollment.joinedAt,
      endedAt: enrollment.endedAt ?? null,
    });
  }

  const leavesByClass = new Map<string, StudentLeavePeriod[]>();
  for (const period of ctx.leavePeriods) {
    const list = leavesByClass.get(period.classId) ?? [];
    list.push(period);
    leavesByClass.set(period.classId, list);
  }

  const floor = ctx.enrollmentDate || null;

  return (date: string, classId: string): SessionEligibility => {
    const termStart = ctx.resolveTermStart(classId, date);
    const enrollment = termStart
      ? enrollmentByCourse.get(`${classId}|${termStart}`)
      : undefined;

    // not_enrolled outranks on_leave: you cannot take leave from a course you
    // had not yet joined, and the two carry different money semantics.
    if (enrollment !== undefined) {
      // An exact entry is authoritative in BOTH directions — it can also declare
      // a student eligible earlier than their centre-wide enrollmentDate, which
      // is what a re-enrolled student looks like. Do not consult the floor here.
      if (date < enrollment.joinedAt) return 'not_enrolled';
      if (enrollment.endedAt && date > enrollment.endedAt) return 'not_enrolled';
    } else if (floor && date < floor) {
      return 'not_enrolled';
    }

    for (const period of leavesByClass.get(classId) ?? []) {
      const startsBy = period.from <= date;
      // `until` is the eligible return date (exclusive upper bound).
      // An open leave (until === null) covers everything from `from` onward.
      const endsAfter = period.until === null || date < period.until;
      if (startsBy && endsAfter) return 'on_leave';
    }

    return 'eligible';
  };
}
