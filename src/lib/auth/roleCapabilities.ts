import type { UserRole } from '../../app/types';

export function canUseOfficeAdmissions(role: UserRole | string | undefined): boolean {
  return role === 'admin' || role === 'office';
}

export function canUseAcademicRecords(role: UserRole | string | undefined): boolean {
  return role === 'admin' || role === 'office' || role === 'teacher';
}

export function isOfficeRole(role: UserRole | string | undefined): boolean {
  return role === 'office';
}
