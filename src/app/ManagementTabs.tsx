import { Link, useLocation } from 'react-router';
import { cn } from '../lib/core/utils';
import { translations } from '../lib/i18n/translations';
import { useLanguage } from '../lib/i18n/useLanguage';
import { isOfficeRole } from '../lib/auth/roleCapabilities';

export type ManagementGroup = 'teachers' | 'classes';

type TabRole = 'admin' | 'office';

type TabLabelKey =
  | 'teachers'
  | 'teacherAttendance'
  | 'classes'
  | 'knowledgeBank'
  | 'substituteRequests';

const GROUP_TABS: Record<
  ManagementGroup,
  ReadonlyArray<{ labelKey: TabLabelKey | null; path: string; roles: ReadonlyArray<TabRole> }>
> = {
  teachers: [
    { labelKey: 'teachers', path: '/teachers', roles: ['admin', 'office'] },
    { labelKey: 'teacherAttendance', path: '/teacher-attendance', roles: ['admin', 'office'] },
    // labelKey null → literal 'Availability', same convention as Sidebar
    { labelKey: null, path: '/teacher-availability', roles: ['admin', 'office'] },
  ],
  classes: [
    { labelKey: 'classes', path: '/classes', roles: ['admin', 'office'] },
    { labelKey: 'knowledgeBank', path: '/knowledge-bank', roles: ['admin'] },
    { labelKey: 'substituteRequests', path: '/substitute-requests', roles: ['admin'] },
  ],
};

export const ManagementTabs = ({
  group,
  role,
}: {
  group: ManagementGroup;
  role?: string | null;
}) => {
  const location = useLocation();
  const { language } = useLanguage();
  const t = translations[language].app;

  const normalizedRole: TabRole | null =
    role === 'admin' ? 'admin' : isOfficeRole(role ?? undefined) ? 'office' : null;
  if (!normalizedRole) return null;

  const tabs = GROUP_TABS[group].filter((tab) => tab.roles.includes(normalizedRole));
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label={group === 'teachers' ? t.manageTeachers : t.manageClasses}
      className="mb-6 flex w-fit max-w-full flex-wrap gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800/60"
    >
      {tabs.map((tab) => {
        const isActive =
          location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={cn(
              'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
              isActive
                ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            )}
          >
            {tab.labelKey ? t[tab.labelKey] : 'Availability'}
          </Link>
        );
      })}
    </nav>
  );
};
