import { describe, expect, it } from 'vitest';
import type { StudentCourseEnrollment } from '../../shared/studentCourseEnrollment.js';
import {
  assertSafeEnrollmentPlan,
  fingerprintClassSource,
  fingerprintStudentSource,
  planSafeStudentEnrollmentBackfill,
} from './planner.js';
import type { SafeEnrollmentPlannerInput, SourceDoc } from './types.js';

const generatedAt = '2026-08-01T02:00:00.000Z';
const vietnamDate = '2026-08-15';

function source(
  id: string,
  data: Record<string, unknown>,
  updateTime = '2026-08-01T01:00:00.000Z'
): SourceDoc {
  return { id, data, updateTime };
}

function input(overrides: Partial<SafeEnrollmentPlannerInput> = {}): SafeEnrollmentPlannerInput {
  return {
    students: [source('student-1', { classId: 'class-1', enrollmentStatus: 'active' })],
    classes: [source('class-1', { startDate: '2026-08-01', endDate: '2026-08-31' })],
    existingByStudent: new Map(),
    generatedAt,
    vietnamDate,
    ...overrides,
  };
}

function existingEnrollment(studentId = 'student-1'): StudentCourseEnrollment {
  return {
    id: 'existing-enrollment',
    studentId,
    classId: 'class-old',
    termStart: '2026-07-01',
    termEnd: '2026-07-31',
    status: 'completed',
    joinedAt: '2026-07-01',
    endedAt: '2026-07-31',
    statusReason: 'course_completed',
    source: 'manual',
    confidence: 'confirmed',
    statusChangedAt: '2026-07-31T00:00:00.000Z',
    statusChangedBy: 'office-user',
    confirmedAt: '2026-07-31T00:00:00.000Z',
    confirmedBy: 'office-user',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

describe('safe student enrollment planner', () => {
  it('creates one active enrollment from the current class range and ignores historical terms', () => {
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        classes: [
          source('class-1', {
            startDate: '2026-08-01',
            endDate: '2026-08-31',
            terms: [
              { startDate: '2026-06-01', endDate: '2026-06-30' },
              { startDate: '2026-07-01', endDate: '2026-07-31' },
            ],
          }),
        ],
      })
    );

    const creates = plan.items.filter((item) => item.decision === 'create');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      studentId: 'student-1',
      classId: 'class-1',
      reason: 'SAFE_CURRENT_ENROLLMENT',
      candidate: {
        enrollment: {
          id: 'WyJzdHVkZW50LTEiLCJjbGFzcy0xIiwiMjAyNi0wOC0wMSJd',
          studentId: 'student-1',
          classId: 'class-1',
          termStart: '2026-08-01',
          termEnd: '2026-08-31',
          status: 'active',
          joinedAt: '2026-08-01',
          endedAt: null,
          statusReason: 'safe_current_enrollment_backfill',
          source: 'backfill',
          confidence: 'inferred',
          statusChangedAt: generatedAt,
          statusChangedBy: 'migration:safe-student-course-enrollments-v2',
          confirmedAt: null,
          confirmedBy: null,
          createdAt: generatedAt,
          updatedAt: generatedAt,
        },
      },
    });
    expect(plan.summary).toMatchObject({
      scannedStudents: 1,
      create: 1,
      byStatus: { active: 1, on_leave: 0 },
    });
    expect(plan.invariants).toEqual({
      duplicateCandidateStudentIds: [],
      duplicateCandidateDocumentIds: [],
      invalidCandidateDocumentIds: [],
    });
  });

  it('maps on_leave without opening an active enrollment', () => {
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        students: [source('student-1', { classId: 'class-1', enrollmentStatus: 'on_leave' })],
      })
    );
    expect(plan.items[0].candidate?.enrollment.status).toBe('on_leave');
    expect(plan.summary.byStatus).toEqual({ active: 0, on_leave: 1 });
  });

  it.each([
    ['promoted', 'NON_CURRENT_STATUS'],
    ['dropped', 'NON_CURRENT_STATUS'],
    ['', 'NON_CURRENT_STATUS'],
  ] as const)('excludes legacy status %s', (enrollmentStatus, reason) => {
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        students: [source('student-1', { classId: 'class-1', enrollmentStatus })],
      })
    );
    expect(plan.items[0]).toMatchObject({ decision: 'exclude', reason });
  });

  it('gives archived lifecycle precedence over legacy active status', () => {
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        students: [
          source('student-1', {
            classId: 'class-1',
            enrollmentStatus: 'active',
            studentLifecycle: 'archived',
          }),
        ],
      })
    );
    expect(plan.items[0]).toMatchObject({ decision: 'exclude', reason: 'ARCHIVED_STUDENT' });
  });

  it('excludes a student with any canonical enrollment, including completed history', () => {
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        existingByStudent: new Map([['student-1', [existingEnrollment()]]]),
      })
    );
    expect(plan.items[0]).toMatchObject({ decision: 'exclude', reason: 'EXISTING_ENROLLMENT' });
  });

  it.each([
    [{ enrollmentStatus: 'active' }, [], 'MISSING_CLASS_ID'],
    [{ classId: 'unknown', enrollmentStatus: 'active' }, [], 'MISSING_CLASS'],
    [
      { classId: 'class-1', enrollmentStatus: 'active' },
      [{ id: 'class-1', data: { startDate: '01/08/2026' } }],
      'INVALID_CLASS_START',
    ],
    [
      { classId: 'class-1', enrollmentStatus: 'active' },
      [{ id: 'class-1', data: { startDate: '2026-09-01' } }],
      'FUTURE_CLASS',
    ],
    [
      { classId: 'class-1', enrollmentStatus: 'active' },
      [{ id: 'class-1', data: { startDate: '2026-08-01', endDate: '31/08/2026' } }],
      'INVALID_CLASS_END',
    ],
    [
      { classId: 'class-1', enrollmentStatus: 'active' },
      [{ id: 'class-1', data: { startDate: '2026-07-01', endDate: '2026-07-31' } }],
      'ENDED_CLASS',
    ],
  ] as const)('excludes unsafe class source as %s', (studentData, rawClasses, reason) => {
    const classes = rawClasses.map((item) => source(item.id, item.data));
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        students: [source('student-1', studentData)],
        classes,
      })
    );
    expect(plan.items[0]).toMatchObject({ decision: 'exclude', reason });
  });

  it.each([
    ['2026-07-15', '2026-08-01'],
    ['2026-08-12', '2026-08-12'],
    ['2026-09-05', '2026-08-31'],
    [undefined, '2026-08-01'],
  ] as const)('bounds enrollmentDate %s to joinedAt %s', (enrollmentDate, joinedAt) => {
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        students: [
          source('student-1', {
            classId: 'class-1',
            enrollmentStatus: 'active',
            ...(enrollmentDate ? { enrollmentDate } : {}),
          }),
        ],
      })
    );
    expect(plan.items[0].candidate?.enrollment.joinedAt).toBe(joinedAt);
  });

  it('sorts output by student ID for stable manifests', () => {
    const plan = planSafeStudentEnrollmentBackfill(
      input({
        students: [
          source('student-z', { classId: 'class-1', enrollmentStatus: 'active' }),
          source('student-a', { classId: 'class-1', enrollmentStatus: 'active' }),
        ],
      })
    );
    expect(plan.items.map((item) => item.studentId)).toEqual(['student-a', 'student-z']);
  });

  it('detects duplicate student and document candidates and rejects the plan', () => {
    const duplicate = source('student-1', { classId: 'class-1', enrollmentStatus: 'active' });
    const plan = planSafeStudentEnrollmentBackfill(input({ students: [duplicate, duplicate] }));
    expect(plan.invariants.duplicateCandidateStudentIds).toEqual(['student-1']);
    expect(plan.invariants.duplicateCandidateDocumentIds).toEqual([
      'WyJzdHVkZW50LTEiLCJjbGFzcy0xIiwiMjAyNi0wOC0wMSJd',
    ]);
    expect(() => assertSafeEnrollmentPlan(plan)).toThrow('SAFE_ENROLLMENT_PLAN_INVARIANT_FAILED');
  });

  it('fingerprints only source fields that can change the approved candidate', () => {
    const baseStudent = source('student-1', {
      classId: 'class-1',
      enrollmentStatus: 'active',
      name: 'Name A',
    });
    const renamedStudent = source('student-1', {
      classId: 'class-1',
      enrollmentStatus: 'active',
      name: 'Name B',
    });
    const changedStatus = source('student-1', {
      classId: 'class-1',
      enrollmentStatus: 'on_leave',
      name: 'Name A',
    });
    expect(fingerprintStudentSource(baseStudent)).toBe(fingerprintStudentSource(renamedStudent));
    expect(fingerprintStudentSource(baseStudent)).not.toBe(fingerprintStudentSource(changedStatus));

    const baseClass = source('class-1', {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      terms: [],
    });
    const addedHistory = source('class-1', {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      terms: [{ startDate: '2026-07-01', endDate: '2026-07-31' }],
    });
    const changedEnd = source('class-1', {
      startDate: '2026-08-01',
      endDate: '2026-09-01',
      terms: [],
    });
    expect(fingerprintClassSource(baseClass)).toBe(fingerprintClassSource(addedHistory));
    expect(fingerprintClassSource(baseClass)).not.toBe(fingerprintClassSource(changedEnd));
  });
});
