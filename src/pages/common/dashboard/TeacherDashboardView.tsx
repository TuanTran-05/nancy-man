import React, { useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  ClipboardList,
  CheckCircle,
  Clock,
  ChevronRight,
  Users,
  TrendingUp,
  BookOpen,
  MessageSquare,
  Calendar,
  Bell,
  AlertCircle,
} from 'lucide-react';
import { cn, toDate } from '../../../lib/core/utils';
import { CENTER_LOGO_URL } from '../../../lib/brand';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { translations } from '../../../lib/i18n/translations';
import { TeacherPayroll } from '../../../components/finance/TeacherPayroll';
import { CreateNotificationModal } from '../../../components/notifications/CreateNotificationModal';
import { StatCard } from './StatCard';
import { UserProfile, Class, Student, Submission, Assignment } from '../../../types';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

interface TeacherDashboardViewProps {
  profile: UserProfile | null;
  stats: {
    classes: number;
    students: number;
    activeStudents: number;
    evaluations: number;
    assignments: number;
  };
  insights: {
    newStudentsThisWeek: number;
    evaluationsToday: number;
    ungradedSubmissions: number;
    newSubmissionsToday: number;
  };
  recentSubmissions: Submission[];
  studentsData: Record<string, Student>;
  studentNameLookup: Record<string, string>;
  assignmentsData: Record<string, Assignment>;
  classesData: Record<string, Class>;
  upcomingClasses: { class: Class; date: Date; dayOffset: number }[];
  teachers: Record<string, UserProfile>;
  isNotificationModalOpen: boolean;
  setIsNotificationModalOpen: (open: boolean) => void;
  notificationSuccess: string | null;
  handleSendNotification: (
    studentId: string,
    title: string,
    message: string,
    type: string
  ) => Promise<void>;
}

