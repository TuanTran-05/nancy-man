import { describe, expect, it } from 'vitest';
import { planStudentEnrollmentDateBackfill } from './backfill-student-enrollment-dates';

describe('planStudentEnrollmentDateBackfill', () => {
  it('removes enrollment dates from waitlist and first-time trial records', () => {
    const plan = planStudentEnrollmentDateBackfill(
      [
        {
          id: 'pending-1',
          data: {
            studentId: 'HS-PENDING',
            studentLifecycle: 'pending',
            enrollmentDate: '2026-05-01T00:00:00.000Z',
          },
        },
        {
          id: 'trial-1',
          data: {
            studentId: 'HS-TRIAL',
            studentLifecycle: 'trial',
            admissionStatus: 'trial',
            trialStartedAt: '2026-05-02T00:00:00.000Z',
            enrollmentDate: '2026-05-02T00:00:05.000Z',
          },
        },
        {
          id: 'rejected-1',
          data: {
            studentId: 'HS-REJECTED',
            studentLifecycle: 'archived',
            admissionStatus: 'rejected',
            enrollmentDate: '2026-05-03T00:00:00.000Z',
          },
        },
      ],
      []
    );

    expect(plan.operations).toEqual([
      expect.objectContaining({ studentDocId: 'pending-1', action: 'delete' }),
      expect.objectContaining({ studentDocId: 'trial-1', action: 'delete' }),
      expect.objectContaining({ studentDocId: 'rejected-1', action: 'delete' }),
    ]);
  });

  it('uses the teacher acceptance timestamp instead of the trial creation date', () => {
    const plan = planStudentEnrollmentDateBackfill(
      [
        {
          id: 'student-accepted',
          data: {
            studentId: 'HS260001',
            studentLifecycle: 'enrolled',
            admissionStatus: 'accepted',
            enrollmentStatus: 'active',
            enrollmentDate: '2026-05-01T00:00:00.000Z',
          },
        },
      ],
      [
        {
          data: {
            studentId: 'student-accepted',
            action: 'teacher_accepted',
            timestamp: '2026-05-10T08:30:00.000Z',
          },
        },
      ]
    );

    expect(plan.operations).toEqual([
      expect.objectContaining({
        studentDocId: 'student-accepted',
        action: 'set',
        enrollmentDate: '2026-05-10T08:30:00.000Z',
        reason: 'teacher_accepted_history',
      }),
    ]);
  });

  it('keeps the earliest enrollment date across class promotion documents', () => {
    const plan = planStudentEnrollmentDateBackfill(
      [
        {
          id: 'old-class-record',
          data: {
            studentId: 'HS260002',
            studentLifecycle: 'enrolled',
            enrollmentStatus: 'promoted',
            enrollmentDate: '2024-09-01T00:00:00.000Z',
          },
        },
        {
          id: 'new-class-record',
          data: {
            studentId: 'HS260002',
            studentLifecycle: 'enrolled',
            enrollmentStatus: 'active',
            enrollmentDate: '2025-09-01T00:00:00.000Z',
          },
        },
      ],
      []
    );

    expect(plan.operations).toEqual([
      expect.objectContaining({
        studentDocId: 'new-class-record',
        action: 'set',
        enrollmentDate: '2024-09-01T00:00:00.000Z',
      }),
    ]);
    expect(plan.unchangedCount).toBe(1);
  });

  it('does not overwrite a historical enrollment date during a reactivated trial', () => {
    const plan = planStudentEnrollmentDateBackfill(
      [
        {
          id: 'returning-student',
          data: {
            studentId: 'HS260003',
            studentLifecycle: 'trial',
            admissionStatus: 'trial',
            trialStartedAt: '2026-06-01T00:00:00.000Z',
            enrollmentDate: '2024-09-01T00:00:00.000Z',
          },
        },
      ],
      []
    );

    expect(plan.operations).toEqual([]);
    expect(plan.unchangedCount).toBe(1);
  });
});
