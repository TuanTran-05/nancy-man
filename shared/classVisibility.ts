type ClassVisibilityInput = {
  status?: unknown;
  endDate?: unknown;
};

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getVietnamTodayDateOnly(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function isEndedClass(
  classData: ClassVisibilityInput | null | undefined,
  today: string = getVietnamTodayDateOnly()
): boolean {
  const endDate = String(classData?.endDate || '').trim();
  return DATE_ONLY_PATTERN.test(endDate) && endDate < today;
}

export function isArchivedClass(classData: ClassVisibilityInput | null | undefined): boolean {
  return String(classData?.status || 'active') === 'archived';
}

export function isClassVisibleForRoleOutsideAdminDashboard(
  classData: ClassVisibilityInput | null | undefined,
  role: string | null | undefined
): boolean {
  if (role === 'admin') return true;
  return !isArchivedClass(classData);
}

export function filterClassesForRoleOutsideAdminDashboard<T>(
  classes: readonly T[],
  role: string | null | undefined
): T[] {
  if (role === 'admin') return [...classes];
  return classes.filter((classData) => !isArchivedClass(classData as ClassVisibilityInput));
}
