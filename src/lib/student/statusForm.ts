import { deriveStudentLifecycle } from '../../../shared/studentLifecycle';
import type { EnrollmentStatus, StudentLifecycle } from '../../types';

type StudentStatusFormRecord = {
  enrollmentStatus?: EnrollmentStatus;
  studentLifecycle?: StudentLifecycle;
  isRevoked?: boolean;
  deletedAt?: unknown;
};

type StudentStatusLocalPatch = {
  enrollmentStatus: EnrollmentStatus;
  studentLifecycle: StudentLifecycle;
  isRevoked: boolean;
  statusNote: string;
};

export function getStudentStatusFormValue(student: StudentStatusFormRecord): EnrollmentStatus {
  if (deriveStudentLifecycle(student) === 'archived') return 'dropped';
  return student.enrollmentStatus || 'active';
}

export function getStudentStatusLocalPatch(
  enrollmentStatus: EnrollmentStatus,
  statusNote: string
): StudentStatusLocalPatch {
  return {
    enrollmentStatus,
    studentLifecycle: 'enrolled',
    isRevoked: false,
    statusNote,
  };
}
