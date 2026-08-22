export type StudentParentRole = 'student' | 'parent';

export interface StudentParentAuthContext {
  role: StudentParentRole;
  studentId: string;
}

export function isStudentParentRole(value: unknown): value is StudentParentRole {
  return value === 'student' || value === 'parent';
}

export function expectedStudentParentUid(role: StudentParentRole, studentId: string): string {
  return `${role}:${studentId}`;
}

export function getStudentParentAuthContext(
  uid: string,
  tokenClaims: Record<string, unknown>,
  userData: Record<string, unknown> | undefined
): StudentParentAuthContext | null {
  if (!userData) return null;

  const role = userData.role;
  const studentId = userData.studentId;

  if (!isStudentParentRole(role) || typeof studentId !== 'string' || !studentId) {
    return null;
  }

  if (userData.uid && userData.uid !== uid) {
    return null;
  }

  if (uid !== expectedStudentParentUid(role, studentId)) {
    return null;
  }

  if (tokenClaims.role !== role || tokenClaims.studentId !== studentId) {
    return null;
  }

  return { role, studentId };
}

export function requestedTargetMatchesAuthContext(
  body: Record<string, unknown>,
  context: StudentParentAuthContext
): boolean {
  const requestedStudentDocId = body.studentDocId;
  const requestedType = body.type;

  if (requestedStudentDocId !== undefined && requestedStudentDocId !== context.studentId) {
    return false;
  }

  if (requestedType !== undefined && requestedType !== context.role) {
    return false;
  }

  return true;
}
