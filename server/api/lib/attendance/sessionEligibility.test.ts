import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { resolveAttendanceEligibilityBatch } from './sessionEligibility.js';

function enrollment(
  studentId: string,
  classId: string,
  termStart: string,
  joinedAt: string,
  endedAt: string | null = null,
  status: string = 'active'
) {
  const id = makeStudentCourseEnrollmentId(studentId, classId, termStart);
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId,
      classId,
      termStart,
      termEnd: '2026-08-31',
      status,
      joinedAt,
      endedAt,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: `${termStart}T00:00:00.000Z`,
      statusChangedBy: 'seed',
      confirmedAt: `${termStart}T00:00:00.000Z`,
      confirmedBy: 'seed',
      createdAt: `${termStart}T00:00:00.000Z`,
      updatedAt: `${termStart}T00:00:00.000Z`,
    },
  };
}

describe('resolveAttendanceEligibilityBatch', () => {
  it('resolves canonical joinedAt boundary and membership', async () => {
    const { db } = createInMemoryDocumentStore({
      ...enrollment('student-1', 'class-1', '2026-05-01', '2026-05-20'),
    });

    const result = await resolveAttendanceEligibilityBatch(db as any, {
      classId: 'class-1',
      termStart: '2026-05-01',
      termEnd: '2026-08-31',
      date: '2026-05-10',
      studentsById: new Map([
        [
          'student-1',
          {
            courseJoins: [],
            leavePeriods: [],
            enrollmentDate: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    });

    expect(result.get('student-1')).toEqual({
      eligibility: 'not_enrolled',
      hasClassMembership: true,
    });
  });

  it('handles class membership precedence correctly', async () => {
    const { db } = createInMemoryDocumentStore({
      ...enrollment('student-canonical', 'class-1', '2026-05-01', '2026-05-01'),
    });

    const result = await resolveAttendanceEligibilityBatch(db as any, {
      classId: 'class-1',
      termStart: '2026-05-01',
      termEnd: '2026-08-31',
      date: '2026-05-10',
      studentsById: new Map([
        ['student-canonical', { classId: 'class-stale' }],
        ['student-legacy', { courseJoins: [{ classId: 'class-1', termStart: '2026-05-01', joinedAt: '2026-05-01' }] }],
        ['student-profile', { classId: 'class-1' }],
        ['student-floor-only', { enrollmentDate: '2026-01-01' }],
      ]),
    });

    expect(result.get('student-canonical')?.hasClassMembership).toBe(true);
    expect(result.get('student-legacy')?.hasClassMembership).toBe(true);
    expect(result.get('student-profile')?.hasClassMembership).toBe(true);
    expect(result.get('student-floor-only')?.hasClassMembership).toBe(false);
  });

  it('resolves date after canonical endedAt as not_enrolled', async () => {
    const { db } = createInMemoryDocumentStore({
      ...enrollment('student-1', 'class-1', '2026-05-01', '2026-05-01', '2026-07-31', 'completed'),
    });

    const result = await resolveAttendanceEligibilityBatch(db as any, {
      classId: 'class-1',
      termStart: '2026-05-01',
      termEnd: '2026-08-31',
      date: '2026-08-01',
      studentsById: new Map([['student-1', {}]]),
    });

    expect(result.get('student-1')).toEqual({
      eligibility: 'not_enrolled',
      hasClassMembership: true,
    });
  });

  it('falls back to valid exact legacy evidence if canonical evidence is missing or malformed', async () => {
    const { db } = createInMemoryDocumentStore({});

    const result = await resolveAttendanceEligibilityBatch(db as any, {
      classId: 'class-1',
      termStart: '2026-05-01',
      termEnd: '2026-08-31',
      date: '2026-05-10',
      studentsById: new Map([
        [
          'student-1',
          {
            courseJoins: [{ classId: 'class-1', termStart: '2026-05-01', joinedAt: '2026-05-01' }],
          },
        ],
      ]),
    });

    expect(result.get('student-1')).toEqual({
      eligibility: 'eligible',
      hasClassMembership: true,
    });
  });
});
