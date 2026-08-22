import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  DollarSign,
  Gamepad2,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  Shield,
  ShieldAlert,
  UserCircle,
  UserPlus,
  Users,
  Printer,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useLocation } from 'react-router';
import { CENTER_LOGO_URL } from '../lib/brand';
import type { UserProfile } from '../types';
import { cn } from '../lib/core/utils';
import { translations } from '../lib/i18n/translations';
import { useLanguage } from '../lib/i18n/useLanguage';
import { useProfileFaceUrl } from './useProfileFaceUrl';
import { isOfficeRole } from '../lib/auth/roleCapabilities';

export const Sidebar = ({
  isOpen,
  setIsOpen,
  profile,
  onSignOut,
  isSigningOut = false,
  pendingPrintRequests = 0,
}: {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  profile: UserProfile | null;
  onSignOut: () => void;
  isSigningOut?: boolean;
  pendingPrintRequests?: number;
}) => {
  const location = useLocation();
  const { language } = useLanguage();
  const t = translations[language].app;
  const availabilityLabel = 'Availability';

  const teacherNavSections = [
    { label: t.sectionOverview, items: [{ name: t.dashboard, path: '/', icon: LayoutDashboard }] },
    {
      label: t.sectionManagement,
      items: [
        { name: t.classes, path: '/classes', icon: BookOpen },
        { name: t.calendar, path: '/calendar', icon: CalendarDays },
        { name: t.students, path: '/students', icon: Users },
        { name: t.assignments, path: '/assignments', icon: ClipboardList },
        { name: t.knowledgeBank, path: '/knowledge-bank', icon: BookOpen },
        { name: t.gameZone, path: '/game-zone', icon: Gamepad2 },
      ],
    },
    { label: t.sectionReports, items: [{ name: t.reports, path: '/reports', icon: BarChart3 }] },
    {
      label: t.sectionSettings,
      items: [
        { name: t.substituteRequests, path: '/substitute-requests', icon: ArrowLeftRight },
        { name: availabilityLabel, path: '/teacher-availability', icon: CalendarCheck },
        { name: t.passwordResets, path: '/password-resets', icon: ShieldAlert },
        { name: t.printSupport, path: '/print-support', icon: Printer },
      ],
    },
  ];

  const studentNavSections = [
    { label: t.sectionOverview, items: [{ name: t.home, path: '/', icon: LayoutDashboard }] },
    {
      label: t.sectionManagement,
      items: [{ name: t.assignments, path: '/assignments', icon: ClipboardList }],
    },
  ];

  const parentNavSections = [
    {
      label: t.sectionOverview,
      items: [{ name: t.learningResults, path: '/', icon: LayoutDashboard }],
    },
    {
      label: t.sectionManagement,
      items: [{ name: t.tuition, path: '/parent/tuition', icon: DollarSign }],
    },
  ];

  const adminNavSections = [
    {
      label: t.sectionOverview,
      items: [{ name: t.dashboard, path: '/admin', icon: LayoutDashboard }],
    },
    {
      label: t.sectionManagement,
      items: [
        { name: t.manageStudents, path: '/students', icon: Users, matchPaths: ['/students'] },
        {
          name: t.manageTeachers,
          path: '/teachers',
          icon: GraduationCap,
          matchPaths: ['/teachers', '/teacher-attendance', '/teacher-availability'],
        },
        {
          name: t.manageClasses,
          path: '/classes',
          icon: BookOpen,
          matchPaths: ['/classes', '/knowledge-bank', '/substitute-requests', '/lesson-player'],
        },
      ],
    },
    {
      label: t.sectionReports,
      items: [
        { name: t.reports, path: '/reports', icon: BarChart3 },
        { name: t.financeReport, path: '/admin/finance-report', icon: DollarSign },
        { name: t.courseClosingRecords, path: '/course-closing-records', icon: ClipboardList },
      ],
    },
    {
      label: t.sectionSettings,
      items: [
        { name: t.auditLog, path: '/audit-log', icon: Shield },
        { name: t.zaloOa, path: '/admin/zalo-oa', icon: MessageCircle },
      ],
    },
  ];

  const accountingNavSections = [
    {
      label: t.sectionManagement,
      items: [
        { name: t.finance, path: '/tuition', icon: DollarSign },
        { name: t.payroll, path: '/payroll', icon: ClipboardList },
        { name: t.tuitionNoticeArchive, path: '/course-closing-records', icon: ClipboardList },
      ],
    },
    {
      label: t.sectionSettings,
      items: [{ name: t.profile, path: '/profile', icon: UserCircle }],
    },
  ];

  const officeNavSections = [
    {
      label: t.sectionOverview,
      items: [{ name: t.dashboard, path: '/office-dashboard', icon: LayoutDashboard }],
    },
    {
      label: t.sectionManagement,
      items: [
        { name: t.academic, path: '/academic', icon: GraduationCap },
        { name: t.admissions, path: '/admissions', icon: UserPlus },
        {
          name: t.manageTeachers,
          path: '/teachers',
          icon: Users,
          matchPaths: ['/teachers', '/teacher-attendance', '/teacher-availability'],
        },
        { name: t.manageClasses, path: '/classes', icon: BookOpen, matchPaths: ['/classes'] },
        { name: t.manageStudents, path: '/students', icon: Users, matchPaths: ['/students'] },
        { name: t.courseClosingRecords, path: '/course-closing-records', icon: ClipboardList },
        {
          name: t.printSupport,
          path: '/print-support',
          icon: Printer,
          badge: pendingPrintRequests > 0 ? pendingPrintRequests : undefined,
        },
      ],
    },
    {
      label: t.sectionSettings,
      items: [{ name: t.system, path: '/admin', icon: LayoutDashboard }],
    },
  ];

  let navSections = studentNavSections;
  if (profile?.role === 'teacher') navSections = teacherNavSections;
  else if (profile?.role === 'parent') navSections = parentNavSections;
  else if (profile?.role === 'admin') navSections = adminNavSections;
  else if (profile?.role === 'accounting') navSections = accountingNavSections;
  else if (isOfficeRole(profile?.role)) navSections = officeNavSections;

  const isAdmin = profile?.role === 'admin';
  const isTeacher = profile?.role === 'teacher';
  const isParent = profile?.role === 'parent';
  const isAccounting = profile?.role === 'accounting';
  const isOffice = isOfficeRole(profile?.role);
  const profileFaceUrl = useProfileFaceUrl(profile);

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsOpen(false);
    }
  };

  const roleLabel = isAdmin
    ? t.roles.admin
    : isTeacher
      ? t.roles.teacher
      : isParent
        ? t.roles.parent
        : isAccounting
          ? t.roles.accounting
          : isOffice
            ? t.office
            : t.roles.student;
  const sidebarToggleLabel = isOpen ? 'Collapse sidebar' : 'Expand sidebar';

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 bottom-0 z-50 overflow-hidden transition-all duration-300 ease-in-out lg:static lg:translate-x-0',
          'bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800',
          isOpen ? 'w-[280px] translate-x-0' : 'w-[280px] -translate-x-full lg:w-20'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo Header */}
          <div
            className={cn(
              'h-[68px] flex items-center border-b border-slate-100/80 dark:border-slate-800',
              isOpen ? 'px-5' : 'px-2'
            )}
          >
            <img
              src={CENTER_LOGO_URL}
              alt="Thiên Uy English Center"
              className={cn('w-10 h-10 shrink-0 object-contain', !isOpen && 'lg:w-8 lg:h-8')}
            />
            <span
              className={cn(
                'ml-2.5 whitespace-nowrap font-extrabold text-[19px] text-slate-800 dark:text-slate-100 tracking-tight transition-all',
                !isOpen && 'lg:ml-0 lg:w-0 lg:overflow-hidden lg:opacity-0'
              )}
            >
              EduTrack
            </span>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setIsOpen(!isOpen)}
              aria-label={sidebarToggleLabel}
              title={sidebarToggleLabel}
              className={cn(
                'ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors',
                !isOpen && 'lg:ml-1 lg:h-8 lg:w-8'
              )}
            >
              <Menu className="w-5 h-5 text-slate-400" />
            </motion.button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-3 overflow-y-auto">
            {navSections.map((section, sectionIndex) => (
              <div key={section.label} className={cn(sectionIndex > 0 && 'mt-5')}>
                {/* Section header — hidden when collapsed, replaced by a hairline divider */}
                <p
                  className={cn(
                    'px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 select-none transition-all',
                    !isOpen && 'lg:hidden'
                  )}
                >
                  {section.label}
                </p>
                {!isOpen && sectionIndex > 0 && (
                  <div className="hidden lg:block mx-3 mb-2 border-t border-slate-100 dark:border-slate-800" />
                )}

                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const matchPaths =
                      'matchPaths' in item ? (item.matchPaths as string[] | undefined) : undefined;
                    const isActive = matchPaths
                      ? matchPaths.some(
                          (prefix) =>
                            location.pathname === prefix ||
                            location.pathname.startsWith(`${prefix}/`)
                        )
                      : item.path
                        ? location.pathname === item.path
                        : false;

                    return (
                      <Link
                        key={item.path}
                        to={item.path!}
                        onClick={closeSidebarOnMobile}
                        title={!isOpen ? item.name : undefined}
                        className={cn(
                          'flex items-center px-3 py-2.5 rounded-xl transition-colors duration-200 group relative',
                          !isOpen && 'lg:justify-center lg:px-0',
                          isActive
                            ? 'text-blue-600 dark:text-blue-400 font-semibold'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
                        )}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="sidebar-active-bg"
                            className="absolute inset-0 rounded-xl bg-blue-50/70 dark:bg-blue-500/10 shadow-[inset_0_0_12px_rgba(59,130,246,0.08)] dark:shadow-[inset_0_0_20px_rgba(59,130,246,0.15)] border border-blue-100/30 dark:border-blue-500/10"
                            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                          />
                        )}
                        {isActive && (
                          <motion.div
                            layoutId="sidebar-active-bar"
                            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-blue-600 dark:bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.4)]"
                            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                          />
                        )}
                        <Icon
                          className={cn(
                            'w-[20px] h-[20px] shrink-0 transition-colors relative z-10',
                            isActive
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                          )}
                        />
                        <span
                          className={cn(
                            'ml-3 text-[14px] transition-opacity relative z-10',
                            !isOpen && 'lg:ml-0 lg:w-0 lg:overflow-hidden lg:opacity-0'
                          )}
                        >
                          {item.name}
                        </span>
                        {'badge' in item && item.badge && (
                          <span
                            className={cn(
                              'ml-auto bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1 relative z-10',
                              !isOpen &&
                                'lg:absolute lg:right-1.5 lg:top-1.5 lg:ml-0 lg:h-4 lg:min-w-4 lg:px-1 lg:text-[9px]'
                            )}
                          >
                            {(item.badge as number) > 9 ? '9+' : String(item.badge)}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* User Profile Section */}
          <div className="border-t border-slate-100 dark:border-slate-800 p-3">
            <Link
              to="/profile"
              onClick={closeSidebarOnMobile}
              className={cn(
                'flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group',
                !isOpen && 'lg:justify-center lg:bg-transparent'
              )}
            >
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 overflow-hidden shadow-sm ring-2 ring-white dark:ring-slate-700',
                  !profileFaceUrl &&
                    (isAdmin
                      ? 'bg-slate-700'
                      : isTeacher
                        ? 'bg-blue-600'
                        : isParent
                          ? 'bg-amber-600'
                          : isAccounting
                            ? 'bg-rose-600'
                            : isOffice
                              ? 'bg-indigo-600'
                              : 'bg-emerald-600')
                )}
              >
                {profileFaceUrl ? (
                  <img src={profileFaceUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  (profile?.displayName || '?')[0].toUpperCase()
                )}
              </div>
              <div className={cn('flex-1 min-w-0 transition-opacity', !isOpen && 'lg:hidden')}>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {profile?.displayName || 'User'}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{roleLabel}</p>
              </div>
              <UserCircle
                className={cn(
                  'w-5 h-5 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 shrink-0 transition-colors',
                  !isOpen && 'lg:hidden'
                )}
              />
            </Link>

            {/* Sign out */}
            <motion.button
              data-testid="sign-out-button"
              whileTap={{ scale: 0.97 }}
              onClick={onSignOut}
              disabled={isSigningOut}
              className={cn(
                'flex items-center w-full px-3 py-2.5 mt-1.5 text-slate-400 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 rounded-xl transition-colors group text-sm disabled:cursor-not-allowed disabled:opacity-60',
                !isOpen && 'lg:justify-center lg:px-0'
              )}
            >
              {isSigningOut ? (
                <Loader2 className="w-4.5 h-4.5 shrink-0 animate-spin" />
              ) : (
                <LogOut className="w-4.5 h-4.5 shrink-0" />
              )}
              <span
                className={cn(
                  'ml-3 whitespace-nowrap font-medium transition-all',
                  !isOpen && 'lg:ml-0 lg:w-0 lg:overflow-hidden lg:opacity-0'
                )}
              >
                {isSigningOut ? t.signingOut : t.signOut}
              </span>
            </motion.button>
            <div
              className={cn(
                'mt-2 px-3 text-[10px] text-slate-300 dark:text-slate-700 font-medium transition-all whitespace-nowrap',
                !isOpen && 'lg:w-0 lg:overflow-hidden lg:px-0 lg:opacity-0'
              )}
            >
              CopyRight @tuantran_05
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
