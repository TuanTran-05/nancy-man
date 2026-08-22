import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeClassUpdateAndSyncAtomic } from './classSyncHelper.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
    delete: vi.fn(() => 'delete'),
  },
}));

/**
 * Archiving a class used to query `students.classId` and stamp every active or
 * on_leave document `enrollmentStatus: 'promoted'` — the source of the
 * "waiting for placement" state that then required a second profile to clear.
 * These tests pin the replacement: roster membership comes from
 * `student_course_enrollments`, archiving with an open enrollment is refused
 * outright, and nothing ever writes `promoted` again.
 */

type Doc = { id: string; data: Record<string, unknown>; ref: { path: string; id: string } };

function enrollmentDoc(
  studentId: string,
  classId: string,
  status: string,
  termStart = '2026-01-05'
): Doc {
  const id = makeStudentCourseEnrollmentId(studentId, classId, termStart);
  return {
    id,
    ref: { path: `student_course_enrollments/${id}`, id },
    data: {
      id,
      studentId,
      classId,
      termStart,
      termEnd: '2026-06-30',
      status,
      joinedAt: termStart,
      endedAt: ['completed', 'transferred', 'dropped'].includes(status) ? '2026-06-30' : null,
      source: 'system',
      confidence: 'confirmed',
    },
  };
}

function studentDoc(id: string, data: Record<string, unknown>): Doc {
  return { id, ref: { path: `students/${id}`, id }, data };
}

function userDoc(id: string, data: Record<string, unknown>): Doc {
  return { id, ref: { path: `users/${id}`, id }, data };
}

function ledgerDoc(id: string, data: Record<string, unknown>): Doc {
  return { id, ref: { path: `course_fee_ledgers/${id}`, id }, data };
}

