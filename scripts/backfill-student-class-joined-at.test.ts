import { describe, expect, it } from 'vitest';
import { planCourseJoinBackfill, planOpenLeavePeriod } from './backfill-student-class-joined-at.js';

const CLASSES = [
  {
    id: 'class-1',
    startDate: '2026-01-05',
    endDate: '2026-03-27',
    daysOfWeek: [1],
    terms: [],
  },
];

/** Course 2026-01-05 has its first scheduled session on 2026-01-05. */
const firstScheduledDate = (classId: string, termStart: string) =>
  classId === 'class-1' && termStart === '2026-01-05' ? '2026-01-05' : null;

describe('planCourseJoinBackfill', () => {
  it('writes a join entry when the student first appears mid-course', () => {
    const plans = planCourseJoinBackfill({
      students: [{ id: 'student-1' }],
      attendance: [
        { studentId: 'student-1', classId: 'class-1', date: '2026-02-16' },
        { studentId: 'student-1', classId: 'class-1', date: '2026-02-23' },
      ],
      classes: CLASSES,
      firstScheduledDate,
    });
    expect(plans).toEqual([
      {
        studentId: 'student-1',
        joins: [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-16' }],
      },
    ]);
  });

  // A student present from day one needs no entry; the D3 fallback covers them.
  it('writes nothing when the student was there from the first session', () => {
    const plans = planCourseJoinBackfill({
      students: [{ id: 'student-1' }],
      attendance: [{ studentId: 'student-1', classId: 'class-1', date: '2026-01-05' }],
      classes: CLASSES,
      firstScheduledDate,
    });
    expect(plans).toEqual([]);
  });

  it('never overwrites an existing courseJoins entry', () => {
    const plans = planCourseJoinBackfill({
      students: [
        {
          id: 'student-1',
          courseJoins: [
            { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-01-19' },
          ],
        },
      ],
      attendance: [{ studentId: 'student-1', classId: 'class-1', date: '2026-02-16' }],
      classes: CLASSES,
      firstScheduledDate,
    });
    expect(plans).toEqual([]);
  });

  it('takes the earliest attendance date when rows are out of order', () => {
    const plans = planCourseJoinBackfill({
      students: [{ id: 'student-1' }],
      attendance: [
        { studentId: 'student-1', classId: 'class-1', date: '2026-03-02' },
        { studentId: 'student-1', classId: 'class-1', date: '2026-02-16' },
      ],
      classes: CLASSES,
      firstScheduledDate,
    });
    expect(plans[0].joins[0].joinedAt).toBe('2026-02-16');
  });

  it('skips students with no attendance at all', () => {
    const plans = planCourseJoinBackfill({
      students: [{ id: 'student-1' }],
      attendance: [],
      classes: CLASSES,
      firstScheduledDate,
    });
    expect(plans).toEqual([]);
  });

  it('ignores attendance for a class that no longer exists', () => {
    const plans = planCourseJoinBackfill({
      students: [{ id: 'student-1' }],
      attendance: [{ studentId: 'student-1', classId: 'ghost-class', date: '2026-02-16' }],
      classes: CLASSES,
      firstScheduledDate,
    });
    expect(plans).toEqual([]);
  });

  // A voided row is a retracted claim; it must not become evidence of a join.
  it('ignores voided attendance when picking the earliest date', () => {
    const plans = planCourseJoinBackfill({
      students: [{ id: 'student-1' }],
      attendance: [
        { studentId: 'student-1', classId: 'class-1', date: '2026-01-19', isVoided: true },
        { studentId: 'student-1', classId: 'class-1', date: '2026-02-16' },
      ],
      classes: CLASSES,
      firstScheduledDate,
    });
    expect(plans[0].joins[0].joinedAt).toBe('2026-02-16');
  });

  // Least evidence = least action. Writing here would be a pure guess.
  it('writes nothing when the course start cannot be determined', () => {
    const plans = planCourseJoinBackfill({
      students: [{ id: 'student-1' }],
      attendance: [{ studentId: 'student-1', classId: 'class-1', date: '2026-02-16' }],
      classes: CLASSES,
      firstScheduledDate: () => null,
    });
    expect(plans).toEqual([]);
  });
});

describe('planOpenLeavePeriod', () => {
  it('opens a period for a student currently on leave', () => {
    expect(
      planOpenLeavePeriod(
        {
          enrollmentStatus: 'on_leave',
          statusChangedAt: '2026-03-02T00:00:00.000Z',
          leaveUntil: '2026-03-30',
          classId: 'class-1',
        },
        '2026-07-18',
      ),
    ).toEqual({
      from: '2026-03-02',
      until: null,
      plannedUntil: '2026-03-30',
      classId: 'class-1',
    });
  });

  it('returns null for a student who is not on leave', () => {
    expect(planOpenLeavePeriod({ enrollmentStatus: 'active' }, '2026-07-18')).toBeNull();
  });

  it('does not open a second period when one is already open', () => {
    expect(
      planOpenLeavePeriod(
        {
          enrollmentStatus: 'on_leave',
          classId: 'class-1',
          leavePeriods: [{ from: '2026-03-02', until: null, classId: 'class-1' }],
        },
        '2026-07-18',
      ),
    ).toBeNull();
  });

  it('falls back to today when statusChangedAt is missing', () => {
    expect(
      planOpenLeavePeriod({ enrollmentStatus: 'on_leave', classId: 'class-1' }, '2026-07-18')?.from,
    ).toBe('2026-07-18');
  });
});
