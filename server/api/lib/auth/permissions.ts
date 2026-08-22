import { normalizeAuthRole, type AuthRole } from './roles.js';

type RoleInput = AuthRole | string | null | undefined;

export function asAuthRole(role: RoleInput): AuthRole | '' {
  return normalizeAuthRole(role) || '';
}

export function canManageAcademicRecords(role: RoleInput): boolean {
  const normalized = asAuthRole(role);
  return normalized === 'admin' || normalized === 'office';
}

export function canManageStaff(role: RoleInput): boolean {
  return asAuthRole(role) === 'admin';
}

export function canManageFinance(role: RoleInput): boolean {
  const normalized = asAuthRole(role);
  return normalized === 'admin' || normalized === 'accounting';
}

export function canManageClassFinanceFields(role: RoleInput): boolean {
  const normalized = asAuthRole(role);
  return normalized === 'admin' || normalized === 'office';
}

export function canReviewTrial(role: RoleInput): boolean {
  return asAuthRole(role) === 'admin' || asAuthRole(role) === 'teacher';
}

export function isOffice(role: RoleInput): boolean {
  return asAuthRole(role) === 'office';
}
