import { describe, expect, it } from 'vitest';
import { createEligibilityResolver } from './studentSessionEligibility.js';
import type { StudentCourseJoin, StudentLeavePeriod } from './studentEnrollmentWindows.js';
import type { CanonicalCourseEnrollmentWindow } from './studentSessionEligibility.js';

/** Two courses of class-1: course A from 2026-01-05, course B from 2026-06-01. */
function termStartFor(classId: string, date: string): string | null {
  if (classId !== 'class-1') return null;
  if (date >= '2026-06-01') return '2026-06-01';
  if (date >= '2026-01-05') return '2026-01-05';
  return null;
}

function build(
  courseJoins: StudentCourseJoin[] = [],
  leavePeriods: StudentLeavePeriod[] = [],
  enrollmentDate: string | null = null,
) {
  return createEligibilityResolver({
    courseJoins,
    leavePeriods,
    resolveTermStart: termStartFor,
    enrollmentDate,
  });
}

describe('createEligibilityResolver', () => {
  it('labels a session before joinedAt as not_enrolled', () => {
    const resolve = build([
      { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' },
    ]);
    expect(resolve('2026-01-20', 'class-1')).toBe('not_enrolled');
  });

  it('labels a session on joinedAt itself as eligible', () => {
    const resolve = build([
      { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' },
    ]);
    expect(resolve('2026-02-10', 'class-1')).toBe('eligible');
  });

  it('labels a session after joinedAt as eligible', () => {
    const resolve = build([
      { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' },
    ]);
    expect(resolve('2026-03-01', 'class-1')).toBe('eligible');
  });

  it('returns eligible when the student has no join entry for that course', () => {
    const resolve = build([]);
    expect(resolve('2026-01-20', 'class-1')).toBe('eligible');
  });

  // Spec D3: returning to a previous class in a later course must not
  // retroactively label the earlier course as not_enrolled.
  it('scopes a join entry to its own course', () => {
    const resolve = build([
      { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-01-05' },
      { classId: 'class-1', termStart: '2026-06-01', joinedAt: '2026-07-15' },
    ]);
    expect(resolve('2026-02-10', 'class-1')).toBe('eligible');      // course A, joined at start
    expect(resolve('2026-06-10', 'class-1')).toBe('not_enrolled');  // course B, joined later
    expect(resolve('2026-07-20', 'class-1')).toBe('eligible');      // course B, after joining
  });

  it('labels a session inside a closed leave period as on_leave', () => {
    const resolve = build([], [
      { from: '2026-03-02', until: '2026-03-30', classId: 'class-1' },
    ]);
    expect(resolve('2026-03-15', 'class-1')).toBe('on_leave');
  });

  it('includes leave start and treats until as the eligible return date', () => {
    const resolve = build([], [
      { from: '2026-03-02', until: '2026-03-30', classId: 'class-1' },
    ]);
    expect(resolve('2026-03-02', 'class-1')).toBe('on_leave');
    expect(resolve('2026-03-29', 'class-1')).toBe('on_leave');
    expect(resolve('2026-03-30', 'class-1')).toBe('eligible');
    expect(resolve('2026-03-01', 'class-1')).toBe('eligible');
  });

  it('treats an open leave period as covering everything from `from` onward', () => {
    const resolve = build([], [
      { from: '2026-05-10', until: null, classId: 'class-1' },
    ]);
    expect(resolve('2026-05-09', 'class-1')).toBe('eligible');
    expect(resolve('2026-09-01', 'class-1')).toBe('on_leave');
  });

  it('handles two disjoint leave periods', () => {
    const resolve = build([], [
      { from: '2026-03-02', until: '2026-03-30', classId: 'class-1' },
      { from: '2026-05-10', until: '2026-05-20', classId: 'class-1' },
    ]);
    expect(resolve('2026-03-15', 'class-1')).toBe('on_leave');
    expect(resolve('2026-04-15', 'class-1')).toBe('eligible');
    expect(resolve('2026-05-15', 'class-1')).toBe('on_leave');
  });

  it('ignores a leave period belonging to a different class', () => {
    const resolve = build([], [
      { from: '2026-03-02', until: '2026-03-30', classId: 'class-2' },
    ]);
    expect(resolve('2026-03-15', 'class-1')).toBe('eligible');
  });

  it('prefers not_enrolled over on_leave when both apply', () => {
    const resolve = build(
      [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' }],
      [{ from: '2026-01-01', until: '2026-12-31', classId: 'class-1' }],
    );
    expect(resolve('2026-01-20', 'class-1')).toBe('not_enrolled');
  });

  it('returns eligible for a date that resolves to no course', () => {
    const resolve = build([
      { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' },
    ]);
    expect(resolve('2025-11-01', 'class-1')).toBe('eligible');
  });

  // The admissions path (createTrial.ts:81) never stamps courseJoins. Without
  // this floor a trial student created today shows phantom blank rows for every
  // session of the course so far — the regression this fallback exists to stop.
  it('falls back to enrollmentDate when the course has no join entry', () => {
    const resolve = build([], [], '2026-02-10');
    expect(resolve('2026-01-20', 'class-1')).toBe('not_enrolled');
    expect(resolve('2026-02-16', 'class-1')).toBe('eligible');
  });

  it('lets an exact join entry override the enrollmentDate floor in both directions', () => {
    const resolve = build(
      [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-01-05' }],
      [],
      '2026-02-10',
    );
    // Re-enrolled student: the course entry says they were here from day one.
    expect(resolve('2026-01-20', 'class-1')).toBe('eligible');
  });

  it('is fully eligible with neither a join entry nor an enrollmentDate', () => {
    expect(build([], [], null)('2020-01-01', 'class-1')).toBe('eligible');
  });

  it('lets an exact canonical enrollment override legacy join and enrollmentDate', () => {
    const resolve = createEligibilityResolver({
      canonicalCourseEnrollments: [
        {
          classId: 'class-1',
          termStart: '2026-01-05',
          joinedAt: '2026-02-10',
          endedAt: '2026-03-20',
        },
      ],
      courseJoins: [
        { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-01-05' },
      ],
      leavePeriods: [],
      enrollmentDate: '2026-03-01',
      resolveTermStart: () => '2026-01-05',
    });

    expect(resolve('2026-02-09', 'class-1')).toBe('not_enrolled');
    expect(resolve('2026-02-10', 'class-1')).toBe('eligible');
    expect(resolve('2026-03-20', 'class-1')).toBe('eligible');
    expect(resolve('2026-03-21', 'class-1')).toBe('not_enrolled');
  });
});