export function TeacherDashboardView({
  profile,
  stats,
  insights,
  recentSubmissions,
  studentsData,
  studentNameLookup,
  assignmentsData,
  classesData,
  upcomingClasses,
  teachers,
  isNotificationModalOpen,
  setIsNotificationModalOpen,
  notificationSuccess,
  handleSendNotification,
}: TeacherDashboardViewProps) {
  const { language } = useLanguage();
  const t = translations[language].dashboard;

  const [showBanner, setShowBanner] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'payroll'>('overview');

  return (
    <div className="space-y-8">
      {/* Actionable Banner */}
      <AnimatePresence>
        {showBanner && insights.ungradedSubmissions > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-blue-600 rounded-2xl p-4 sm:p-6 text-white shadow-lg shadow-blue-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
            <div className="flex items-center gap-4 relative z-10">
              <div className="p-3 bg-white/20 rounded-xl shrink-0">
                <Bell className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold">{t.teacher.banner.title}</h3>
                <p className="text-blue-100 text-sm mt-1">
                  {t.teacher.banner.desc1.replace(
                    '{count}',
                    insights.ungradedSubmissions.toString()
                  )}
                  {insights.newSubmissionsToday > 0 && (
                    <span>
                      {t.teacher.banner.desc2.replace(
                        '{count}',
                        insights.newSubmissionsToday.toString()
                      )}
                    </span>
                  )}
                  .
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto relative z-10">
              <Link
                to="/assignments"
                className="flex-1 sm:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-xl font-bold text-sm hover:bg-blue-50 dark:bg-blue-500/10 transition-colors text-center shadow-sm dark:shadow-black/20"
              >
                {t.teacher.banner.gradeNow}
              </Link>
              <button
                onClick={() => setShowBanner(false)}
                className="p-2.5 hover:bg-white/10 rounded-xl transition-colors"
                title={translations[language].common.skip}
              >
                <AlertCircle className="w-5 h-5 text-blue-200" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Personalized Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-slate-800 dark:text-slate-100 leading-tight">
            {translations[language].dashboardPage.hello}{' '}
            <span className="text-blue-600 dark:text-blue-400 italic">
              {profile?.displayName || t.teacher.title}!
            </span>{' '}
            👋
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-2 text-[15px]">
            {translations[language].dashboardPage.todayMotto}
          </p>
        </div>
        <img
          src={CENTER_LOGO_URL}
          alt="Thiên Uy English Center"
          className="w-24 h-24 object-contain hidden md:block drop-shadow-sm"
        />
      </div>

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-700/50 w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-bold transition-all',
            activeTab === 'overview'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'
          )}
        >
          {t.teacher.tabOverview}
        </button>
        <button
          onClick={() => setActiveTab('payroll')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-bold transition-all',
            activeTab === 'payroll'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'
          )}
        >
          {t.teacher.tabPayroll}
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-4 gap-6"
          >
            <StatCard
              title={t.teacher.stats.students}
              value={`${stats.activeStudents || 0} / ${stats.students || 0}`}
              subtitle={
                <span className="text-emerald-500">
                  {t.teacher.stats.studentsNew.replace(
                    '{count}',
                    insights.newStudentsThisWeek.toString()
                  )}
                </span>
              }
              icon={Users}
              color="text-blue-600"
              bgColor="bg-blue-50 dark:bg-blue-500/10"
            />
            <StatCard
              title={t.teacher.stats.assignments}
              value={stats.assignments}
              subtitle={
                insights.ungradedSubmissions > 0 ? (
                  <span className="text-amber-500">
                    {t.teacher.stats.assignmentsUngraded.replace(
                      '{count}',
                      insights.ungradedSubmissions.toString()
                    )}
                  </span>
                ) : (
                  <span className="text-slate-400">{t.teacher.stats.assignmentsAllGraded}</span>
                )
              }
              icon={ClipboardList}
              color="text-green-600"
              bgColor="bg-green-50 dark:bg-green-500/10"
            />
            <StatCard
              title={t.teacher.stats.evaluations}
              value={stats.evaluations}
              subtitle={
                <span className="text-emerald-500">
                  {t.teacher.stats.evaluationsToday.replace(
                    '{count}',
                    insights.evaluationsToday.toString()
                  )}
                </span>
              }
              icon={TrendingUp}
              color="text-amber-600"
              bgColor="bg-amber-50 dark:bg-amber-500/10"
            />
            <StatCard
              title={t.teacher.stats.classes}
              value={stats.classes}
              icon={BookOpen}
              color="text-purple-600"
              bgColor="bg-purple-50 dark:bg-purple-500/10"
            />
          </motion.div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Recent Submissions */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-blue-500" />
                  {t.teacher.recentSubmissions.title}
                </h2>
                <Link
                  to="/assignments"
                  className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {t.teacher.recentSubmissions.viewAll}
                </Link>
              </div>
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50 flex-1">
                {recentSubmissions.length > 0 ? (
                  recentSubmissions.map((sub) => {
                    const submissionStudentName = sub.studentName?.trim() || '';
                    const studentName =
                      studentNameLookup[sub.studentId] ||
                      studentsData[sub.studentId]?.name ||
                      submissionStudentName ||
                      t.teacher.recentSubmissions.studentName;
                    const studentInitial = studentName.trim().charAt(0).toUpperCase() || '?';
                    const assignmentTitle =
                      assignmentsData[sub.assignmentId]?.title ||
                      t.teacher.recentSubmissions.assignmentTitle;
                    const submittedAtDate = toDate(sub.submittedAt);

                    return (
                      <motion.div key={sub.id} variants={itemVariants}>
                        <Link
                          to="/assignments"
                          className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group block"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold shrink-0 border border-blue-100 dark:border-blue-500/20">
                              {studentInitial}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                {studentName}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-xs text-slate-400 truncate max-w-[150px] sm:max-w-[200px]">
                                  {assignmentTitle}
                                </p>
                                {submittedAtDate && (
                                  <span className="text-[10px] text-slate-300">
                                    •{' '}
                                    {formatDistanceToNow(submittedAtDate, {
                                      addSuffix: true,
                                      locale: vi,
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div
                              className={cn(
                                'flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider',
                                sub.status === 'graded'
                                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
                                  : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600'
                              )}
                            >
                              {sub.status === 'graded' ? (
                                <>
                                  <CheckCircle className="w-3 h-3" />
                                  <span>{sub.grade}/10</span>
                                </>
                              ) : (
                                <>
                                  <Clock className="w-3 h-3" />
                                  <span>{t.teacher.recentSubmissions.ungraded}</span>
                                </>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="p-12 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mb-3">
                      <ClipboardList className="w-8 h-8 text-slate-300 dark:text-slate-500" />
                    </div>
                    <p className="text-slate-400 font-medium">
                      {t.teacher.recentSubmissions.noSubmissions}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/80 dark:from-slate-800 dark:to-slate-800 rounded-2xl p-6 shadow-sm border border-blue-100/60 dark:border-slate-700/50 flex flex-col justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
                  {t.teacher.quickActions.title}
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
                  {t.teacher.quickActions.desc}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Link
                  to="/assignments"
                  className="group bg-white dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-slate-600 p-5 rounded-2xl border border-blue-100 dark:border-slate-600 transition-all text-center flex flex-col items-center justify-center gap-3 shadow-sm"
                >
                  <div className="p-3 bg-blue-100 dark:bg-blue-500/20 rounded-xl group-hover:scale-110 transition-transform">
                    <ClipboardList className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                    {t.teacher.quickActions.grade}
                  </span>
                </Link>
                <Link
                  to="/assignments"
                  className="group bg-white dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-slate-600 p-5 rounded-2xl border border-blue-100 dark:border-slate-600 transition-all text-center flex flex-col items-center justify-center gap-3 shadow-sm"
                >
                  <div className="p-3 bg-green-100 dark:bg-green-500/20 rounded-xl group-hover:scale-110 transition-transform">
                    <BookOpen className="w-6 h-6 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-green-700 dark:group-hover:text-green-300 transition-colors">
                    {t.teacher.quickActions.viewSubmissions}
                  </span>
                </Link>
                <button
                  onClick={() => setIsNotificationModalOpen(true)}
                  className="group bg-white dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-slate-600 p-5 rounded-2xl border border-blue-100 dark:border-slate-600 transition-all text-center flex flex-col items-center justify-center gap-3 shadow-sm"
                >
                  <div className="p-3 bg-amber-100 dark:bg-amber-500/20 rounded-xl group-hover:scale-110 transition-transform">
                    <MessageSquare className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-amber-700 dark:group-hover:text-amber-300 transition-colors">
                    {t.teacher.quickActions.createNotif}
                  </span>
                </button>
                <Link
                  to="/students"
                  className="group bg-white dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-slate-600 p-5 rounded-2xl border border-blue-100 dark:border-slate-600 transition-all text-center flex flex-col items-center justify-center gap-3 shadow-sm"
                >
                  <div className="p-3 bg-purple-100 dark:bg-purple-500/20 rounded-xl group-hover:scale-110 transition-transform">
                    <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-purple-700 dark:group-hover:text-purple-300 transition-colors">
                    {t.teacher.quickActions.manageClasses}
                  </span>
                </Link>
              </div>
            </div>

            {/* Upcoming Schedule */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  {translations[language].dashboardPage.upcomingSchedule}
                </h2>
                <Link
                  to="/classes"
                  className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {t.teacher.recentSubmissions.viewAll}
                </Link>
              </div>
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50 flex-1">
                {upcomingClasses.length > 0 ? (
                  upcomingClasses.map((session, idx) => (
                    <motion.div key={`${session.class.id}-${idx}`} variants={itemVariants}>
                      <Link
                        to={`/classes/${session.class.id}`}
                        className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group block"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex flex-col items-center justify-center shrink-0 border border-blue-100 dark:border-blue-500/20">
                            <span className="text-[10px] font-bold uppercase leading-none mb-0.5">
                              {session.date.toLocaleDateString(
                                language === 'vi' ? 'vi-VN' : 'en-GB',
                                { weekday: 'short' }
                              )}
                            </span>
                            <span className="text-sm font-black leading-none">
                              {session.date.getDate()}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                              {session.class.name}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {session.class.startTime || '--:--'}
                              </span>
                              {session.class.room && (
                                <>
                                  <span className="text-slate-300">•</span>
                                  <span>{session.class.room}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center shrink-0">
                          <div className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                            {session.dayOffset === 0
                              ? translations[language].dashboardPage.today
                              : session.dayOffset === 1
                                ? translations[language].dashboardPage.tomorrow
                                : session.date.toLocaleDateString(
                                    language === 'vi' ? 'vi-VN' : 'en-GB',
                                    { day: '2-digit', month: '2-digit', year: 'numeric' }
                                  )}
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  ))
                ) : (
                  <div className="p-12 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mb-3">
                      <Calendar className="w-8 h-8 text-slate-300 dark:text-slate-500" />
                    </div>
                    <p className="text-slate-400 font-medium">
                      {translations[language].dashboardPage.noUpcomingClasses}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      ) : (
        <TeacherPayroll teacherId={profile?.uid} />
      )}

      <CreateNotificationModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        students={Object.values(studentsData)}
        classes={Object.values(classesData)}
        teachers={Object.entries(teachers).map(([uid, tItem]) => ({
          uid,
          displayName: tItem.displayName || 'GV',
        }))}
        onSend={handleSendNotification}
      />

      {/* Success Toast */}
      <AnimatePresence>
        {notificationSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 24 }}
            className="fixed bottom-4 right-4 bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50"
          >
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">{notificationSuccess}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
