import { describe, expect, it } from 'vitest';

import { getClassGrade, buildUserContextFromData, assertCanReadStudentScopedResource } from './authz';

describe('getClassGrade', () => {
  it('uses explicit grade before parsing the class name', () => {
    expect(getClassGrade({ name: 'G9', grade: 7 })).toBe(7);
  });

  it('parses common grade formats from legacy class names', () => {
    expect(getClassGrade({ name: 'Advanced 6' })).toBe(6);
    expect(getClassGrade({ name: 'G8' })).toBe(8);
    expect(getClassGrade({ name: 'G5-CS2' })).toBe(5);
  });
});

describe('buildUserContextFromData', () => {
  it('builds user context without requiring another DocumentStore read', () => {
    const ctx = buildUserContextFromData(
      { uid: 'u1', email: 'teacher@example.com' } as any,
      {
        role: 'teacher',
        displayName: 'Teacher One',
        classId: 'class-1',
        teacherId: 'teacher-1',
      },
      false
    );

    expect(ctx).toEqual({
      uid: 'u1',
      email: 'teacher@example.com',
      role: 'teacher',
      name: 'Teacher One',
      classId: 'class-1',
      teacherId: 'teacher-1',
      studentId: undefined,
      isBlocked: false,
    });
  });

  it('marks blocked users when the caller already resolved blocked state', () => {
    const ctx = buildUserContextFromData(
      { uid: 'u2' } as any,
      { role: 'student', studentId: 'student-1' },
      true
    );

    expect(ctx.isBlocked).toBe(true);
    expect(ctx.studentId).toBe('student-1');
  });
});

function dbWithStudent(student: Record<string, unknown>) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => student }),
      }),
    }),
  } as any;
}

describe('assertCanReadStudentScopedResource (real ownership rule)', () => {
  const db = dbWithStudent({ name: 'S', classId: 'class-1', teacherId: 'teacher-1' });

  it('lets a student read only their own record', async () => {
    await expect(
      assertCanReadStudentScopedResource(
        db,
        { uid: 'student:stu-1', role: 'student', name: '', studentId: 'stu-1' } as any,
        'stu-1'
      )
    ).resolves.toBeTruthy();
    await expect(
      assertCanReadStudentScopedResource(
        db,
        { uid: 'student:stu-1', role: 'student', name: '', studentId: 'stu-1' } as any,
        'stu-2'
      )
    ).rejects.toThrow(/not authorized/i);
  });

  it('denies a parent reading another linked student', async () => {
    await expect(
      assertCanReadStudentScopedResource(
        db,
        { uid: 'parent:stu-1', role: 'parent', name: '', studentId: 'stu-1' } as any,
        'stu-2'
      )
    ).rejects.toThrow(/not authorized/i);
  });

  it('lets a teacher read only their own students', async () => {
    await expect(
      assertCanReadStudentScopedResource(
        db,
        { uid: 'teacher-1', role: 'teacher', name: '' } as any,
        'stu-1'
      )
    ).resolves.toBeTruthy();
    await expect(
      assertCanReadStudentScopedResource(
        db,
        { uid: 'teacher-2', role: 'teacher', name: '' } as any,
        'stu-1'
      )
    ).rejects.toThrow(/not authorized/i);
  });
});
