import type { UserContext } from './authz.js';

export type LegacyAuthUser = {
  uid: string;
  email?: string;
};

export type MutationUserInfo = {
  role: string;
  name: string;
};

export type StaffActor = LegacyAuthUser &
  MutationUserInfo & {
    displayName: string;
    studentId?: string;
    teacherId?: string;
    classId?: string;
  };

export function authUserFromContext(ctx: UserContext): LegacyAuthUser {
  return {
    uid: ctx.uid,
    email: ctx.email,
  };
}

export function mutationUserInfoFromContext(ctx: UserContext): MutationUserInfo {
  return {
    role: ctx.role,
    name: ctx.name,
  };
}

export function staffActorFromContext(ctx: UserContext): StaffActor {
  return {
    uid: ctx.uid,
    email: ctx.email,
    role: ctx.role,
    name: ctx.name,
    displayName: ctx.name,
    studentId: ctx.studentId,
    teacherId: ctx.teacherId,
    classId: ctx.classId,
  };
}
