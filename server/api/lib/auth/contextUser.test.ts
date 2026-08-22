import { describe, expect, it } from 'vitest';
import {
  authUserFromContext,
  mutationUserInfoFromContext,
  staffActorFromContext,
} from './contextUser.js';
import type { UserContext } from './authz.js';

const context: UserContext = {
  uid: 'teacher-1',
  email: 'teacher@example.com',
  role: 'teacher',
  name: 'Teacher One',
  classId: 'class-1',
  studentId: 'student-1',
  teacherId: 'teacher-1',
};

describe('contextUser helpers', () => {
  it('builds legacy handler user shape from auth context', () => {
    expect(authUserFromContext(context)).toEqual({
      uid: 'teacher-1',
      email: 'teacher@example.com',
    });
  });

  it('builds mutation audit metadata from auth context', () => {
    expect(mutationUserInfoFromContext(context)).toEqual({
      role: 'teacher',
      name: 'Teacher One',
    });
  });

  it('builds staff actor metadata for APIs that need role and displayName', () => {
    expect(staffActorFromContext(context)).toEqual({
      uid: 'teacher-1',
      email: 'teacher@example.com',
      role: 'teacher',
      name: 'Teacher One',
      displayName: 'Teacher One',
      studentId: 'student-1',
      classId: 'class-1',
      teacherId: 'teacher-1',
    });
  });
});
