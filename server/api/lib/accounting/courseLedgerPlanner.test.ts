import { describe, expect, it } from 'vitest';
import type { StudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';
import { planClassLedgers } from './courseLedgerPlanner.js';

const activeClass = { name: 'G3 Alpha', status: 'active', tuitionFee: 900_000 };

function enrollment(
  overrides: Partial<{
    id: string;
    studentId: string;
    classId: string;
    termStart: string;
    termEnd: string | null;
    status: StudentCourseEnrollmentStatus;
  }> = {}
) {
  return {
    id: 'e1',
    studentId: 's1',
    classId: 'c1',
    termStart: '2026-01-05',
    termEnd: '2026-06-05' as string | null,
    status: 'active' as StudentCourseEnrollmentStatus,
    ...overrides,
  };
}

describe('planClassLedgers class-level gates', () => {
  it('skips a class whose document is missing', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: null,
      enrollments: [enrollment()],
      ledgers: [],
    });
    expect(plan.skipReason).toBe('class_not_found');
    expect(plan.creates).toEqual([]);
  });

  it('skips an archived class', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: { ...activeClass, status: 'archived' },
      enrollments: [enrollment()],
      ledgers: [],
    });
    expect(plan.skipReason).toBe('class_archived');
    expect(plan.creates).toEqual([]);
  });

  it('skips a class with no tuition configured', () => {
    for (const tuitionFee of [0, undefined, -1]) {
      const plan = planClassLedgers({
        classId: 'c1',
        classData: { ...activeClass, tuitionFee },
        enrollments: [enrollment()],
        ledgers: [],
      });
      expect(plan.skipReason).toBe('tuition_not_configured');
      expect(plan.creates).toEqual([]);
    }
  });

  it('still audits duplicates inside a skipped class', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: { ...activeClass, status: 'archived' },
      enrollments: [],
      ledgers: [
        { id: 'a', studentId: 's1', termStart: '2026-01-05' },
        { id: 'b', studentId: 's1', termStart: '2026-01-05' },
      ],
    });
    expect(plan.skipReason).toBe('class_archived');
    expect(plan.duplicates).toEqual([
      { studentId: 's1', termStart: '2026-01-05', ledgerIds: ['a', 'b'] },
    ]);
  });
});

describe('planClassLedgers enrollment selection', () => {
  it('creates a ledger for every open enrollment status', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [
        enrollment({ id: 'e1', studentId: 's1', status: 'active' }),
        enrollment({ id: 'e2', studentId: 's2', status: 'trial' }),
        enrollment({ id: 'e3', studentId: 's3', status: 'on_leave' }),
      ],
      ledgers: [],
    });
    expect(plan.creates.map((row) => row.studentId)).toEqual(['s1', 's2', 's3']);
    expect(plan.creates[0].amount).toBe(900_000);
  });

  it('ignores closed enrollments', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [
        enrollment({ id: 'e1', studentId: 's1', status: 'completed' }),
        enrollment({ id: 'e2', studentId: 's2', status: 'transferred' }),
        enrollment({ id: 'e3', studentId: 's3', status: 'dropped' }),
      ],
      ledgers: [],
    });
    expect(plan.creates).toEqual([]);
  });

  it('takes the term from the enrollment, not the class', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: { ...activeClass, startDate: '2020-01-01', endDate: '2020-12-31' },
      enrollments: [enrollment({ termStart: '2026-01-05', termEnd: '2026-06-05' })],
      ledgers: [],
    });
    expect(plan.creates[0].termStart).toBe('2026-01-05');
    expect(plan.creates[0].termEnd).toBe('2026-06-05');
    expect(plan.creates[0].ledgerId).toBe('s1_c1_2026-01-05_2026-06-05');
  });

  it('carries the enrollment id onto the planned ledger', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [enrollment({ id: 'enr-42' })],
      ledgers: [],
    });
    expect(plan.creates[0].enrollmentId).toBe('enr-42');
  });
});

describe('planClassLedgers deduplication', () => {
  it('treats a ledger with a different termEnd as already existing', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [enrollment({ termStart: '2026-01-05', termEnd: '2026-07-10' })],
      ledgers: [{ id: 's1_c1_2026-01-05_2026-06-05', studentId: 's1', termStart: '2026-01-05' }],
    });
    expect(plan.creates).toEqual([]);
    expect(plan.alreadyExists).toBe(1);
  });

  /**
   * Production shape, not a hypothetical: 43 ledgers carry a doc id whose
   * termStart segment predates the termStart in their own fields. Keying on the
   * id makes the planner miss them and bill the course twice.
   */
  it('treats a ledger whose doc id disagrees with its own termStart as already existing', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [enrollment({ termStart: '2026-06-14', termEnd: '2026-08-09' })],
      ledgers: [{ id: 's1_c1_2026-06-20_2026-08-09', studentId: 's1', termStart: '2026-06-14' }],
    });
    expect(plan.creates).toEqual([]);
    expect(plan.alreadyExists).toBe(1);
  });

  it('reports pre-existing duplicates without creating more', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [enrollment()],
      ledgers: [
        { id: 's1_c1_2026-01-05_2026-06-05', studentId: 's1', termStart: '2026-01-05' },
        { id: 's1_c1_2026-01-05_2026-07-10', studentId: 's1', termStart: '2026-01-05' },
      ],
    });
    expect(plan.creates).toEqual([]);
    expect(plan.duplicates).toEqual([
      {
        studentId: 's1',
        termStart: '2026-01-05',
        ledgerIds: ['s1_c1_2026-01-05_2026-06-05', 's1_c1_2026-01-05_2026-07-10'],
      },
    ]);
  });

  it('creates one ledger when two enrollment rows share a tuple', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [enrollment({ id: 'e1' }), enrollment({ id: 'e1-dup' })],
      ledgers: [],
    });
    expect(plan.creates).toHaveLength(1);
    expect(plan.alreadyExists).toBe(1);
  });

  it('still creates when a ledger exists for a different term of the same class', () => {
    const plan = planClassLedgers({
      classId: 'c1',
      classData: activeClass,
      enrollments: [enrollment({ termStart: '2026-07-01', termEnd: '2026-12-01' })],
      ledgers: [{ id: 's1_c1_2026-01-05_2026-06-05', studentId: 's1', termStart: '2026-01-05' }],
    });
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].termStart).toBe('2026-07-01');
  });
});
