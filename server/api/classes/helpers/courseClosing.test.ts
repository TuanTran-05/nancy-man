import { describe, expect, it, vi } from 'vitest';
import type { CourseClosingApproval } from '../../../../shared/courseClosing.js';
import {
  makeDocumentStoreDocSnapshot,
  makeDocumentStoreQuerySnapshot,
} from '../../lib/documentStore/testDocumentStoreMocks.js';
import {
  assertEvaluationNotLocked,
  assertCourseClosingClassApproved,
  assertCourseClosingSendAllowed,
  changedRequiredRosterClassIds,
  computeCourseClosingSnapshot,
  createCourseClosingFingerprints,
  invalidateCourseClosingApproval,
  invalidateCourseClosingApprovals,
  snapshotFromCourseClosingContext,
  type CourseClosingContext,
} from './courseClosing.js';

function student(id: string, enrollmentStatus = 'active') {
  return makeDocumentStoreDocSnapshot({
    id,
    path: `students/${id}`,
    data: { classId: 'class-1', enrollmentStatus },
  });
}

function evaluation(
  options: {
    id?: string;
    studentId?: string;
    updateTime?: string;
    rank?: string;
  } = {}
) {
  const id = options.id ?? 'evaluation-1';
  return makeDocumentStoreDocSnapshot({
    id,
    path: `evaluations/${id}`,
    updateTime: options.updateTime ?? '2026-07-18T08:00:00.000Z',
    data: {
      classId: 'class-1',
      studentId: options.studentId ?? 'student-1',
      evaluationType: 'final',
      date: '2026-07-18',
      ...(options.rank ? { rank: options.rank } : {}),
    },
  });
}

function notification(id: string, data: Record<string, unknown>) {
  return makeDocumentStoreDocSnapshot({
    id,
    path: `zalo_notifications/${id}`,
    data: { status: 'sent', studentId: 'student-1', ...data },
  });
}

/**
 * The enrollment that puts a student on this course's roster.
 *
 * Course closing no longer reads `students.classId` to decide who was in the
 * course: that field points at whatever class the student is in now, so a
 * student who moved on went missing from the course they actually finished.
 * `termStart` matches the class's `startDate`, which is the course interval.
 */
function courseEnrollment(studentId: string, overrides: Record<string, unknown> = {}) {
  return makeDocumentStoreDocSnapshot({
    id: `${studentId}__class-1__2026-05-01`,
    path: `student_course_enrollments/${studentId}__class-1__2026-05-01`,
    data: {
      studentId,
      classId: 'class-1',
      termStart: '2026-05-01',
      termEnd: '2026-07-18',
      status: 'active',
      ...overrides,
    },
  });
}

/** A `students` collection that answers both queries and document reads. */
function studentsCollection(docs: Array<{ id: string; data: () => unknown }>) {
  const collection: any = {
    where: vi.fn(() => collection),
    get: vi.fn().mockResolvedValue(makeDocumentStoreQuerySnapshot(docs as never)),
    doc: vi.fn((id: string) => ({
      get: vi
        .fn()
        .mockResolvedValue(
          docs.find((doc) => doc.id === id) ?? { id, exists: false, data: () => undefined }
        ),
    })),
  };
  return collection;
}

function context(overrides: Partial<CourseClosingContext> = {}): CourseClosingContext {
  return {
    classDoc: makeDocumentStoreDocSnapshot({
      id: 'class-1',
      path: 'classes/class-1',
      data: {
        currentCourseId: 'course-1',
        startDate: '2026-05-01',
        endDate: '2026-07-18',
      },
    }) as any,
    courseId: 'course-1',
    students: [student('student-1') as any],
    evaluations: [evaluation() as any],
    sentNotifications: [],
    ...overrides,
  };
}

