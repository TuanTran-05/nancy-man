import { describe, expect, it } from 'vitest';
import { planCourseClosingRecordBackfill } from './planner.js';
import type { BackfillSourceBundle } from './types.js';

const NOW = '2026-07-25T09:00:00.000Z';

function source(id: string, data: Record<string, unknown>, updateTime?: string) {
  return { id, data, ...(updateTime ? { updateTime } : {}) };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)])
  );
}

function partialBundle(): BackfillSourceBundle {
  return {
    classes: [
      source('class-1', {
        name: 'IELTS 6.0',
        startDate: '2026-03-18',
        endDate: '2026-07-18',
        currentCourseId: 'course-1',
        teacherId: 'teacher-1',
      }),
    ],
    students: [
      source('student-1', {
        classId: 'class-1',
        name: 'Nguyễn Văn An',
        code: 'HV001',
        enrollmentStatus: 'active',
      }),
      source('student-2', {
        classId: 'class-1',
        name: 'Trần Thị Bình',
        code: 'HV002',
        enrollmentStatus: 'active',
      }),
    ],
    evaluations: [
      source(
        'final-1',
        {
          classId: 'class-1',
          courseId: 'course-1',
          studentId: 'student-1',
          evaluationType: 'final',
          date: '2026-07-18',
          scores: {
            attendance: 95,
            effort: 80,
            pronunciation: 82,
            homework: 78,
            behavior: 90,
          },
          finalScore: 88,
          totalScore: 84,
          positivePoints: ['Phát âm tốt'],
          improvementPoints: 'Cần tăng tốc độ phản xạ',
        },
        '2026-07-18T08:00:00.000Z'
      ),
    ],
    notifications: [
      source('tuition-notice-2', {
        classId: 'class-1',
        courseId: 'course-1',
        studentId: 'student-2',
        type: 'tuition_notice',
        status: 'sent',
        createdAt: '2026-07-18T09:00:00.000Z',
        courseEndDate: '2026-07-18',
        nextCourseStartDate: '2026-07-20',
        nextCourseEndDate: '2026-11-20',
        tuitionAmount: 2_400_000,
        paymentDueDate: '2026-08-01',
      }),
    ],
    ledgers: [],
    enrollments: [],
    users: [source('teacher-1', { displayName: 'Trần Minh' })],
    existingRecords: [],
  };
}

