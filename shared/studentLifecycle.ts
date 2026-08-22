export type EnrollmentStatus = 'active' | 'on_leave' | 'dropped' | 'promoted';
export type StudentLifecycle = 'pending' | 'lead' | 'trial' | 'enrolled' | 'archived';
export type TrialReviewStatus =
  | 'pending_sessions'
  | 'pending_teacher_review'
  | 'accepted'
  | 'rejected';

export const ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  'active',
  'on_leave',
  'dropped',
  'promoted',
] as const;

export const STUDENT_LIFECYCLES: readonly StudentLifecycle[] = [
  'pending',
  'lead',
  'trial',
  'enrolled',
  'archived',
] as const;

export const TRIAL_REVIEW_STATUSES: readonly TrialReviewStatus[] = [
  'pending_sessions',
  'pending_teacher_review',
  'accepted',
  'rejected',
] as const;

type StudentLifecycleRecord = {
  studentLifecycle?: unknown;
  enrollmentStatus?: unknown;
  isRevoked?: unknown;
  deletedAt?: unknown;
};

export type LinkedStudentUserRole = 'student' | 'parent';
export type LinkedStudentAccessBlockReason =
  | 'revoked'
  | 'inactive_lifecycle'
  | 'dropped_student'
  | 'dropped_parent';

export type LinkedStudentAccessBlock = {
  reason: LinkedStudentAccessBlockReason;
};

type LinkedStudentAccessRecord = StudentLifecycleRecord & {
  statusChangedAt?: unknown;
};

export function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  return typeof value === 'string' && ENROLLMENT_STATUSES.includes(value as EnrollmentStatus);
}

export function isStudentLifecycle(value: unknown): value is StudentLifecycle {
  return typeof value === 'string' && STUDENT_LIFECYCLES.includes(value as StudentLifecycle);
}

export function isTrialReviewStatus(value: unknown): value is TrialReviewStatus {
  return typeof value === 'string' && TRIAL_REVIEW_STATUSES.includes(value as TrialReviewStatus);
}

export function deriveStudentLifecycle(record: StudentLifecycleRecord): StudentLifecycle {
  if (record.isRevoked === true || Boolean(record.deletedAt)) return 'archived';
  if (isStudentLifecycle(record.studentLifecycle)) return record.studentLifecycle;
  return 'enrolled';
}

export function isCurrentLifecycle(record: StudentLifecycleRecord): boolean {
  const lifecycle = deriveStudentLifecycle(record);
  return lifecycle === 'trial' || lifecycle === 'enrolled';
}

export function isArchivedLifecycle(record: StudentLifecycleRecord): boolean {
  return deriveStudentLifecycle(record) === 'archived';
}

/**
 * A retired profile's own record that its access was withdrawn.
 *
 * A merge tombstone keeps no name, no contact, and no money — everything moved
 * to the surviving profile. Nothing else here recognises one: it carries no
 * `isRevoked`, no `deletedAt`, and no lifecycle, so every rule below reads it
 * as an ordinary enrolled student. Authenticating against it produces a
 * working session for a record with nothing in it, which is worse than a
 * refusal because only the refusal is visible.
 */
function isAuthDisabledRecord(record: StudentLifecycleRecord): boolean {
  return (record as { authDisabled?: unknown }).authDisabled === true;
}

export function canStudentParentLogin(record: StudentLifecycleRecord): boolean {
  if (isAuthDisabledRecord(record)) return false;
  if (record.isRevoked === true) return false;
  if (record.enrollmentStatus === 'dropped') return false;
  return deriveStudentLifecycle(record) === 'enrolled';
}

function parseTime(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function getLinkedStudentAccessBlock(
  record: LinkedStudentAccessRecord,
  role: LinkedStudentUserRole,
  nowMs = Date.now()
): LinkedStudentAccessBlock | null {
  if (isAuthDisabledRecord(record)) return { reason: 'revoked' };
  if (record.isRevoked === true || Boolean(record.deletedAt)) return { reason: 'revoked' };

  const lifecycle = deriveStudentLifecycle(record);
  if (lifecycle !== 'enrolled') return { reason: 'inactive_lifecycle' };

  if (record.enrollmentStatus !== 'dropped') return null;
  if (role === 'student') return { reason: 'dropped_student' };

  const changedAtMs = parseTime(record.statusChangedAt);
  if (!changedAtMs) return { reason: 'dropped_parent' };

  const daysSinceDropped = (nowMs - changedAtMs) / (1000 * 3600 * 24);
  return daysSinceDropped <= 30 ? null : { reason: 'dropped_parent' };
}