describe('createCourseClosingFingerprints', () => {
  const base = {
    courseId: 'course-1',
    startDate: '2026-05-01',
    endDate: '2026-07-18',
    requiredStudentIds: ['student-2', 'student-1'],
    finalEvaluations: [
      {
        studentId: 'student-2',
        evaluationId: 'evaluation-2',
        evaluationVersion: '2026-07-18T09:00:00.000Z',
      },
      {
        studentId: 'student-1',
        evaluationId: 'evaluation-1',
        evaluationVersion: '2026-07-18T08:00:00.000Z',
      },
    ],
  };

  it('is stable when DocumentStore returns students or evaluations in another order', () => {
    const first = createCourseClosingFingerprints(base);
    const second = createCourseClosingFingerprints({
      ...base,
      requiredStudentIds: [...base.requiredStudentIds].reverse(),
      finalEvaluations: [...base.finalEvaluations].reverse(),
    });
    expect(second).toEqual(first);
  });

  it('changes the correct fingerprint for roster, dates, evaluation identity, and version', () => {
    const original = createCourseClosingFingerprints(base);
    expect(
      createCourseClosingFingerprints({ ...base, requiredStudentIds: ['student-1'] })
        .rosterFingerprint
    ).not.toBe(original.rosterFingerprint);
    expect(
      createCourseClosingFingerprints({ ...base, endDate: '2026-07-19' }).rosterFingerprint
    ).not.toBe(original.rosterFingerprint);
    expect(
      createCourseClosingFingerprints({
        ...base,
        finalEvaluations: [
          { ...base.finalEvaluations[0], evaluationId: 'changed' },
          base.finalEvaluations[1],
        ],
      }).evaluationFingerprint
    ).not.toBe(original.evaluationFingerprint);
    expect(
      createCourseClosingFingerprints({
        ...base,
        finalEvaluations: [
          { ...base.finalEvaluations[0], evaluationVersion: '2026-07-19T09:00:00.000Z' },
          base.finalEvaluations[1],
        ],
      }).evaluationFingerprint
    ).not.toBe(original.evaluationFingerprint);
  });
});

