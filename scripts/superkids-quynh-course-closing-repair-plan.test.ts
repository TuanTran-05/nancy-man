import { describe, expect, it } from 'vitest';
import {
  buildSuperkidsCourseClosingRepairPlan,
  inferPreviousCourseRange,
} from './superkids-quynh-course-closing-repair-plan';

describe('inferPreviousCourseRange', () => {
  it('finds the prior 16-session T3/T5 course immediately before 2026-08-06', () => {
    expect(
      inferPreviousCourseRange({
        currentStartDate: '2026-08-06',
        daysOfWeek: [2, 4],
        holidays: [],
        requiredSessions: 16,
      })
    ).toEqual({ startDate: '2026-06-11', endDate: '2026-08-04' });
  });
});

describe('buildSuperkidsCourseClosingRepairPlan', () => {
  const oldCourseId = 'course-old';
  const newCourseId = 'course-new';
  const classData = {
    startDate: '2026-08-06',
    endDate: '2026-09-29',
    currentCourseId: oldCourseId,
    daysOfWeek: [2, 4],
    weeklySessions: [{ dayOfWeek: 2 }, { dayOfWeek: 4 }],
    holidays: [],
    terms: [],
    courseClosing: {
      courseId: oldCourseId,
      termStart: '2026-08-06',
      termEnd: '2026-09-29',
      approval: { status: 'approved' },
      exemptions: [],
    },
  };

  it('archives the mistaken closing under the prior course and rotates a clean current course id', () => {
    const plan = buildSuperkidsCourseClosingRepairPlan({
      classData,
      newCourseId,
      now: '2026-08-14T02:00:00.000Z',
      correctedNoticeDate: '2026-08-11',
      correctedPaymentDueDate: '2026-08-20',
      evaluations: [
        {
          id: 'evaluation-1',
          evaluationType: 'final',
          termId: 'current',
          termStart: '2026-08-06',
          termEnd: '2026-09-29',
        },
      ],
      records: [
        {
          id: 'course-old__student-1',
          courseId: oldCourseId,
          courseStartDate: '2026-08-06',
          courseEndDate: '2026-09-29',
          closingMonth: '2026-09',
          tuitionSnapshot: {
            noticeDate: '2026-09-29',
            paymentWindowStart: '2026-09-29',
            paymentDueDate: '2026-10-15',
            previousCourseStartDate: '2026-08-06',
            previousCourseEndDate: '2026-09-29',
            nextCourseStartDate: '2026-10-01',
            nextCourseEndDate: '2026-11-24',
          },
        },
      ],
      notifications: [{ id: 'notification-1', courseId: oldCourseId }],
      ledgers: [
        { id: 'ledger-1', termStart: '2026-08-06', termEnd: '2026-09-29' },
      ],
    });

    expect(plan.previousCourse).toEqual({
      id: 'term_repair_course-old',
      name: 'Khoa 2026-06-11 - 2026-08-04',
      startDate: '2026-06-11',
      endDate: '2026-08-04',
      holidays: [],
      weeklySessions: [{ dayOfWeek: 2 }, { dayOfWeek: 4 }],
      daysOfWeek: [2, 4],
      courseId: oldCourseId,
      courseClosing: {
        courseId: oldCourseId,
        termStart: '2026-06-11',
        termEnd: '2026-08-04',
        approval: { status: 'approved' },
        exemptions: [],
      },
      repairSource: 'manual_course_closing_course_reassignment',
    });
    expect(plan.classUpdate).toEqual({
      currentCourseId: newCourseId,
      terms: [plan.previousCourse],
      deleteCourseClosing: true,
      updatedAt: '2026-08-14T02:00:00.000Z',
    });
    expect(plan.evaluationUpdates).toEqual([
      {
        id: 'evaluation-1',
        termId: 'term_repair_course-old',
        termStart: '2026-06-11',
        termEnd: '2026-08-04',
        repairSource: 'manual_course_closing_course_reassignment',
        repairedAt: '2026-08-14T02:00:00.000Z',
      },
    ]);
    expect(plan.recordUpdates).toEqual([
      {
        id: 'course-old__student-1',
        closingMonth: '2026-08',
        courseStartDate: '2026-06-11',
        courseEndDate: '2026-08-04',
        tuitionSnapshot: {
          noticeDate: '2026-08-11',
          paymentWindowStart: '2026-08-11',
          paymentDueDate: '2026-08-20',
          previousCourseStartDate: '2026-06-11',
          previousCourseEndDate: '2026-08-04',
          nextCourseStartDate: '2026-08-06',
          nextCourseEndDate: '2026-09-29',
        },
        repairSource: 'manual_course_closing_course_reassignment',
        repairedAt: '2026-08-14T02:00:00.000Z',
        updatedAt: '2026-08-14T02:00:00.000Z',
      },
    ]);
    expect(plan.notificationAnnotations).toEqual([
      {
        id: 'notification-1',
        reassignedTermId: 'term_repair_course-old',
        reassignedCourseStartDate: '2026-06-11',
        reassignedCourseEndDate: '2026-08-04',
        repairSource: 'manual_course_closing_course_reassignment',
        repairedAt: '2026-08-14T02:00:00.000Z',
      },
    ]);
    expect(plan.ledgerIdsToClearClosingNotice).toEqual(['ledger-1']);
  });

  it('refuses to move an evaluation that is not an exact mistaken current-course final', () => {
    expect(() =>
      buildSuperkidsCourseClosingRepairPlan({
        classData,
        newCourseId,
        now: '2026-08-14T02:00:00.000Z',
        correctedNoticeDate: '2026-08-11',
        correctedPaymentDueDate: '2026-08-20',
        evaluations: [
          {
            id: 'evaluation-1',
            evaluationType: 'midterm',
            termId: 'current',
            termStart: '2026-08-06',
            termEnd: '2026-09-29',
          },
        ],
        records: [],
        notifications: [],
        ledgers: [],
      })
    ).toThrow('Unexpected evaluation outside the mistaken current-course finals');
  });
});
