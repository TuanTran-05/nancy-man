// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { SafeStudent, UserProfile } from '../../types';
import { getStudentProfileNavigationTarget } from './Students';

const student = {
  id: 'student-1',
  name: 'Nguyen Van A',
  studentId: 'HS001',
  dob: '2012-08-06',
  contact: '0345647924',
  classId: 'class-1',
  teacherId: 'teacher-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  code: 'A001',
} satisfies SafeStudent;

describe('getStudentProfileNavigationTarget', () => {
  it('builds the Student 360 target with student and parent-login seed', () => {
    const parentProfiles = [
      {
        uid: 'parent-1',
        role: 'parent',
        studentId: 'student-1',
        updatedAt: '2026-07-18T01:02:03.000Z',
      },
    ] as UserProfile[];

    expect(getStudentProfileNavigationTarget(student, parentProfiles)).toEqual({
      pathname: '/students/student-1',
      options: {
        state: {
          student: expect.objectContaining({ id: 'student-1' }),
          parentLoginInfo: { updatedAt: '2026-07-18T01:02:03.000Z' },
        },
      },
    });
  });

  it('normalises a DocumentStore timestamp parent login into an ISO string', () => {
    const parentProfiles = [
      {
        uid: 'parent-1',
        role: 'parent',
        studentId: 'student-1',
        updatedAt: { seconds: 1783694596, nanoseconds: 286_000_000 },
      },
    ] as unknown as UserProfile[];

    expect(getStudentProfileNavigationTarget(student, parentProfiles).options.state).toEqual({
      student: expect.objectContaining({ id: 'student-1' }),
      parentLoginInfo: { updatedAt: new Date(1783694596_286).toISOString() },
    });
  });

  it('uses an explicit null parent-login seed when the parent profile is absent', () => {
    expect(getStudentProfileNavigationTarget(student, [])).toEqual({
      pathname: '/students/student-1',
      options: {
        state: {
          student,
          parentLoginInfo: null,
        },
      },
    });
  });

  it('omits the parent-login seed while parent profiles have not loaded', () => {
    expect(getStudentProfileNavigationTarget(student, [], false)).toEqual({
      pathname: '/students/student-1',
      options: {
        state: {
          student,
          parentLoginInfo: undefined,
        },
      },
    });
  });
});