describe('snapshotFromCourseClosingContext', () => {
  it('does not include a legacy active trial in the required roster', () => {
    const trialStudent = makeDocumentStoreDocSnapshot({
      id: 'trial-1',
      path: 'students/trial-1',
      data: {
        classId: 'class-1',
        enrollmentStatus: 'active',
        studentLifecycle: 'trial',
      },
    });
    const snapshot = snapshotFromCourseClosingContext(
      context({ students: [trialStudent as any], evaluations: [] })
    );
    expect(snapshot.requiredStudentCount).toBe(0);
    expect(snapshot.status).toBe('no_required_students');
  });

  it('does not count old-course notification evidence', () => {
    const snapshot = snapshotFromCourseClosingContext(
      context({
        sentNotifications: [
          notification('old', {
            courseId: 'course-old',
            type: 'evaluation_notice',
            evaluationId: 'evaluation-1',
            evaluationVersion: '2026-07-18T08:00:00.000Z',
          }) as any,
        ],
      })
    );
    expect(snapshot.pendingEvaluationStudentIds).toEqual(['student-1']);
    expect(snapshot.lockedEvaluationIds).toEqual([]);
  });

  it('requires matching evaluation identity and DocumentStore version for evaluation and rank', () => {
    const snapshot = snapshotFromCourseClosingContext(
      context({
        evaluations: [evaluation({ rank: 'first' }) as any],
        sentNotifications: [
          notification('stale-evaluation', {
            courseId: 'course-1',
            type: 'evaluation_notice',
            evaluationId: 'evaluation-1',
            evaluationVersion: '2026-07-17T08:00:00.000Z',
          }) as any,
          notification('wrong-rank', {
            courseId: 'course-1',
            type: 'rank_achievement',
            evaluationId: 'evaluation-old',
            evaluationVersion: '2026-07-18T08:00:00.000Z',
          }) as any,
        ],
      })
    );
    expect(snapshot.pendingEvaluationStudentIds).toEqual(['student-1']);
    expect(snapshot.pendingRankStudentIds).toEqual(['student-1']);
    expect(snapshot.lockedEvaluationIds).toEqual([]);
  });

  it('counts matching evaluation/rank aliases and current-course tuition evidence', () => {
    const snapshot = snapshotFromCourseClosingContext(
      context({
        evaluations: [evaluation({ rank: 'second' }) as any],
        sentNotifications: [
          notification('evaluation', {
            courseId: 'course-1',
            type: 'evaluation',
            evaluationId: 'evaluation-1',
            evaluationVersion: '2026-07-18T08:00:00.000Z',
          }) as any,
          notification('rank', {
            courseId: 'course-1',
            type: 'rank_achievement',
            evaluationId: 'evaluation-1',
            evaluationVersion: '2026-07-18T08:00:00.000Z',
          }) as any,
          notification('tuition', {
            courseId: 'course-1',
            type: 'tuition_notice',
          }) as any,
        ],
      })
    );
    expect(snapshot.evaluationSentCount).toBe(1);
    expect(snapshot.rankSentCount).toBe(1);
    expect(snapshot.tuitionSentCount).toBe(1);
    expect(snapshot.lockedEvaluationIds).toEqual(['evaluation-1']);
  });

  it('marks stored approval stale when a current fingerprint differs', () => {
    const storedApproval: CourseClosingApproval = {
      status: 'approved',
      source: 'teacher',
      approvedAt: '2026-07-18T08:00:00.000Z',
      approvedBy: 'teacher-1',
      approvedByRole: 'teacher',
      rosterFingerprint: 'old-roster',
      evaluationFingerprint: 'old-evaluations',
    };
    const snapshot = snapshotFromCourseClosingContext(
      context({
        classDoc: makeDocumentStoreDocSnapshot({
          id: 'class-1',
          data: {
            currentCourseId: 'course-1',
            startDate: '2026-05-01',
            endDate: '2026-07-18',
            courseClosing: {
              courseId: 'course-1',
              termStart: '2026-05-01',
              termEnd: '2026-07-18',
              approval: storedApproval,
            },
          },
        }) as any,
      })
    );
    expect(snapshot.status).toBe('stale');
    expect(snapshot.staleReason).toBe('APPROVAL_FINGERPRINT_MISMATCH');
  });
});

describe('computeCourseClosingSnapshot transactional loading', () => {
  it('routes every class, student, evaluation, and notification read through the transaction', async () => {
    const classSnapshot = context().classDoc;
    const studentQuerySnapshot = makeDocumentStoreQuerySnapshot([student('student-1')]);
    const evaluationQuerySnapshot = makeDocumentStoreQuerySnapshot([evaluation()]);
    const notificationQuerySnapshot = makeDocumentStoreQuerySnapshot([]);
    const classRef = { get: vi.fn().mockResolvedValue(classSnapshot) };
    const query = (result: unknown) => {
      const target: any = {
        where: vi.fn(() => target),
        get: vi.fn().mockResolvedValue(result),
      };
      return target;
    };
    const enrollmentsQuery = query(makeDocumentStoreQuerySnapshot([courseEnrollment('student-1')]));
    const studentRef = { get: vi.fn().mockResolvedValue(studentQuerySnapshot.docs[0]) };
    const evaluationsQuery = query(evaluationQuerySnapshot);
    const notificationsQuery = query(notificationQuerySnapshot);
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'student_course_enrollments') return enrollmentsQuery;
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'zalo_notifications') return notificationsQuery;
        throw new Error(`Unexpected collection ${name}`);
      }),
    };
    const transaction = {
      get: vi.fn(async (target: { get: () => Promise<unknown> }) => target.get()),
    };

    await computeCourseClosingSnapshot(db as any, 'class-1', { transaction: transaction as any });

    // The roster is now two reads — the enrollments for the course, then the
    // profile behind each one — and every read still goes through the
    // transaction, which is what this test exists to protect.
    expect(transaction.get).toHaveBeenCalledTimes(5);
    expect(transaction.get).toHaveBeenNthCalledWith(1, classRef);
    expect(transaction.get).toHaveBeenNthCalledWith(2, enrollmentsQuery);
    expect(transaction.get).toHaveBeenNthCalledWith(3, studentRef);
    expect(transaction.get).toHaveBeenNthCalledWith(4, evaluationsQuery);
    expect(transaction.get).toHaveBeenNthCalledWith(5, notificationsQuery);
  });
});

