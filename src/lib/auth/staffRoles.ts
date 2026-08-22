import { BriefcaseBusiness, Calculator, GraduationCap } from 'lucide-react';
import type { translations } from '../../lib/i18n/translations';

export type AdminStaffRole = 'teacher' | 'office' | 'accounting';

export type AdminStaffProfile = {
  uid: string;
  email?: string;
  displayName?: string;
  role: string;
  phone?: string;
  createdAt?: string;
};

export const ADMIN_STAFF_ROLES: AdminStaffRole[] = ['teacher', 'office', 'accounting'];

export const TEACHING_STAFF_ROLES: AdminStaffRole[] = ['teacher'];

export function isAdminStaffRole(role: string | undefined): role is AdminStaffRole {
  return ADMIN_STAFF_ROLES.includes(role as AdminStaffRole);
}

export function isTeachingStaffRole(role: string | undefined): role is AdminStaffRole {
  return TEACHING_STAFF_ROLES.includes(role as AdminStaffRole);
}

export function getAdminStaffRoleLabel(
  ap: (typeof translations)['en']['adminPage'],
  role: string | undefined
) {
  const labels: Record<AdminStaffRole, string> = {
    teacher: ap.staffRoleTeacher,
    office: ap.staffRoleOffice,
    accounting: ap.staffRoleAccounting,
  };
  return isAdminStaffRole(role) ? labels[role] : ap.staffRoleUnknown;
}

export function getAdminStaffSectionTitle(
  t: (typeof translations)['en']['adminDashboard'],
  role: AdminStaffRole
) {
  return t.staffTab.sections[role].title;
}

export function getAdminStaffSectionEmpty(
  t: (typeof translations)['en']['adminDashboard'],
  role: AdminStaffRole
) {
  return t.staffTab.sections[role].empty;
}

export const adminStaffRoleIcons = {
  teacher: GraduationCap,
  office: BriefcaseBusiness,
  accounting: Calculator,
} satisfies Record<AdminStaffRole, typeof GraduationCap>;

export const adminStaffRoleAccentClasses = {
  teacher: 'bg-blue-100 text-blue-600',
  office: 'bg-violet-100 text-violet-600',
  accounting: 'bg-amber-100 text-amber-700',
} satisfies Record<AdminStaffRole, string>;