describe('planCourseClosingRecordBackfill', () => {
  it('plans one evaluation-only and one tuition-only record', () => {
    const plan = planCourseClosingRecordBackfill(partialBundle(), NOW);
    const evaluationOnly = plan.items.find((item) => item.recordId === 'course-1__student-1');
    const tuitionOnly = plan.items.find((item) => item.recordId === 'course-1__student-2');

    expect(evaluationOnly).toMatchObject({
      decision: 'create',
      candidate: {
        evaluationSnapshot: { evaluationId: 'final-1' },
        evaluationDocument: { status: 'pending' },
        tuitionDocument: { status: 'not_requested' },
      },
    });
    expect(evaluationOnly?.candidate).not.toHaveProperty('tuitionSnapshot');
    expect(tuitionOnly).toMatchObject({
      decision: 'create',
      candidate: {
        tuitionSnapshot: { amount: 2_400_000 },
        evaluationDocument: { status: 'not_requested' },
        tuitionDocument: { status: 'pending' },
      },
    });
    expect(tuitionOnly?.candidate).not.toHaveProperty('evaluationSnapshot');
  });

  it('uses a source course id before currentCourseId', () => {
    const bundle = partialBundle();
    bundle.classes[0].data.currentCourseId = 'course-current';
    bundle.evaluations[0].data.courseId = 'course-source';
    bundle.evaluations[0].data.termStart = '2026-03-18';
    bundle.evaluations[0].data.termEnd = '2026-07-18';
    bundle.notifications[0].data.courseId = 'course-source';
    bundle.notifications[0].data.termStart = '2026-03-18';
    bundle.notifications[0].data.termEnd = '2026-07-18';

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.items.map((item) => item.courseId)).toEqual(['course-source', 'course-source']);
  });

  it('marks conflicting source course ids ambiguous', () => {
    const bundle = partialBundle();
    bundle.evaluations[0].data.courseId = 'course-a';
    bundle.notifications[0].data.courseId = 'course-b';

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.summary.ambiguous).toBe(2);
    expect(plan.items[0]).toMatchObject({
      decision: 'ambiguous',
      reasons: ['CONFLICTING_COURSE_ID'],
    });
  });

  it('does not assign current dates to an unverified historical course id', () => {
    const bundle = partialBundle();
    bundle.classes[0].data.currentCourseId = 'course-current';
    bundle.evaluations[0].data.courseId = 'course-old';
    bundle.notifications = [];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          courseId: 'course-old',
          decision: 'ambiguous',
          reasons: ['CONFLICTING_COURSE_ID'],
        }),
      ])
    );
    expect(plan.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          courseId: 'course-old',
          candidate: expect.objectContaining({
            courseStartDate: '2026-03-18',
            courseEndDate: '2026-07-18',
          }),
        }),
      ])
    );
  });

  it('does not create tuition snapshot from class tuitionFee alone', () => {
    const bundle = partialBundle();
    bundle.classes[0].data.tuitionFee = 3_200_000;
    bundle.notifications = [];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-2');

    expect(student?.candidate).not.toHaveProperty('tuitionSnapshot');
    expect(student?.candidate?.tuitionDocument.status).toBe('not_requested');
  });

  it('reports every student in a course that has not ended as skipped', () => {
    const bundle = partialBundle();
    bundle.classes[0].data.endDate = '2026-08-01';

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.summary.skipped).toBe(2);
    expect(plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'skipped',
          reasons: ['NO_CLOSING_EVIDENCE'],
        }),
      ])
    );
  });

  it('merges a missing tuition snapshot and preserves a ready evaluation document', () => {
    const first = planCourseClosingRecordBackfill(partialBundle(), NOW);
    const existing = structuredClone(
      first.items.find((item) => item.studentId === 'student-1')!.candidate!
    );
    existing.evaluationDocument = {
      ...existing.evaluationDocument,
      status: 'ready',
      storagePath: 'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
    };
    const bundle = partialBundle();
    bundle.notifications.push(
      source('tuition-notice-1', {
        classId: 'class-1',
        courseId: 'course-1',
        studentId: 'student-1',
        type: 'tuition_notice',
        status: 'sent',
        createdAt: '2026-07-18T09:00:00.000Z',
        courseEndDate: '2026-07-18',
        nextCourseStartDate: '2026-07-20',
        nextCourseEndDate: '2026-11-20',
        tuitionAmount: 2_400_000,
        paymentDueDate: '2026-08-01',
      })
    );
    bundle.existingRecords = [existing];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const merged = plan.items.find((item) => item.studentId === 'student-1');

    expect(merged?.decision).toBe('merge');
    expect(merged?.candidate?.evaluationDocument).toEqual(existing.evaluationDocument);
    expect(merged?.candidate?.tuitionSnapshot).toMatchObject({ amount: 2_400_000 });
  });

  it('marks a conflicting existing immutable snapshot ambiguous', () => {
    const first = planCourseClosingRecordBackfill(partialBundle(), NOW);
    const existing = structuredClone(
      first.items.find((item) => item.studentId === 'student-1')!.candidate!
    );
    existing.evaluationSnapshot!.totalScore = 10;
    const bundle = partialBundle();
    bundle.existingRecords = [existing];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const conflicted = plan.items.find((item) => item.studentId === 'student-1');

    expect(conflicted).toMatchObject({
      decision: 'ambiguous',
      reasons: ['EXISTING_SNAPSHOT_CONFLICT'],
    });
  });

  it('returns unchanged after planned candidates become existing records', () => {
    const first = planCourseClosingRecordBackfill(partialBundle(), NOW);
    const bundle = partialBundle();
    bundle.existingRecords = first.items.flatMap((item) =>
      item.candidate ? [reverseObjectKeys(item.candidate) as typeof item.candidate] : []
    );

    const second = planCourseClosingRecordBackfill(bundle, NOW);

    expect(second.summary.create).toBe(0);
    expect(second.summary.merge).toBe(0);
    expect(second.summary.unchanged).toBe(2);
  });

  it('omits absent snapshots from a merged record', () => {
    const bundle = partialBundle();
    const first = planCourseClosingRecordBackfill(bundle, NOW);
    const existing = structuredClone(
      first.items.find((item) => item.studentId === 'student-1')!.candidate!
    );
    delete existing.evaluationSnapshot;
    existing.evaluationDocument.status = 'not_requested';
    bundle.existingRecords = [existing];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const merged = plan.items.find((item) => item.studentId === 'student-1');

    expect(merged?.decision).toBe('merge');
    expect(merged?.candidate).toHaveProperty('evaluationSnapshot');
    expect(merged?.candidate).not.toHaveProperty('tuitionSnapshot');
  });

  it('keeps a partial record when evaluation evidence is invalid', () => {
    const bundle = partialBundle();
    (bundle.evaluations[0].data.scores as Record<string, unknown>).attendance = 150;

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-1');

    expect(student?.decision).toBe('create');
    expect(student?.reasons).toContain('EVALUATION_SOURCE_INVALID');
    expect(student?.candidate).not.toHaveProperty('evaluationSnapshot');
  });

  it('keeps a partial record when tuition evidence is invalid', () => {
    const bundle = partialBundle();
    delete bundle.notifications[0].data.paymentDueDate;

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-2');

    expect(student?.decision).toBe('create');
    expect(student?.reasons).toContain('TUITION_SOURCE_INVALID');
    expect(student?.candidate).not.toHaveProperty('tuitionSnapshot');
  });

  it('plans an archived student who has since moved to another class', () => {
    const bundle = partialBundle();
    bundle.classes[0].data = {
      ...bundle.classes[0].data,
      startDate: '2026-07-20',
      endDate: '2026-11-20',
      currentCourseId: 'course-2',
      terms: [
        {
          id: 'term-old',
          startDate: '2026-01-10',
          endDate: '2026-06-10',
        },
      ],
    };
    bundle.students = [
      source('student-1', {
        classId: 'class-2',
        name: 'Nguyễn Văn An',
        code: 'HV001',
        enrollmentStatus: 'completed',
        studentLifecycle: 'archived',
      }),
    ];
    bundle.enrollments = [
      source('enrollment-1', {
        classId: 'class-1',
        studentId: 'student-1',
        termStart: '2026-01-10',
        termEnd: '2026-06-10',
        status: 'completed',
      }),
    ];
    bundle.evaluations = [
      source(
        'final-archived',
        {
          classId: 'class-1',
          termId: 'term-old',
          studentId: 'student-1',
          evaluationType: 'final',
          date: '2026-06-10',
          scores: {
            attendance: 90,
            effort: 90,
            pronunciation: 90,
            homework: 90,
            behavior: 90,
          },
          finalScore: 90,
          totalScore: 90,
        },
        '2026-06-10T08:00:00.000Z'
      ),
    ];
    bundle.notifications = [
      source('tuition-archived', {
        classId: 'class-1',
        studentId: 'student-1',
        type: 'tuition_notice',
        status: 'sent',
        createdAt: '2026-06-10T09:00:00.000Z',
        courseEndDate: '10/06/2026',
        nextCourseStartDate: '2026-06-15',
        nextCourseEndDate: '2026-10-15',
        tuitionAmount: 2_400_000,
        paymentDueDate: '2026-06-14',
      }),
    ];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordId: 'term-old__student-1',
          courseId: 'term-old',
          studentId: 'student-1',
          decision: 'create',
          candidate: expect.objectContaining({
            courseStartDate: '2026-01-10',
            courseEndDate: '2026-06-10',
            tuitionSnapshot: expect.objectContaining({
              noticeDate: '2026-06-10',
              nextCourseStartDate: '2026-06-15',
              nextCourseEndDate: '2026-10-15',
            }),
          }),
        }),
      ])
    );
  });

  it('reports a legacy archived term without a canonical id as ambiguous', () => {
    const bundle = partialBundle();
    bundle.classes[0].data = {
      ...bundle.classes[0].data,
      startDate: '2026-07-20',
      endDate: '2026-11-20',
      currentCourseId: 'course-2',
      terms: [{ startDate: '2026-01-10', endDate: '2026-06-10' }],
    };
    bundle.students[0].data.classId = 'class-2';
    bundle.students = [bundle.students[0]];
    bundle.enrollments = [
      source('enrollment-legacy', {
        classId: 'class-1',
        studentId: 'student-1',
        termStart: '2026-01-10',
        termEnd: '2026-06-10',
        status: 'completed',
      }),
    ];
    bundle.evaluations = [];
    bundle.notifications = [];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classId: 'class-1',
          studentId: 'student-1',
          decision: 'ambiguous',
          reasons: ['CONFLICTING_COURSE_ID'],
        }),
      ])
    );
  });

  it('reports conflicting direct courseId and termId as ambiguous', () => {
    const bundle = partialBundle();
    bundle.classes[0].data.terms = [
      {
        id: 'term-old',
        courseId: 'course-old',
        startDate: '2026-01-10',
        endDate: '2026-06-10',
      },
    ];
    bundle.evaluations[0].data.courseId = 'course-1';
    bundle.evaluations[0].data.termId = 'term-old';

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: 'student-1',
          decision: 'ambiguous',
          reasons: ['CONFLICTING_COURSE_ID'],
        }),
      ])
    );
  });

  it('reports a courseEndDate-only notification matching multiple terms as ambiguous', () => {
    const bundle = partialBundle();
    bundle.classes[0].data = {
      ...bundle.classes[0].data,
      startDate: '2026-07-20',
      endDate: '2026-11-20',
      currentCourseId: 'course-current',
      terms: [
        {
          id: 'term-a',
          startDate: '2026-01-10',
          endDate: '2026-06-10',
        },
        {
          id: 'term-b',
          startDate: '2026-02-10',
          endDate: '2026-06-10',
        },
      ],
    };
    bundle.students = [bundle.students[0]];
    bundle.evaluations = [];
    bundle.notifications = [
      source('ambiguous-notice', {
        classId: 'class-1',
        studentId: 'student-1',
        type: 'tuition_notice',
        status: 'sent',
        createdAt: '2026-06-10T09:00:00.000Z',
        courseEndDate: '2026-06-10',
        nextCourseStartDate: '2026-06-15',
        nextCourseEndDate: '2026-10-15',
        tuitionAmount: 2_400_000,
        paymentDueDate: '2026-06-14',
      }),
    ];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);

    expect(plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: 'student-1',
          decision: 'ambiguous',
          reasons: ['CONFLICTING_COURSE_ID'],
        }),
      ])
    );
    expect(
      plan.items.filter((item) => item.candidate?.tuitionSnapshot).map((item) => item.courseId)
    ).toEqual([]);
  });

  it('rejects a referenced ledger that belongs to another student', () => {
    const bundle = partialBundle();
    bundle.notifications[0].data.ledgerId = 'ledger-wrong';
    bundle.ledgers = [
      source('ledger-wrong', {
        classId: 'class-1',
        courseId: 'course-1',
        studentId: 'student-other',
        amount: 9_999_999,
        dueDate: '2026-08-01',
        tuitionNoticeCount: 1,
      }),
    ];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-2');

    expect(student?.reasons).toContain('TUITION_SOURCE_INVALID');
    expect(student?.candidate).not.toHaveProperty('tuitionSnapshot');
  });

  it('rejects a referenced ledger without exact course or term identity', () => {
    const bundle = partialBundle();
    bundle.notifications[0].data.ledgerId = 'ledger-unscoped';
    bundle.ledgers = [
      source('ledger-unscoped', {
        classId: 'class-1',
        studentId: 'student-2',
        amount: 2_400_000,
        dueDate: '2026-08-01',
        tuitionNoticeCount: 1,
      }),
    ];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-2');

    expect(student?.reasons).toContain('TUITION_SOURCE_INVALID');
    expect(student?.candidate).not.toHaveProperty('tuitionSnapshot');
  });

  it('rejects conflicting sent tuition notifications instead of picking one arbitrarily', () => {
    const bundle = partialBundle();
    bundle.notifications.push(
      source('tuition-notice-conflict', {
        ...bundle.notifications[0].data,
        createdAt: '2026-07-19T09:00:00.000Z',
        tuitionAmount: 3_000_000,
      })
    );

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-2');

    expect(student?.reasons).toContain('TUITION_SOURCE_INVALID');
    expect(student?.candidate).not.toHaveProperty('tuitionSnapshot');
  });

  it('uses the proven ledger send timestamp instead of ledger creation time', () => {
    const bundle = partialBundle();
    bundle.notifications = [];
    bundle.ledgers = [
      source('ledger-sent', {
        classId: 'class-1',
        courseId: 'course-1',
        studentId: 'student-2',
        tuitionNoticeCount: 1,
        tuitionNoticeLastSentAt: '2026-07-18T09:00:00.000Z',
        createdAt: '2026-03-18T09:00:00.000Z',
        tuitionNoticeLastAmount: 2_400_000,
        tuitionNoticeLastDueDate: '2026-08-01',
        nextCourseStartDate: '2026-07-20',
        nextCourseEndDate: '2026-11-20',
      }),
    ];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const tuition = plan.items.find((item) => item.studentId === 'student-2')?.candidate
      ?.tuitionSnapshot;

    expect(tuition?.noticeDate).toBe('2026-07-18');
  });

  it.each([null, '', '   ', true])(
    'rejects empty or non-numeric tuition amount %p instead of converting it to zero',
    (amount) => {
      const bundle = partialBundle();
      bundle.notifications[0].data.tuitionAmount = amount;

      const plan = planCourseClosingRecordBackfill(bundle, NOW);
      const student = plan.items.find((item) => item.studentId === 'student-2');

      expect(student?.reasons).toContain('TUITION_SOURCE_INVALID');
      expect(student?.candidate).not.toHaveProperty('tuitionSnapshot');
    }
  );

  it('rejects conflicting financial evidence between notification and ledger', () => {
    const bundle = partialBundle();
    bundle.notifications[0].data.ledgerId = 'ledger-conflict';
    bundle.ledgers = [
      source('ledger-conflict', {
        classId: 'class-1',
        courseId: 'course-1',
        studentId: 'student-2',
        tuitionNoticeCount: 1,
        tuitionNoticeLastSentAt: '2026-07-18T09:00:00.000Z',
        tuitionNoticeLastAmount: 3_000_000,
        tuitionNoticeLastDueDate: '2026-08-01',
        nextCourseStartDate: '2026-07-20',
        nextCourseEndDate: '2026-11-20',
      }),
    ];

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-2');

    expect(student?.reasons).toContain('TUITION_SOURCE_INVALID');
    expect(student?.candidate).not.toHaveProperty('tuitionSnapshot');
  });

  it.each([null, ''])('does not convert an empty final score %p into zero', (totalScore) => {
    const bundle = partialBundle();
    bundle.evaluations[0].data.totalScore = totalScore;

    const plan = planCourseClosingRecordBackfill(bundle, NOW);
    const student = plan.items.find((item) => item.studentId === 'student-1');

    expect(student?.reasons).toContain('EVALUATION_SOURCE_INVALID');
    expect(student?.candidate).not.toHaveProperty('evaluationSnapshot');
  });

  it('does not invent final exam fields for a tuition-only record', () => {
    const plan = planCourseClosingRecordBackfill(partialBundle(), NOW);
    const tuition = plan.items.find((item) => item.studentId === 'student-2')?.candidate
      ?.tuitionSnapshot;

    expect(tuition).toBeDefined();
    expect(tuition).not.toHaveProperty('finalExamDate');
    expect(tuition).not.toHaveProperty('finalExamScore');
  });
});
