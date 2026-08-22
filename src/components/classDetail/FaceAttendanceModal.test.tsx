import { describe, expect, it } from 'vitest';
import {
  getFaceAttendanceEligibility,
  shouldBuildFaceDescriptorForStudent,
  getFaceAttendanceMarkDecision,
} from './FaceAttendanceModal';
import type { Student } from '../../types';

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: 'student-1',
    name: 'Student One',
    studentId: 'HS260001',
    dob: '2012-01-01',
    contact: '0384072314',
    classId: 'class-1',
    teacherId: 'teacher-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    faceImageStoragePath: 'student_faces/teacher-1/student-1/face.jpg',
    code: 'HS260001',
    enrollmentStatus: 'active',
    studentLifecycle: 'enrolled',
    ...overrides,
  };
}

describe('face attendance student eligibility', () => {
  it('allows active students to be recognized and marked', () => {
    const result = getFaceAttendanceEligibility(student());

    expect(result).toEqual({
      canBuildDescriptor: true,
      canMarkAttendance: true,
      blockReason: null,
    });
    expect(shouldBuildFaceDescriptorForStudent(student())).toBe(true);
  });

  it('recognizes on-leave students but blocks attendance writes', () => {
    const result = getFaceAttendanceEligibility(
      student({ enrollmentStatus: 'on_leave', leaveUntil: '2026-06-15' })
    );

    expect(result).toEqual({
      canBuildDescriptor: true,
      canMarkAttendance: false,
      blockReason: 'on_leave',
    });
    expect(shouldBuildFaceDescriptorForStudent(student({ enrollmentStatus: 'on_leave' }))).toBe(
      true
    );
  });

  it.each([
    ['dropped', student({ enrollmentStatus: 'dropped' })],
    ['promoted', student({ enrollmentStatus: 'promoted' })],
    ['archived lifecycle', student({ studentLifecycle: 'archived' })],
    ['revoked', student({ isRevoked: true })],
  ])('excludes %s students from the matcher', (_label, row) => {
    const result = getFaceAttendanceEligibility(row);

    expect(result.canBuildDescriptor).toBe(false);
    expect(result.canMarkAttendance).toBe(false);
    expect(shouldBuildFaceDescriptorForStudent(row)).toBe(false);
  });

  it('does not build descriptors for students without face image metadata', () => {
    expect(
      shouldBuildFaceDescriptorForStudent(
        student({
          faceImage: '',
          faceImageStoragePath: '',
        })
      )
    ).toBe(false);
  });

  it('builds descriptors only for recognizable attendance students', () => {
    const rows = [
      student({ id: 'active', enrollmentStatus: 'active' }),
      student({ id: 'leave', enrollmentStatus: 'on_leave' }),
      student({ id: 'dropped', enrollmentStatus: 'dropped' }),
      student({ id: 'promoted', enrollmentStatus: 'promoted' }),
      student({ id: 'archived', studentLifecycle: 'archived' }),
      student({ id: 'revoked', isRevoked: true }),
    ];

    expect(rows.filter(shouldBuildFaceDescriptorForStudent).map((row) => row.id)).toEqual([
      'active',
      'leave',
    ]);
  });
});

describe('face attendance mark decision', () => {
  it('marks active same-class students', () => {
    expect(getFaceAttendanceMarkDecision(student(), 'class-1')).toEqual({
      kind: 'mark',
      labelTone: 'success',
    });
  });

  it('blocks on-leave same-class students', () => {
    expect(
      getFaceAttendanceMarkDecision(student({ enrollmentStatus: 'on_leave' }), 'class-1')
    ).toEqual({
      kind: 'blocked',
      reason: 'on_leave',
      labelTone: 'warning',
    });
  });

  it('keeps wrong-class behavior separate from status policy', () => {
    expect(getFaceAttendanceMarkDecision(student({ classId: 'other-class' }), 'class-1')).toEqual({
      kind: 'wrong_class',
      labelTone: 'warning',
    });
  });
});
