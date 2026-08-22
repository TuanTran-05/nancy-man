import { describe, expect, it } from 'vitest';
import {
  STUDENT_INDEX_QUERY_FIELDS,
  isStudentProjectionView,
  projectStudent,
} from './studentProjection.js';

const rawStudent = {
  id: 'stu-1',
  name: 'Student One',
  studentId: 'HS260001',
  code: 'HS260001',
  classId: 'class-1',
  teacherId: 'teacher-1',
  dob: '2012-01-01',
  contact: '0384072314',
  gender: 'female',
  enrollmentStatus: 'active',
  studentLifecycle: 'enrolled',
  enrollmentDate: '2026-02-03T04:05:06.000Z',
  faceImage: 'face-data',
  faceImageStoragePath: 'faces/stu-1.jpg',
  forcePasswordChange: true,
  parentForcePasswordChange: false,
  loginPasswordHash: 'do-not-return',
  parentPasswordSalt: 'do-not-return',
  internalOnly: 'do-not-return',
};

describe('projectStudent', () => {
  it('returns a compact complete-index row without contact, face, or credential data', () => {
    const projected = projectStudent(rawStudent, 'index');

    expect(projected).toEqual({
      id: 'stu-1',
      name: 'Student One',
      studentId: 'HS260001',
      code: 'HS260001',
      classId: 'class-1',
      teacherId: 'teacher-1',
      dob: '2012-01-01',
      gender: 'female',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    });
    expect(projected).not.toHaveProperty('contact');
    expect(projected).not.toHaveProperty('faceImage');
    expect(projected).not.toHaveProperty('faceImageStoragePath');
    expect(projected).not.toHaveProperty('loginPasswordHash');
  });

  it('returns only identity fields for minimal lookups', () => {
    expect(projectStudent(rawStudent, 'identity')).toEqual({
      id: 'stu-1',
      name: 'Student One',
      studentId: 'HS260001',
      code: 'HS260001',
      classId: 'class-1',
    });
  });

  it('keeps academic data free of contact and face fields', () => {
    expect(projectStudent(rawStudent, 'academic')).toEqual({
      id: 'stu-1',
      name: 'Student One',
      studentId: 'HS260001',
      code: 'HS260001',
      classId: 'class-1',
      teacherId: 'teacher-1',
      dob: '2012-01-01',
      gender: 'female',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
      enrollmentDate: '2026-02-03T04:05:06.000Z',
    });
  });

  it('returns contact and display image fields only for authorized directory consumers', () => {
    const projected = projectStudent(rawStudent, 'directory');

    expect(projected).toMatchObject({
      contact: '0384072314',
      faceImage: 'face-data',
      faceImageStoragePath: 'faces/stu-1.jpg',
    });
    expect(projected).not.toHaveProperty('loginPasswordHash');
    expect(projected).not.toHaveProperty('parentPasswordSalt');
    expect(projected).not.toHaveProperty('internalOnly');
  });

  it('exposes wallet list fields only in the finance projection', () => {
    const walletStudent = {
      ...rawStudent,
      isRevoked: false,
      walletBalance: 500_000,
      walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
      walletOpeningBalance: 400_000,
    };
    expect(projectStudent(walletStudent, 'finance')).toMatchObject({
      dob: '2012-01-01',
      contact: '0384072314',
      isRevoked: false,
      walletBalance: 500_000,
      walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
      walletOpeningBalance: 400_000,
    });
    expect(projectStudent(walletStudent, 'directory')).not.toHaveProperty('walletBalance');
    expect(projectStudent(walletStudent, 'session')).not.toHaveProperty('walletHistoryStartedAt');
  });

  it('returns finance identity data without face fields', () => {
    const projected = projectStudent(rawStudent, 'finance');

    expect(projected).toMatchObject({
      id: 'stu-1',
      name: 'Student One',
      dob: '2012-01-01',
      contact: '0384072314',
    });
    expect(projected).not.toHaveProperty('faceImage');
    expect(projected).not.toHaveProperty('faceImageStoragePath');
  });

  it('returns own face data in session projection without contact fields', () => {
    const projected = projectStudent(rawStudent, 'session');

    expect(projected).toMatchObject({
      id: 'stu-1',
      faceImage: 'face-data',
      faceImageStoragePath: 'faces/stu-1.jpg',
      forcePasswordChange: true,
      parentForcePasswordChange: false,
    });
    expect(projected).not.toHaveProperty('contact');
  });

  it('returns face data for attendance without directory contact data', () => {
    const projected = projectStudent(rawStudent, 'attendance');

    expect(projected).toMatchObject({
      id: 'stu-1',
      dob: '2012-01-01',
      faceImage: 'face-data',
      faceImageStoragePath: 'faces/stu-1.jpg',
    });
    expect(projected).not.toHaveProperty('contact');
    expect(projected).not.toHaveProperty('internalOnly');
  });
});

describe('isStudentProjectionView', () => {
  it('accepts named views and rejects an unknown view', () => {
    expect(isStudentProjectionView('index')).toBe(true);
    expect(isStudentProjectionView('directory')).toBe(true);
    expect(isStudentProjectionView('raw')).toBe(false);
  });
});

describe('projectStudent siblingGroupId', () => {
  const linkedStudent = { ...rawStudent, siblingGroupId: 'sib-1' };

  it.each(['index', 'academic', 'directory', 'finance', 'attendance'] as const)(
    'exposes siblingGroupId in the %s view',
    (view) => {
      expect(projectStudent(linkedStudent, view).siblingGroupId).toBe('sib-1');
    }
  );

  it('keeps siblingGroupId out of the identity view', () => {
    expect(projectStudent(linkedStudent, 'identity')).not.toHaveProperty('siblingGroupId');
  });

  it('omits siblingGroupId for an unlinked student', () => {
    expect(projectStudent(rawStudent, 'index')).not.toHaveProperty('siblingGroupId');
  });

  it('still withholds credentials from a linked student', () => {
    const projected = projectStudent(linkedStudent, 'directory');
    expect(projected).not.toHaveProperty('loginPasswordHash');
    expect(projected).not.toHaveProperty('parentPasswordSalt');
    expect(projected).not.toHaveProperty('internalOnly');
  });

  it('selects siblingGroupId in the index query field list', () => {
    expect(STUDENT_INDEX_QUERY_FIELDS).toContain('siblingGroupId');
  });
});
