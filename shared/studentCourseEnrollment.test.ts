import { describe, expect, it } from 'vitest';
import {
  assertValidStudentCourseEnrollment,
  makeStudentCourseEnrollmentId,
  transitionStudentCourseEnrollment,
} from './studentCourseEnrollment';

const active = {
  id: makeStudentCourseEnrollmentId('student/01', 'class A', '2026-07-01'),
  studentId: 'student/01',
  classId: 'class A',
  termStart: '2026-07-01',
  termEnd: '2026-09-30',
  status: 'active' as const,
  joinedAt: '2026-07-03',
  endedAt: null,
  statusReason: null,
  source: 'system' as const,
  confidence: 'confirmed' as const,
  statusChangedAt: '2026-07-03T01:00:00.000Z',
  statusChangedBy: 'admin-1',
  confirmedAt: '2026-07-03T01:00:00.000Z',
  confirmedBy: 'admin-1',
  createdAt: '2026-07-03T01:00:00.000Z',
  updatedAt: '2026-07-03T01:00:00.000Z',
};

describe('student course enrollment identity', () => {
  it('is deterministic, URL-safe, and changes when any tuple member changes', () => {
    const id = makeStudentCourseEnrollmentId('student/01', 'class A', '2026-07-01');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id).toBe(makeStudentCourseEnrollmentId('student/01', 'class A', '2026-07-01'));
    expect(id).not.toBe(makeStudentCourseEnrollmentId('student/01', 'class A', '2026-08-01'));
  });
});

describe('assertValidStudentCourseEnrollment', () => {
  it('rejects current as termStart and rejects an identity mismatch', () => {
    expect(() =>
      assertValidStudentCourseEnrollment({ ...active, termStart: 'current' })
    ).toThrow(/termStart/);
    expect(() =>
      assertValidStudentCourseEnrollment({ ...active, id: 'wrong-id' })
    ).toThrow(/identity/);
  });

  it('requires endedAt for closed states and forbids it for open states', () => {
    expect(() =>
      assertValidStudentCourseEnrollment({ ...active, status: 'completed', endedAt: null })
    ).toThrow(/endedAt/);
    expect(() =>
      assertValidStudentCourseEnrollment({ ...active, endedAt: '2026-08-01' })
    ).toThrow(/open/);
  });
});

describe('transitionStudentCourseEnrollment', () => {
  it('supports active -> on_leave -> active without closing the enrollment', () => {
    const onLeave = transitionStudentCourseEnrollment(active, {
      status: 'on_leave',
      statusReason: 'family',
      at: '2026-07-20T01:00:00.000Z',
      by: 'office-1',
    });
    expect(onLeave).toMatchObject({ status: 'on_leave', endedAt: null });
    expect(
      transitionStudentCourseEnrollment(onLeave, {
        status: 'active',
        statusReason: 'returned',
        at: '2026-07-25T01:00:00.000Z',
        by: 'office-1',
      })
    ).toMatchObject({ status: 'active', endedAt: null });
  });

  it.each(['completed', 'transferred', 'dropped'] as const)(
    'closes active -> %s with endedAt',
    (status) => {
      expect(
        transitionStudentCourseEnrollment(active, {
          status,
          endedAt: '2026-08-01',
          statusReason: status,
          at: '2026-08-01T01:00:00.000Z',
          by: 'admin-1',
        })
      ).toMatchObject({ status, endedAt: '2026-08-01' });
    }
  );
});
