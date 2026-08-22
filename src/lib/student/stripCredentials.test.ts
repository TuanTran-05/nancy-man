import { describe, expect, it } from 'vitest';
import { stripStudentCredentials } from './stripCredentials';

describe('stripStudentCredentials', () => {
  const fullStudent = {
    id: 'abc123',
    name: 'Nguyen Van A',
    studentId: 'HS260001',
    dob: '2014-01-15',
    contact: '0901234567',
    classId: 'class-1',
    teacherId: 'teacher-1',
    createdAt: '2024-01-01',
    code: 'STU001',
    loginPasswordHash: 'hash123',
    loginPasswordSalt: 'salt456',
    passwordVersion: 2,
    parentPasswordHash: 'parenthash789',
    parentPasswordSalt: 'parentsalt012',
    parentPasswordVersion: 2,
    customLoginPasswordSet: true,
    parentPasswordSet: true,
    forcePasswordChange: false,
    parentForcePasswordChange: false,
    enrollmentStatus: 'active' as const,
    grade: 5,
  };

  it('removes all 6 credential fields', () => {
    const safe = stripStudentCredentials(fullStudent);

    expect(safe).not.toHaveProperty('loginPasswordHash');
    expect(safe).not.toHaveProperty('loginPasswordSalt');
    expect(safe).not.toHaveProperty('passwordVersion');
    expect(safe).not.toHaveProperty('parentPasswordHash');
    expect(safe).not.toHaveProperty('parentPasswordSalt');
    expect(safe).not.toHaveProperty('parentPasswordVersion');
  });

  it('preserves all non-credential fields', () => {
    const safe = stripStudentCredentials(fullStudent);

    expect(safe.id).toBe('abc123');
    expect(safe.name).toBe('Nguyen Van A');
    expect(safe.studentId).toBe('HS260001');
    expect(safe.dob).toBe('2014-01-15');
    expect(safe.contact).toBe('0901234567');
    expect(safe.classId).toBe('class-1');
    expect(safe.teacherId).toBe('teacher-1');
    expect(safe.code).toBe('STU001');
    expect(safe.enrollmentStatus).toBe('active');
    expect(safe.grade).toBe(5);
  });

  it('preserves boolean status flags', () => {
    const safe = stripStudentCredentials(fullStudent);

    expect(safe.customLoginPasswordSet).toBe(true);
    expect(safe.parentPasswordSet).toBe(true);
    expect(safe.forcePasswordChange).toBe(false);
    expect(safe.parentForcePasswordChange).toBe(false);
  });

  it('handles student with no credential fields set', () => {
    const minimal = {
      id: 'x',
      name: 'Test',
      studentId: 'HS001',
      dob: '2015-01-01',
      contact: '090',
      classId: 'c1',
      teacherId: 't1',
      createdAt: '2024-01-01',
      code: 'X',
    };
    const safe = stripStudentCredentials(minimal as any);

    expect(safe.name).toBe('Test');
    expect(Object.keys(safe)).toEqual(Object.keys(minimal));
  });
});
