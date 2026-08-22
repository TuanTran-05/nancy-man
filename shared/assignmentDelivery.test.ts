import { describe, expect, it } from 'vitest';
import {
  canStudentAccessAssignment,
  canStudentReviewAssignmentResults,
  normalizeAssignmentDeliveryPolicy,
  validateAssignmentDeliveryPolicy,
} from './assignmentDelivery';

describe('assignment delivery policy', () => {
  it('defaults missing policy to class-wide immediate release', () => {
    expect(normalizeAssignmentDeliveryPolicy(undefined)).toEqual({
      targetMode: 'class',
      assignedStudentIds: [],
      availableFrom: '',
      resultReleasePolicy: 'after_submit',
    });
  });

  it('requires selected students for selected-student targeting', () => {
    expect(() =>
      validateAssignmentDeliveryPolicy({
        targetMode: 'selected_students',
        assignedStudentIds: [],
        availableFrom: '',
        resultReleasePolicy: 'after_due',
      })
    ).toThrow('Selected-student assignments require at least one student');
  });

  it('checks class, target, and availability before student access', () => {
    const assignment = {
      classId: 'class-1',
      deliveryPolicy: {
        targetMode: 'selected_students',
        assignedStudentIds: ['student-1'],
        availableFrom: '2026-06-12T10:00:00.000Z',
        resultReleasePolicy: 'manual',
      },
    };

    expect(
      canStudentAccessAssignment(
        assignment,
        { classId: 'class-1', studentId: 'student-1' },
        new Date('2026-06-12T09:59:59.000Z')
      )
    ).toBe(false);
    expect(
      canStudentAccessAssignment(
        assignment,
        { classId: 'class-1', studentId: 'student-2' },
        new Date('2026-06-12T10:00:00.000Z')
      )
    ).toBe(false);
    expect(
      canStudentAccessAssignment(
        assignment,
        { classId: 'class-1', studentId: 'student-1' },
        new Date('2026-06-12T10:00:00.000Z')
      )
    ).toBe(true);
  });

  it('enforces result release policy for student review', () => {
    const base = {
      dueDate: '2026-06-12T10:00:00.000Z',
      submissionCount: 1,
      now: new Date('2026-06-12T09:00:00.000Z'),
    };

    expect(
      canStudentReviewAssignmentResults({
        ...base,
        deliveryPolicy: {
          targetMode: 'class',
          assignedStudentIds: [],
          availableFrom: '',
          resultReleasePolicy: 'after_submit',
        },
      })
    ).toBe(true);

    expect(
      canStudentReviewAssignmentResults({
        ...base,
        deliveryPolicy: {
          targetMode: 'class',
          assignedStudentIds: [],
          availableFrom: '',
          resultReleasePolicy: 'after_due',
        },
      })
    ).toBe(false);

    expect(
      canStudentReviewAssignmentResults({
        ...base,
        now: new Date('2026-06-12T11:00:00.000Z'),
        deliveryPolicy: {
          targetMode: 'class',
          assignedStudentIds: [],
          availableFrom: '',
          resultReleasePolicy: 'after_due',
        },
      })
    ).toBe(true);

    expect(
      canStudentReviewAssignmentResults({
        ...base,
        now: new Date('2026-06-12T11:00:00.000Z'),
        deliveryPolicy: {
          targetMode: 'class',
          assignedStudentIds: [],
          availableFrom: '',
          resultReleasePolicy: 'manual',
        },
      })
    ).toBe(false);
  });
});
