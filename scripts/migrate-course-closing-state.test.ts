import { describe, expect, it } from 'vitest';
import {
  planCourseClosingMigration,
  type CourseClosingMigrationInput,
} from './migrate-course-closing-state';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function legacyInput(overrides: Partial<CourseClosingMigrationInput> = {}) {
  const base: CourseClosingMigrationInput = {
    classId: 'class-1',
    classData: {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    },
    students: [{ id: 'student-1', data: { classId: 'class-1', enrollmentStatus: 'active' } }],
    evaluations: [
      {
        id: 'evaluation-1',
        updatedAt: '2026-06-30T08:00:00.000Z',
        data: {
          classId: 'class-1',
          studentId: 'student-1',
          evaluationType: 'final',
          date: '2026-06-30',
        },
      },
    ],
    notifications: [],
  };
  return {
    ...base,
    ...overrides,
    classData: { ...base.classData, ...(overrides.classData || {}) },
  };
}

function sentNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1',
    data: {
      classId: 'class-1',
      studentId: 'student-1',
      type: 'evaluation_notice',
      status: 'sent',
      createdAt: '2026-06-30T09:00:00.000Z',
      ...overrides,
    },
  };
}

describe('planCourseClosingMigration', () => {
  it('proposes a UUID for a class without a current course id', () => {
    const plan = planCourseClosingMigration(legacyInput());

    expect(plan.courseId).toEqual(expect.stringMatching(UUID_PATTERN));
    expect(plan.classUpdate?.currentCourseId).toBe(plan.courseId);
  });

  it('retains an existing current course id', () => {
    const plan = planCourseClosingMigration(
      legacyInput({ classData: { currentCourseId: 'course-existing' } })
    );

    expect(plan.courseId).toBe('course-existing');
    expect(plan.classUpdate?.currentCourseId).toBeUndefined();
  });

  it('links an unambiguous evaluation log sent after the evaluation version', () => {
    const plan = planCourseClosingMigration(
      legacyInput({ notifications: [sentNotification()] })
    );

    expect(plan.notificationUpdates).toEqual([
      {
        notificationId: 'notification-1',
        courseId: plan.courseId,
        evaluationId: 'evaluation-1',
        evaluationVersion: '2026-06-30T08:00:00.000Z',
      },
    ]);
    expect(plan.ambiguousNotificationIds).toEqual([]);
  });

  it('does not link a log when the evaluation changed after the send', () => {
    const plan = planCourseClosingMigration(
      legacyInput({
        evaluations: [
          {
            id: 'evaluation-1',
            updatedAt: '2026-07-18T09:00:00.000Z',
            data: {
              classId: 'class-1',
              studentId: 'student-1',
              evaluationType: 'final',
              date: '2026-06-30',
            },
          },
        ],
        notifications: [sentNotification({ createdAt: '2026-07-18T08:00:00.000Z' })],
      })
    );

    expect(plan.notificationUpdates).toEqual([]);
    expect(plan.ambiguousNotificationIds).toEqual(['notification-1']);
    expect(plan.classUpdate?.courseClosing).toBeUndefined();
  });

  it('marks a log sent before the current term start as ambiguous', () => {
    const plan = planCourseClosingMigration(
      legacyInput({ notifications: [sentNotification({ createdAt: '2026-05-01T09:00:00.000Z' })] })
    );

    expect(plan.notificationUpdates).toEqual([]);
    expect(plan.ambiguousNotificationIds).toEqual(['notification-1']);
  });

  it('never overwrites an existing conflicting courseId on a log', () => {
    const plan = planCourseClosingMigration(
      legacyInput({
        classData: { currentCourseId: 'course-1' },
        notifications: [sentNotification({ courseId: 'course-other' })],
      })
    );

    expect(plan.notificationUpdates).toEqual([]);
    expect(plan.ambiguousNotificationIds).toEqual(['notification-1']);
  });

  it('creates a migration approval only when every requirement is proven', () => {
    const plan = planCourseClosingMigration(
      legacyInput({
        notifications: [
          sentNotification(),
          sentNotification({ id: 'notification-2', type: 'tuition_notice' }),
        ].map((entry, index) => ({ ...entry, id: index === 1 ? 'notification-2' : entry.id })),
      })
    );

    expect(plan.outcome).toBe('completed');
    expect(plan.classUpdate?.courseClosing).toMatchObject({
      courseId: plan.courseId,
      approval: {
        status: 'approved',
        source: 'migration',
        approvedBy: 'course-closing-migration',
        approvedByRole: 'system',
      },
    });
  });

  it('preserves partial evidence without creating an approval', () => {
    const plan = planCourseClosingMigration(
      legacyInput({ notifications: [sentNotification()] })
    );

    expect(plan.outcome).toBe('partial');
    expect(plan.notificationUpdates).toHaveLength(1);
    expect(plan.classUpdate?.courseClosing).toBeUndefined();
  });

  it('reports needs_admin_review when evidence is ambiguous', () => {
    const plan = planCourseClosingMigration(
      legacyInput({ notifications: [sentNotification({ createdAt: '2026-05-01T09:00:00.000Z' })] })
    );

    expect(plan.outcome).toBe('needs_admin_review');
  });

  it('produces no changes when rerun against already migrated output', () => {
    const first = planCourseClosingMigration(
      legacyInput({
        notifications: [
          sentNotification(),
          { ...sentNotification({ type: 'tuition_notice' }), id: 'notification-2' },
        ],
      })
    );

    const migratedNotifications = [
      sentNotification({
        courseId: first.courseId,
        evaluationId: 'evaluation-1',
        evaluationVersion: '2026-06-30T08:00:00.000Z',
      }),
      {
        ...sentNotification({ type: 'tuition_notice', courseId: first.courseId }),
        id: 'notification-2',
      },
    ];

    const second = planCourseClosingMigration(
      legacyInput({
        classData: {
          currentCourseId: first.courseId,
          courseClosing: (first.classUpdate as Record<string, unknown>).courseClosing,
        },
        notifications: migratedNotifications,
      })
    );

    expect(second.notificationUpdates).toEqual([]);
    expect(second.classUpdate).toBeUndefined();
    expect(second.outcome).toBe('no_change');
  });

  it('never plans Zalo sends, resets or ledger writes', () => {
    const plan = planCourseClosingMigration(
      legacyInput({ notifications: [sentNotification()] })
    );

    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/zaloSend|resetCourse|ledger/i);
  });
});