function courseClosingSendGuardDb(
  options: {
    approval?: 'missing' | 'valid' | 'stale';
    rank?: string;
    exemptions?: string[];
    notifications?: ReturnType<typeof notification>[];
    missingEvaluation?: boolean;
  } = {}
) {
  const studentDoc = student('student-1');
  const evaluationDoc = evaluation({ rank: options.rank });
  const fingerprints = createCourseClosingFingerprints({
    courseId: 'course-1',
    startDate: '2026-05-01',
    endDate: '2026-07-18',
    requiredStudentIds: ['student-1'],
    finalEvaluations: [
      {
        studentId: 'student-1',
        evaluationId: 'evaluation-1',
        evaluationVersion: '2026-07-18T08:00:00.000Z',
      },
    ],
  });
  const approval =
    options.approval === 'missing'
      ? undefined
      : {
          status: 'approved' as const,
          source: 'teacher' as const,
          approvedAt: '2026-07-18T09:00:00.000Z',
          approvedBy: 'teacher-1',
          approvedByRole: 'teacher' as const,
          rosterFingerprint:
            options.approval === 'stale' ? 'stale-roster' : fingerprints.rosterFingerprint,
          evaluationFingerprint: fingerprints.evaluationFingerprint,
        };
  const classDoc = makeDocumentStoreDocSnapshot({
    id: 'class-1',
    path: 'classes/class-1',
    data: {
      currentCourseId: 'course-1',
      startDate: '2026-05-01',
      endDate: '2026-07-18',
      courseClosing: {
        courseId: 'course-1',
        termStart: '2026-05-01',
        termEnd: '2026-07-18',
        ...(approval ? { approval } : {}),
        exemptions: (options.exemptions || []).map((studentId) => ({
          studentId,
          reason: 'Admin exemption',
          createdBy: 'admin-1',
          createdAt: '2026-07-18T09:30:00.000Z',
        })),
      },
    },
  });
  const query = (docs: unknown[]) => {
    const value: any = {
      where: vi.fn(() => value),
      get: vi.fn().mockResolvedValue(makeDocumentStoreQuerySnapshot(docs as any)),
    };
    return value;
  };
  const students = studentsCollection([studentDoc as never]);
  const enrollments = query([courseEnrollment(String((studentDoc as { id: string }).id))]);
  const evaluations = query(options.missingEvaluation ? [] : [evaluationDoc]);
  const notifications = query(options.notifications || []);
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'classes') {
        return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(classDoc) })) };
      }
      if (name === 'student_course_enrollments') return enrollments;
      if (name === 'students') return students;
      if (name === 'evaluations') return evaluations;
      if (name === 'zalo_notifications') return notifications;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  return { db, classDoc, studentDoc, evaluationDoc };
}