function makeDb(options: {
  enrollments?: Doc[];
  students?: Doc[];
  users?: Doc[];
  evaluations?: Doc[];
  ledgers?: Doc[];
}) {
  const enrollments = options.enrollments ?? [];
  const students = options.students ?? [];
  const users = options.users ?? [];
  const evaluations = options.evaluations ?? [];
  const ledgers = options.ledgers ?? [];
  const batchOps: Array<{
    type: 'update' | 'set' | 'create' | 'delete';
    ref: { path: string };
    data: Record<string, unknown>;
  }> = [];
  let committed = false;

  function studentsCollection() {
    return {
      doc: (id: string) =>
        students.find((doc) => doc.id === id)?.ref ?? { path: `students/${id}`, id },
    };
  }

  function usersCollection() {
    return {
      doc: (id: string) => users.find((doc) => doc.id === id)?.ref ?? { path: `users/${id}`, id },
    };
  }

  function enrollmentQuery(filters: Array<[string, string, unknown]> = []) {
    const self: Record<string, unknown> = {};
    Object.assign(self, {
      where: (field: string, op: string, value: unknown) =>
        enrollmentQuery([...filters, [field, op, value]]),
      get: async () => {
        const matched = enrollments.filter((doc) =>
          filters.every(([field, op, value]) => {
            const actual = doc.data[field];
            if (op === '==') return actual === value;
            if (op === 'in') return Array.isArray(value) && value.includes(actual);
            return true;
          })
        );
        const docs = matched.map((doc) => ({ id: doc.id, ref: doc.ref, data: () => doc.data }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    });
    return self;
  }

  function refGet(collection: Doc[], id: string) {
    const found = collection.find((doc) => doc.id === id);
    return async () => ({ exists: Boolean(found), id, data: () => found?.data });
  }

  const db = {
    collection: (name: string) => {
      if (name === 'classes') {
        return { doc: (id: string) => ({ path: `classes/${id}`, id }) };
      }
      if (name === 'students') {
        return {
          ...studentsCollection(),
          doc: (id: string) => ({
            ...(students.find((doc) => doc.id === id)?.ref ?? { path: `students/${id}`, id }),
            get: refGet(students, id),
          }),
        };
      }
      if (name === 'users') {
        return {
          ...usersCollection(),
          doc: (id: string) => ({
            ...(users.find((doc) => doc.id === id)?.ref ?? { path: `users/${id}`, id }),
            get: refGet(users, id),
          }),
        };
      }
      if (name === 'student_course_enrollments') {
        return {
          ...enrollmentQuery(),
          doc: (id: string) => ({
            path: `student_course_enrollments/${id}`,
            id,
            get: refGet(enrollments, id),
          }),
        };
      }
      if (name === 'evaluations') {
        return {
          where: (field: string, _op: string, value: unknown) => ({
            get: async () => {
              const matched = evaluations.filter((doc) => doc.data[field] === value);
              const docs = matched.map((doc) => ({
                id: doc.id,
                ref: doc.ref,
                data: () => doc.data,
              }));
              return { docs, size: docs.length };
            },
          }),
        };
      }
      if (name === 'course_fee_ledgers') {
        return {
          where: (field: string, _op: string, value: unknown) => ({
            get: async () => {
              const matched = ledgers.filter((doc) => doc.data[field] === value);
              const docs = matched.map((doc) => ({
                id: doc.id,
                ref: doc.ref,
                data: () => doc.data,
              }));
              return { docs, size: docs.length };
            },
          }),
        };
      }
      return {};
    },
    batch: () => ({
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        batchOps.push({ type: 'update', ref, data });
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        batchOps.push({ type: 'set', ref, data });
      },
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        batchOps.push({ type: 'create', ref, data });
      },
      delete: (ref: { path: string }) => {
        batchOps.push({ type: 'delete', ref, data: {} });
      },
      commit: async () => {
        committed = true;
      },
    }),
  };

  return { db: db as never, batchOps, wasCommitted: () => committed };
}

describe('archiving refuses an open enrollment', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['trial', 'active', 'on_leave'])(
    'rejects when a %s enrollment remains in the class',
    async (status) => {
      const { db, batchOps, wasCommitted } = makeDb({
        enrollments: [enrollmentDoc('stu-1', 'class-6', status)],
      });

      await expect(
        executeClassUpdateAndSyncAtomic(
          db,
          'class-6',
          { status: 'archived' },
          { status: 'archived', prevStatus: 'active' }
        )
      ).rejects.toThrow('CLASS_HAS_OPEN_ENROLLMENTS');
      expect(batchOps).toEqual([]);
      expect(wasCommitted()).toBe(false);
    }
  );

  it('archives once every enrollment has already been closed', async () => {
    const { db, batchOps } = makeDb({
      enrollments: [enrollmentDoc('stu-1', 'class-6', 'completed')],
      students: [studentDoc('stu-1', { classId: 'class-6', enrollmentStatus: 'active' })],
    });

    const result = await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      { status: 'archived' },
      { status: 'archived', prevStatus: 'active' }
    );

    expect(result.updatedStudents).toBe(0);
    // The claim that matters: 'promoted' is gone from this codepath entirely.
    expect(batchOps.some((op) => op.data.enrollmentStatus === 'promoted')).toBe(false);
    expect(
      batchOps.some((op) => op.ref.path === 'students/stu-1' && 'enrollmentStatus' in op.data)
    ).toBe(false);
  });

  it('is a no-op when the class is already archived', async () => {
    const { db, batchOps } = makeDb({
      enrollments: [enrollmentDoc('stu-1', 'class-6', 'active')],
    });

    await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      {},
      { status: 'archived', prevStatus: 'archived' }
    );

    expect(batchOps).toEqual([]);
  });
});

