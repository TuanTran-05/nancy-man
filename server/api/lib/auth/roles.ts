export type AuthRole =
  | 'admin'
  | 'teacher'
  | 'accounting'
  | 'office'
  | 'student'
  | 'parent';

const ROLE_ALIASES: Record<string, AuthRole> = {
  admin: 'admin',
  administrator: 'admin',
  teacher: 'teacher',
  accounting: 'accounting',
  accountant: 'accounting',
  finance: 'accounting',
  ketoan: 'accounting',
  ke_toan: 'accounting',
  'ke-toan': 'accounting',
  office: 'office',
  van_phong: 'office',
  'van-phong': 'office',
  vanphong: 'office',
  student: 'student',
  parent: 'parent',
};

export function normalizeAuthRole(value: unknown): AuthRole | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return ROLE_ALIASES[key] || null;
}
