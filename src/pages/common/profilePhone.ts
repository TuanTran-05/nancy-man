import { normalizePhoneVN } from '../../../shared/phone';
import type { UserProfile } from '../../types';

const INTERNAL_STAFF_ROLES = new Set<UserProfile['role']>([
  'admin',
  'teacher',
  'accounting',
  'office',
]);

export function canManageProfilePhone(role: UserProfile['role'] | undefined): boolean {
  return Boolean(role && INTERNAL_STAFF_ROLES.has(role));
}

export function displayVNPhone(phone: string | undefined): string {
  if (!phone) return '';
  const normalized = normalizePhoneVN(phone);
  if (/^84\d{9}$/.test(normalized)) return `0${normalized.slice(2)}`;
  return phone;
}