describe('assertCourseClosingSendAllowed', () => {
  it('distinguishes missing approval, stale approval, and an exempt student', async () => {
    await expect(
      assertCourseClosingSendAllowed(courseClosingSendGuardDb({ approval: 'missing' }).db as any, {
        classId: 'class-1',
        studentId: 'student-1',
        type: 'evaluation',
      })
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_NOT_APPROVED' });

    await expect(
      assertCourseClosingSendAllowed(courseClosingSendGuardDb({ approval: 'stale' }).db as any, {
        classId: 'class-1',
        studentId: 'student-1',
        type: 'evaluation',
      })
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_STALE' });

    await expect(
      assertCourseClosingSendAllowed(
        courseClosingSendGuardDb({ approval: 'valid', exemptions: ['student-1'] }).db as any,
        { classId: 'class-1', studentId: 'student-1', type: 'evaluation' }
      )
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_STUDENT_EXEMPT' });
  });

  it('returns canonical class, student, and final-evaluation data after valid approval', async () => {
    const { db } = courseClosingSendGuardDb({ approval: 'valid', rank: 'first' });

    await expect(
      assertCourseClosingSendAllowed(db as any, {
        classId: 'class-1',
        studentId: 'student-1',
        type: 'evaluation',
      })
    ).resolves.toMatchObject({
      courseId: 'course-1',
      evaluationId: 'evaluation-1',
      evaluationVersion: '2026-07-18T08:00:00.000Z',
      finalEvaluationData: { rank: 'first' },
      snapshot: { approvalValid: true },
    });
  });

  it('requires a ranked final evaluation and current evaluation evidence before tuition', async () => {
    await expect(
      assertCourseClosingSendAllowed(courseClosingSendGuardDb({ approval: 'valid' }).db as any, {
        classId: 'class-1',
        studentId: 'student-1',
        type: 'rank',
      })
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_INCOMPLETE' });

    await expect(
      assertCourseClosingSendAllowed(courseClosingSendGuardDb({ approval: 'valid' }).db as any, {
        classId: 'class-1',
        studentId: 'student-1',
        type: 'tuition',
      })
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_INCOMPLETE' });

    const evaluationEvidence = notification('evaluation-sent', {
      courseId: 'course-1',
      type: 'evaluation_notice',
      evaluationId: 'evaluation-1',
      evaluationVersion: '2026-07-18T08:00:00.000Z',
    });
    await expect(
      assertCourseClosingSendAllowed(
        courseClosingSendGuardDb({
          approval: 'valid',
          notifications: [evaluationEvidence],
        }).db as any,
        { classId: 'class-1', studentId: 'student-1', type: 'tuition' }
      )
    ).resolves.toMatchObject({ courseId: 'course-1' });
  });

  it('reports matching current sent evidence as an already-sent channel', async () => {
    const evaluationEvidence = notification('evaluation-sent', {
      courseId: 'course-1',
      type: 'evaluation_notice',
      evaluationId: 'evaluation-1',
      evaluationVersion: '2026-07-18T08:00:00.000Z',
    });

    await expect(
      assertCourseClosingSendAllowed(
        courseClosingSendGuardDb({
          approval: 'valid',
          notifications: [evaluationEvidence],
        }).db as any,
        { classId: 'class-1', studentId: 'student-1', type: 'evaluation' }
      )
    ).rejects.toMatchObject({
      name: 'CourseClosingAlreadySentError',
      type: 'evaluation',
      context: {
        courseId: 'course-1',
        evaluationId: 'evaluation-1',
        evaluationVersion: '2026-07-18T08:00:00.000Z',
      },
    });

    await expect(
      assertCourseClosingSendAllowed(
        courseClosingSendGuardDb({
          approval: 'valid',
          notifications: [evaluationEvidence],
        }).db as any,
        {
          classId: 'class-1',
          studentId: 'student-1',
          type: 'evaluation',
          allowAlreadySent: true,
        }
      )
    ).resolves.toMatchObject({
      courseId: 'course-1',
      evaluationId: 'evaluation-1',
    });
  });
});

describe('assertCourseClosingClassApproved', () => {
  it('returns the approved course without requiring pending sends', async () => {
    await expect(
      assertCourseClosingClassApproved(
        courseClosingSendGuardDb({
          approval: 'valid',
          notifications: [
            notification('evaluation-sent', {
              courseId: 'course-1',
              type: 'evaluation_notice',
              evaluationId: 'evaluation-1',
              evaluationVersion: '2026-07-18T08:00:00.000Z',
            }),
          ],
        }).db as any,
        'class-1'
      )
    ).resolves.toMatchObject({
      courseId: 'course-1',
      snapshot: { approvalValid: true },
    });
  });

  it('rejects incomplete evaluations, missing approval, and stale approval', async () => {
    await expect(
      assertCourseClosingClassApproved(
        courseClosingSendGuardDb({ approval: 'valid', missingEvaluation: true }).db as any,
        'class-1'
      )
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_EVALUATIONS_INCOMPLETE' });

    await expect(
      assertCourseClosingClassApproved(
        courseClosingSendGuardDb({ approval: 'missing' }).db as any,
        'class-1'
      )
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_NOT_APPROVED' });

    await expect(
      assertCourseClosingClassApproved(
        courseClosingSendGuardDb({ approval: 'stale' }).db as any,
        'class-1'
      )
    ).rejects.toMatchObject({ errorCode: 'COURSE_CLOSING_STALE' });
  });
});

function mutationGuardDb(
  options: {
    courseId?: string;
    closingCourseId?: string;
    approvalStatus?: 'approved' | 'invalidated';
    notifications?: ReturnType<typeof notification>[];
  } = {}
) {
  const classData = {
    currentCourseId: options.courseId ?? 'course-1',
    startDate: '2026-05-01',
    endDate: '2026-07-18',
    courseClosing: {
      courseId: options.closingCourseId ?? 'course-1',
      approval: {
        status: options.approvalStatus ?? 'approved',
        source: 'teacher',
        approvedAt: '2026-07-18T07:00:00.000Z',
        approvedBy: 'teacher-1',
        approvedByRole: 'teacher',
        rosterFingerprint: 'roster',
        evaluationFingerprint: 'evaluations',
      },
      exemptions: [{ studentId: 'student-1', reason: 'Medical leave' }],
    },
  };
  const update = vi.fn().mockResolvedValue(undefined);
  const classRef = {
    get: vi.fn(async () =>
      makeDocumentStoreDocSnapshot({ id: 'class-1', path: 'classes/class-1', data: classData })
    ),
    update,
  };
  const notificationQuery: any = {
    where: vi.fn(() => notificationQuery),
    get: vi.fn(async () => makeDocumentStoreQuerySnapshot(options.notifications ?? [])),
  };
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'classes') return { doc: vi.fn(() => classRef) };
      if (name === 'zalo_notifications') return notificationQuery;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  return { db, classData, update };
}

describe('evaluation mutation protection', () => {
  it('locks only the exact sent evaluation-notice version in the current course', async () => {
    const sent = notification('sent', {
      courseId: 'course-1',
      type: 'evaluation_notice',
      evaluationId: 'evaluation-1',
      evaluationVersion: '2026-07-18T08:00:00.000Z',
    });
    const exact = mutationGuardDb({ notifications: [sent] });

    await expect(
      assertEvaluationNotLocked(exact.db as any, evaluation() as any)
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'EVALUATION_ALREADY_SENT_LOCKED',
    });

    const oldVersion = mutationGuardDb({
      notifications: [
        notification('old-version', {
          courseId: 'course-1',
          type: 'evaluation_notice',
          evaluationId: 'evaluation-1',
          evaluationVersion: '2026-07-17T08:00:00.000Z',
        }),
      ],
    });
    await expect(
      assertEvaluationNotLocked(oldVersion.db as any, evaluation() as any)
    ).resolves.toBeUndefined();

    const oldCourse = mutationGuardDb({
      notifications: [
        notification('old-course', {
          courseId: 'course-old',
          type: 'evaluation_notice',
          evaluationId: 'evaluation-1',
          evaluationVersion: '2026-07-18T08:00:00.000Z',
        }),
      ],
    });
    await expect(
      assertEvaluationNotLocked(oldCourse.db as any, evaluation() as any)
    ).resolves.toBeUndefined();
  });

  it('invalidates only a current matching approved course while preserving its state', async () => {
    const matching = mutationGuardDb();
    await expect(
      invalidateCourseClosingApproval(
        matching.db as any,
        'class-1',
        'teacher-1',
        'FINAL_EVALUATION_CHANGED'
      )
    ).resolves.toBe(true);
    expect(matching.update).toHaveBeenCalledWith(
      expect.objectContaining({
        'courseClosing.approval.status': 'invalidated',
        'courseClosing.approval.invalidatedBy': 'teacher-1',
        'courseClosing.approval.invalidatedReason': 'FINAL_EVALUATION_CHANGED',
      })
    );

    const wrongCourse = mutationGuardDb({ closingCourseId: 'course-old' });
    await expect(
      invalidateCourseClosingApproval(
        wrongCourse.db as any,
        'class-1',
        'teacher-1',
        'FINAL_EVALUATION_CHANGED'
      )
    ).resolves.toBe(false);
    expect(wrongCourse.update).not.toHaveBeenCalled();
  });
});

describe('required roster invalidation helpers', () => {
  it.each([
    {
      name: 'active to inactive',
      before: { classId: 'class-1', status: 'active', archived: false },
      after: { classId: 'class-1', status: 'inactive', archived: false },
      expected: ['class-1'],
    },
    {
      name: 'active transfer',
      before: { classId: 'class-1', enrollmentStatus: 'active' },
      after: { classId: 'class-2', enrollmentStatus: 'active' },
      expected: ['class-1', 'class-2'],
    },
    {
      name: 'archived student',
      before: { classId: 'class-1', enrollmentStatus: 'active' },
      after: { classId: 'class-1', enrollmentStatus: 'active', studentLifecycle: 'archived' },
      expected: ['class-1'],
    },
    {
      name: 'accepted trial becomes required',
      before: { classId: 'class-1', enrollmentStatus: 'active', studentLifecycle: 'trial' },
      after: { classId: 'class-1', enrollmentStatus: 'active', studentLifecycle: 'enrolled' },
      expected: ['class-1'],
    },
    {
      name: 'rejected trial remains non-required',
      before: { classId: 'class-1', enrollmentStatus: 'active', studentLifecycle: 'trial' },
      after: { classId: 'class-1', studentLifecycle: 'archived' },
      expected: [],
    },
    {
      name: 'name only',
      before: { classId: 'class-1', status: 'active', name: 'A' },
      after: { classId: 'class-1', status: 'active', name: 'B' },
      expected: [],
    },
    {
      name: 'inactive profile change',
      before: { classId: 'class-1', status: 'inactive', name: 'A' },
      after: { classId: 'class-1', status: 'inactive', name: 'B' },
      expected: [],
    },
  ])('returns affected classes for $name', ({ before, after, expected }) => {
    expect(changedRequiredRosterClassIds(before, after)).toEqual(expected);
  });

  it('deduplicates class IDs and returns only approvals that changed', async () => {
    const updates = new Map<string, ReturnType<typeof vi.fn>>();
    const classes = new Map<string, Record<string, unknown>>([
      [
        'class-1',
        {
          currentCourseId: 'course-1',
          courseClosing: {
            courseId: 'course-1',
            approval: { status: 'approved' },
          },
        },
      ],
      [
        'class-2',
        {
          currentCourseId: 'course-2',
          courseClosing: {
            courseId: 'course-2',
            approval: { status: 'invalidated' },
          },
        },
      ],
    ]);
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn((id: string) => {
          const update = updates.get(id) ?? vi.fn().mockResolvedValue(undefined);
          updates.set(id, update);
          return {
            get: vi.fn(async () =>
              makeDocumentStoreDocSnapshot({ id, exists: classes.has(id), data: classes.get(id) })
            ),
            update,
          };
        }),
      })),
    };

    await expect(
      invalidateCourseClosingApprovals(
        db as any,
        ['class-1', 'class-1', '', null, 'class-2'],
        'admin-1',
        'REQUIRED_ROSTER_CHANGED'
      )
    ).resolves.toEqual(['class-1']);
    expect(updates.get('class-1')).toHaveBeenCalledTimes(1);
    expect(updates.get('class-2')).not.toHaveBeenCalled();
  });
});
