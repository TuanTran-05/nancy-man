import type { DocumentStore } from '@/server/db/documentStore.js';
import { normalizeAuthRole, type AuthRole } from './roles.js';
import { canManageAcademicRecords, canManageFinance } from './permissions.js';
import { canStudentParentLogin } from '../../../../shared/studentLifecycle.js';
import { resolveLinkedStudentProfileId } from '../student/canonicalAuthIdentity.js';
import {
  isOpenStudentCourseEnrollmentStatus,
  type StudentCourseEnrollmentStatus,
} from '../../../../shared/studentCourseEnrollment.js';

export type UserContext = {
  uid: string;
  email?: string;
  role: AuthRole | '';
  name: string;
  studentId?: string;
  classId?: string;
  teacherId?: string;
  isBlocked?: boolean;
};

type AuthIdentity = { uid: string; email?: string };

export function withAuthzStatus(
  message: string,
  statusCode: number
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export function buildUserContextFromData(
  user: AuthIdentity,
  data: Record<string, unknown>,
  isBlocked = false
): UserContext {
  const role = normalizeAuthRole(data.role) || '';
  return {
    uid: user.uid,
    email: user.email,
    role,
    name: String(data.displayName || data.name || user.email || user.uid),
    studentId: typeof data.studentId === 'string' ? data.studentId : undefined,
    classId: typeof data.classId === 'string' ? data.classId : undefined,
    teacherId: typeof data.teacherId === 'string' ? data.teacherId : undefined,
    isBlocked,
  };
}

export async function getUserContext(
  db: DocumentStore,
  user: AuthIdentity
): Promise<UserContext> {
  const snap = await db.collection('users').doc(user.uid).get();
  if (!snap.exists) {
    console.warn('[getUserContext] User document not found', { uid: user.uid });
  }
  const data = snap.data() || {};
  const role = normalizeAuthRole(data.role) || '';
  const storedStudentId = typeof data.studentId === 'string' ? data.studentId : undefined;

  // The account stores the profile id it was linked against, and a merge
  // retires that id. Every downstream check compares against `ctx.studentId`,
  // so resolving here is what stops one merge from turning a working session
  // into a student who owns nothing and belongs to no class.
  const studentId =
    role === 'student' || role === 'parent'
      ? storedStudentId && (await resolveLinkedStudentProfileId(db, storedStudentId))
      : storedStudentId;

  // Check blocked status
  let isBlocked = false;
  if (data.blockedTeacher === true) {
    isBlocked = true;
  } else if ((role === 'student' || role === 'parent') && studentId) {
    const studentSnap = await db.collection('students').doc(studentId).get();
    const studentData = studentSnap.data();
    if (!canStudentParentLogin(studentData || {})) {
      isBlocked = true;
    }
  }

  return {
    ...buildUserContextFromData(user, data, isBlocked),
    ...(studentId ? { studentId } : {}),
  };
}

export function requireRole(user: UserContext, roles: AuthRole[]): void {
  if (!user.role || !roles.includes(user.role)) {
    throw withAuthzStatus('Insufficient permissions', 403);
  }
}

export function assertActiveUser(user: UserContext): void {
  if (user.isBlocked) {
    throw withAuthzStatus('Account has been revoked', 403);
  }
}


function normalizeClassName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function getClassGrade(classData: Record<string, unknown>): number {
  const grade = Number(classData.grade || 0);
  if (Number.isInteger(grade) && grade >= 1 && grade <= 12) return grade;

  const name = String(classData.name || '');
  if (!name) return 0;

  const normalizedName = normalizeClassName(name);
  const gradePattern = '(0?[1-9]|1[0-2])';
  const patterns = [
    new RegExp(`\\b(?:grade|khoi|k|g)\\s*${gradePattern}\\b`, 'i'),
    new RegExp(`\\b(?:advance|advanced)\\s*${gradePattern}\\b`, 'i'),
    new RegExp(`(?:^|\\D)${gradePattern}(?:\\D|$)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = normalizedName.match(pattern);
    if (!match) continue;

    const parsedGrade = Number(match[1]);
    if (parsedGrade >= 1 && parsedGrade <= 12) return parsedGrade;
  }

  return 0;
}

export async function assertClassAccess(
  db: DocumentStore,
  user: UserContext,
  classId: string,
  mode: 'read' | 'write' | 'finance' = 'read'
): Promise<Record<string, unknown>> {
  if (!classId) throw withAuthzStatus('Missing classId', 400);
  const classSnap = await db.collection('classes').doc(classId).get();
  if (!classSnap.exists) throw withAuthzStatus('Class not found', 404);
  const classData = classSnap.data() || {};

  if (canManageAcademicRecords(user.role)) return classData;
  if (mode === 'finance' && canManageFinance(user.role)) return classData;
  if (mode === 'read' && canManageFinance(user.role)) return classData;
  if (user.role === 'teacher' && String(classData.teacherId || '') === user.uid) return classData;
  if (
    mode === 'read' &&
    (user.role === 'student' || user.role === 'parent') &&
    (user.classId === classId ||
      (user.studentId && (await studentBelongsToClass(db, user.studentId, classId))))
  ) {
    return classData;
  }

  throw withAuthzStatus('Not authorized for this class', 403);
}

/**
 * Whether a student is in a class, asked of the enrollment.
 *
 * `students.classId` is a projection written alongside the enrollment, and it
 * goes stale the moment anything moves a student without refreshing it. Used
 * as an access rule that means a family locked out of the class their child
 * actually attends, or still able to open the one they left.
 *
 * The profile field is kept as a fallback while it is still maintained:
 * production holds students with no enrollment record, and answering "not in
 * any class" for them would revoke access they legitimately have.
 */
export async function studentBelongsToClass(
  db: DocumentStore,
  studentId: string,
  classId: string
): Promise<boolean> {
  if (!studentId || !classId) return false;

  const enrollments = await db
    .collection('student_course_enrollments')
    .where('studentId', '==', studentId)
    .where('classId', '==', classId)
    .get();
  const openHere = enrollments.docs.some((doc) =>
    isOpenStudentCourseEnrollmentStatus(
      String(doc.data()?.status || '') as StudentCourseEnrollmentStatus
    )
  );
  if (openHere) return true;

  const snap = await db.collection('students').doc(studentId).get();
  return snap.exists && String(snap.data()?.classId || '') === classId;
}

export async function assertStudentInClass(
  db: DocumentStore,
  studentId: string,
  classId: string
): Promise<Record<string, unknown>> {
  if (!studentId) throw withAuthzStatus('Missing studentId', 400);
  const snap = await db.collection('students').doc(studentId).get();
  if (!snap.exists) throw withAuthzStatus('Student not found', 404);
  const student = snap.data() || {};
  if (!(await studentBelongsToClass(db, studentId, classId))) {
    throw withAuthzStatus('Student does not belong to this class', 400);
  }
  return student;
}

export function assertFinanceAccess(user: UserContext): void {
  requireRole(user, ['admin', 'accounting']);
}

export async function assertCanReadStudentScopedResource(
  db: DocumentStore,
  user: UserContext,
  requestedStudentId: string
): Promise<Record<string, unknown>> {
  if (!requestedStudentId) throw withAuthzStatus('Missing studentId', 400);
  // Compared canonically on both sides. A parent holding a link written before
  // a merge asks about the retired id while their session carries the
  // surviving one, and a raw string compare calls that somebody else's child.
  const studentId = await resolveLinkedStudentProfileId(db, requestedStudentId);
  const studentSnap = await db.collection('students').doc(studentId).get();
  if (!studentSnap.exists) throw withAuthzStatus('Student not found', 404);
  const student = studentSnap.data() || {};

  if (user.role === 'admin' || user.role === 'accounting' || user.role === 'office') return student;
  if (user.role === 'teacher' && String(student.teacherId || '') === user.uid) return student;
  if ((user.role === 'student' || user.role === 'parent') && user.studentId === studentId) {
    return student;
  }
  throw withAuthzStatus('Not authorized for this student', 403);
}