describe('class term date corrections stay aligned with canonical enrollments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves enrollment identity and updates profile and ledger references atomically', async () => {
    const beforeStart = '2026-01-05';
    const beforeEnd = '2026-06-30';
    const afterStart = '2026-01-12';
    const afterEnd = '2026-07-06';
    const enrollment = enrollmentDoc('stu-1', 'class-6', 'active', beforeStart);
    const targetId = makeStudentCourseEnrollmentId('stu-1', 'class-6', afterStart);
    const { db, batchOps } = makeDb({
      enrollments: [enrollment],
      students: [
        studentDoc('stu-1', {
          classId: 'class-6',
          currentEnrollmentId: enrollment.id,
          courseJoins: [{ classId: 'class-6', termStart: beforeStart, joinedAt: beforeStart }],
        }),
      ],
      ledgers: [
        ledgerDoc('ledger-1', {
          classId: 'class-6',
          studentId: 'stu-1',
          enrollmentId: enrollment.id,
          termStart: beforeStart,
          termEnd: beforeEnd,
          dueDate: '2026-01-12',
        }),
      ],
    });

    const result = await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      { startDate: afterStart, endDate: afterEnd },
      {
        termDateChange: {
          beforeStartDate: beforeStart,
          beforeEndDate: beforeEnd,
          afterStartDate: afterStart,
          afterEndDate: afterEnd,
        },
        actorId: 'admin-1',
      }
    );

    expect(result).toMatchObject({
      alignedEnrollments: 1,
      movedEnrollmentDocuments: 1,
      updatedLedgers: 1,
      termDateStudentIds: ['stu-1'],
    });
    expect(batchOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'create',
          ref: expect.objectContaining({ path: `student_course_enrollments/${targetId}` }),
          data: expect.objectContaining({
            id: targetId,
            termStart: afterStart,
            termEnd: afterEnd,
            joinedAt: afterStart,
          }),
        }),
        expect.objectContaining({
          type: 'delete',
          ref: expect.objectContaining({ path: `student_course_enrollments/${enrollment.id}` }),
        }),
        expect.objectContaining({
          type: 'update',
          ref: expect.objectContaining({ path: 'students/stu-1' }),
          data: expect.objectContaining({
            currentEnrollmentId: targetId,
            courseJoins: [{ classId: 'class-6', termStart: afterStart, joinedAt: afterStart }],
          }),
        }),
        expect.objectContaining({
          type: 'update',
          ref: expect.objectContaining({ path: 'course_fee_ledgers/ledger-1' }),
          data: expect.objectContaining({
            enrollmentId: targetId,
            termStart: afterStart,
            termEnd: afterEnd,
            dueDate: expect.any(String),
          }),
        }),
      ])
    );
  });

  it('refuses to edit dates when the existing enrollment is already out of sync', async () => {
    const enrollment = enrollmentDoc('stu-1', 'class-6', 'active', '2026-01-05');
    const { db, batchOps, wasCommitted } = makeDb({
      enrollments: [enrollment],
      students: [studentDoc('stu-1', { classId: 'class-6' })],
    });

    await expect(
      executeClassUpdateAndSyncAtomic(
        db,
        'class-6',
        { startDate: '2026-02-02', endDate: '2026-07-06' },
        {
          termDateChange: {
            beforeStartDate: '2026-01-12',
            beforeEndDate: '2026-06-30',
            afterStartDate: '2026-02-02',
            afterEndDate: '2026-07-06',
          },
        }
      )
    ).rejects.toThrow('CLASS_TERM_ENROLLMENT_MISMATCH');
    expect(batchOps).toEqual([]);
    expect(wasCommitted()).toBe(false);
  });
});

