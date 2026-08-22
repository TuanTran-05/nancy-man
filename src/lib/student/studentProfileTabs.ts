export type StudentProfileTab = 'overview' | 'academic' | 'finance';

const ALL_TABS: readonly StudentProfileTab[] = ['overview', 'academic', 'finance'];

export function getVisibleStudentProfileTabs(role: string | undefined): StudentProfileTab[] {
  const tabs: StudentProfileTab[] = ['overview'];
  if (role === 'admin' || role === 'office' || role === 'teacher') tabs.push('academic');
  if (role === 'admin' || role === 'accounting') tabs.push('finance');
  return tabs;
}

export function resolveStudentProfileTab(
  requested: string | null | undefined,
  visible: StudentProfileTab[]
): StudentProfileTab {
  if (
    requested &&
    (ALL_TABS as readonly string[]).includes(requested) &&
    visible.includes(requested as StudentProfileTab)
  ) {
    return requested as StudentProfileTab;
  }
  return visible[0] ?? 'overview';
}