describe('pause and resume derive their roster from enrollment authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pauses every open active enrollment and projects on_leave onto the profile and linked users', async () => {
    const enrollment = enrollmentDoc('stu-1', 'class-6', 'active');
    const { db, batchOps } = makeDb({
      enrollments: [enrollment],
      students: [studentDoc('stu-1', { classId: 'class-6', enrollmentStatus: 'active' })],
      users: [
        userDoc('student:stu-1', {
          role: 'student',
          studentId: 'stu-1',
          enrollmentStatus: 'active',
        }),
      ],
    });

    const result = await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      { status: 'paused' },
      { status: 'paused', prevStatus: 'active' }
    );

    expect(result.updatedStudents).toBe(1);
    expect(batchOps).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ path: `student_course_enrollments/${enrollment.id}` }),
        data: expect.objectContaining({ status: 'on_leave' }),
      })
    );
    expect(batchOps).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ path: 'students/stu-1' }),
        data: expect.objectContaining({ enrollmentStatus: 'on_leave' }),
      })
    );
    expect(batchOps).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ path: 'users/student:stu-1' }),
        data: expect.objectContaining({ enrollmentStatus: 'on_leave' }),
      })
    );
  });

  it('leaves a trial enrollment untouched by pause', async () => {
    // Trial has its own review lifecycle; folding it into on_leave would corrupt
    // a state the admissions flow depends on.
    const { db, batchOps } = makeDb({
      enrollments: [enrollmentDoc('stu-trial', 'class-6', 'trial')],
      students: [studentDoc('stu-trial', { classId: 'class-6', studentLifecycle: 'trial' })],
    });

    const result = await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      { status: 'paused' },
      { status: 'paused', prevStatus: 'active' }
    );

    expect(result.updatedStudents).toBe(0);
    expect(batchOps.some((op) => op.ref.path.includes('stu-trial'))).toBe(false);
  });

  it('resumes an on_leave enrollment back to active', async () => {
    const enrollment = enrollmentDoc('stu-2', 'class-6', 'on_leave');
    const { db, batchOps } = makeDb({
      enrollments: [enrollment],
      students: [studentDoc('stu-2', { classId: 'class-6', enrollmentStatus: 'on_leave' })],
    });

    await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      { status: 'active' },
      { status: 'active', prevStatus: 'paused' }
    );

    expect(batchOps).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ path: `student_course_enrollments/${enrollment.id}` }),
        data: expect.objectContaining({ status: 'active' }),
      })
    );
    expect(batchOps).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ path: 'students/stu-2' }),
        data: expect.objectContaining({ enrollmentStatus: 'active' }),
      })
    );
  });

  it('ignores a stale students.classId that has no matching open enrollment', async () => {
    // Reading this field is exactly the bug being removed: a document can claim
    // a class it has already left.
    const { db, batchOps } = makeDb({
      enrollments: [],
      students: [studentDoc('stu-stale', { classId: 'class-6', enrollmentStatus: 'active' })],
    });

    const result = await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      { status: 'paused' },
      { status: 'paused', prevStatus: 'active' }
    );

    expect(result.updatedStudents).toBe(0);
    // Only the class document itself changes; nothing derived from the stale
    // profile field.
    expect(batchOps).toEqual([
      expect.objectContaining({ ref: expect.objectContaining({ path: 'classes/class-6' }) }),
    ]);
  });
});

describe('teacher reassignment follows the same enrollment authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('projects the new teacherId only onto profiles with an open enrollment', async () => {
    const { db, batchOps } = makeDb({
      enrollments: [enrollmentDoc('stu-1', 'class-6', 'active')],
      students: [studentDoc('stu-1', { classId: 'class-6', teacherId: 'teacher-1' })],
    });

    const result = await executeClassUpdateAndSyncAtomic(
      db,
      'class-6',
      {},
      { teacherId: 'teacher-2', prevTeacherId: 'teacher-1' }
    );

    expect(result.updatedStudents).toBe(1);
    expect(batchOps).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ path: 'students/stu-1' }),
        data: expect.objectContaining({ teacherId: 'teacher-2' }),
      })
    );
  });
});

describe('write budget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to commit more than the atomic write limit', async () => {
    const enrollments = Array.from({ length: 250 }, (_, index) =>
      enrollmentDoc(`stu-${index}`, 'class-6', 'active')
    );
    const students = enrollments.map((enrollment) =>
      studentDoc(String(enrollment.data.studentId), {
        classId: 'class-6',
        enrollmentStatus: 'active',
      })
    );
    const { db } = makeDb({ enrollments, students });

    await expect(
      executeClassUpdateAndSyncAtomic(
        db,
        'class-6',
        { status: 'paused' },
        { status: 'paused', prevStatus: 'active' }
      )
    ).rejects.toThrow(/400-write/);
  });
});
