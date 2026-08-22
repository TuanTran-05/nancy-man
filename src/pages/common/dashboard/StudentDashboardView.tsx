import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { format, formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  BookOpen,
  TrendingUp,
  ChevronRight,
  ClipboardList,
  Bell,
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  Trophy,
  Star,
  Megaphone,
  FileText,
  GraduationCap,
} from 'lucide-react';
import { cn, formatVN, toDate } from '../../../lib/core/utils';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { translations } from '../../../lib/i18n/translations';
import { UserProfile, Class, Student, Notification as AppNotification } from '../../../types';
import { getClassSessionForDate } from '../../../../shared/classSchedule';

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

interface StudentDashboardViewProps {
  profile: UserProfile | null;
  studentData: Student | null;
  studentClassData: Class | null;
  studentNotifications: AppNotification[];
  studentInsights: {
    pending: any[];
    completed: any[];
    urgent: any[];
    progress: number;
    total: number;
    displayRecent: any[];
    submittedAssignmentIds: Set<string>;
    averageScore: string | number;
    rank: string | number;
    totalStudentsForRank: string | number;
    classification: string;
  };
}

export function StudentDashboardView({
  profile,
  studentClassData,
  studentNotifications,
  studentInsights,
}: StudentDashboardViewProps) {
  const { language } = useLanguage();
  const t = translations[language].dashboardPage;

  const {
    pending,
    completed,
    progress,
    total,
    displayRecent,
    submittedAssignmentIds,
    averageScore,
    rank,
    totalStudentsForRank,
    classification,
  } = studentInsights;

  // Real class schedule calculation
  const todaySchedule = useMemo(() => {
    const scheduleList: {
      id: string;
      time: string;
      endTime: string;
      subject: string;
      room: string;
      status: string;
    }[] = [];

    if (studentClassData) {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const session = getClassSessionForDate(studentClassData, todayStr);
      if (!session) return scheduleList;

      const startTime = session.startTime;
      const endTime = session.endTime;

      const [hours, minutes] = startTime.split(':').map(Number);
      const [endHours, endMinutes] = endTime.split(':').map(Number);

      const nowTime = today.getHours() * 60 + today.getMinutes();
      const startMinutes = hours * 60 + minutes;
      const endMinutesTotal = endHours * 60 + endMinutes;

      let status = t.statusNotStarted;
      if (nowTime > endMinutesTotal) {
        status = t.statusCompleted;
      } else if (nowTime >= startMinutes && nowTime <= endMinutesTotal) {
        status = t.statusInProgress;
      } else if (startMinutes - nowTime <= 60 && startMinutes - nowTime > 0) {
        status = t.statusUpcoming;
      }

      scheduleList.push({
        id: studentClassData.id,
        time: startTime,
        endTime: endTime,
        subject: studentClassData.name,
        room: session.room || studentClassData.room || t.defaultRoom,
        status: status,
      });
    }
    return scheduleList;
  }, [studentClassData, t]);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Rich Greeting Banner */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative bg-gradient-to-r from-[#f0f4fd] via-[#f9faff] to-[#eef2fc] dark:from-slate-800 dark:via-slate-800/90 dark:to-slate-900 rounded-[2rem] p-8 sm:p-10 overflow-hidden border border-blue-50 dark:border-slate-700"
      >
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-100/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
        <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] bg-purple-100/30 rounded-full blur-3xl translate-y-1/2 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-8">
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 dark:text-slate-100 mb-3 tracking-tight flex items-center justify-center sm:justify-start gap-2">
              {t.studentWelcome}{' '}
              <span className="text-blue-600">{profile?.displayName || t.defaultUserName}!</span>{' '}
              <span className="text-4xl">👋</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-lg">{t.studentKeepItUp}</p>
          </div>

          <div className="hidden lg:flex items-center justify-center relative w-64 h-40">
            <div className="absolute inset-0 bg-blue-200/20 rounded-full blur-2xl"></div>
            <div className="relative z-10 w-full h-full flex items-center justify-center">
              <div className="absolute right-0 top-0 bg-emerald-400 p-2 rounded-xl text-white shadow-lg shadow-emerald-200 transform rotate-12 animate-bounce">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div className="absolute left-10 bottom-0 bg-amber-400 p-2 rounded-full text-white shadow-lg shadow-amber-200 transform -rotate-12">
                <Star className="w-5 h-5" />
              </div>
              <div className="absolute left-0 top-10 bg-white p-3 rounded-2xl shadow-xl shadow-blue-100/50 transform -rotate-6">
                <BookOpen className="w-8 h-8 text-blue-500" />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 4-Card Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Assignments Card */}
        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-black/20 flex flex-col relative overflow-hidden"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {t.studentAssignments}
              </p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-none mt-1">
                {total}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="text-rose-500">
              {t.studentPending.replace('{count}', String(pending.length))}
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-emerald-500">
              {t.studentCompleted.replace('{count}', String(completed.length))}
            </span>
          </div>
        </motion.div>

        {/* Progress Card */}
        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-black/20 flex flex-col justify-center"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {t.studentProgress}
              </p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-none mt-1">
                {progress}%
              </h3>
            </div>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 mb-2 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="bg-blue-600 h-2 rounded-full"
            ></motion.div>
          </div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t.studentCompletedOf
              .replace('{completed}', String(completed.length))
              .replace('{total}', String(total))}
          </p>
        </motion.div>

        {/* Average Score Card */}
        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-black/20 flex flex-col justify-center"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
              <Star className="w-6 h-6 fill-current" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {t.studentAvgScore}
              </p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-none mt-1">
                {averageScore}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 w-fit px-2 py-1 rounded-lg">
            <span>{t.studentBasedOn.replace('{total}', String(total))}</span>
          </div>
        </motion.div>

        {/* Class Rank Card */}
        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-black/20 flex flex-col justify-center"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {t.studentClassRank}
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-none">
                  {rank}
                </h3>
                <span className="text-sm font-bold text-slate-400">/ {totalStudentsForRank}</span>
              </div>
            </div>
          </div>
          {typeof rank === 'number' &&
            typeof totalStudentsForRank === 'number' &&
            totalStudentsForRank > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Top {((rank / totalStudentsForRank) * 100).toFixed(1)}%
                </p>
                {classification && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">•</span>
                    <span
                      className={cn(
                        'text-xs font-bold px-2 py-0.5 rounded-md',
                        classification === t.excellent
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
                          : classification === t.good
                            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600'
                            : classification === t.average
                              ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600'
                              : 'bg-red-50 dark:bg-red-500/10 text-red-600'
                      )}
                    >
                      {t.studentClassification.replace('{classification}', classification)}
                    </span>
                  </>
                )}
              </div>
            )}
        </motion.div>
      </div>

      {/* 3-Column Lower Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Today's Schedule */}
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
          <div className="p-6 border-b border-slate-50 dark:border-slate-700/50 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              {t.todaySchedule}
            </h2>
            <Link to="/classes" className="text-xs font-bold text-blue-600 hover:text-blue-700">
              {t.viewTimetable} →
            </Link>
          </div>
          <div className="p-6 flex-1 flex flex-col gap-4">
            {todaySchedule.length > 0 ? (
              todaySchedule.map((cls) => (
                <div
                  key={cls.id}
                  className="flex items-stretch gap-4 p-4 rounded-2xl border border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex flex-col justify-center items-end shrink-0 w-12 border-r border-slate-100 dark:border-slate-700 pr-4">
                    <span className="text-sm font-bold text-blue-600">{cls.time}</span>
                    <span className="text-[10px] font-semibold text-slate-400">{cls.endTime}</span>
                  </div>
                  <div className="flex-1 flex flex-col justify-center">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {cls.subject}
                    </h4>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">{cls.room}</p>
                  </div>
                  <div className="flex items-center shrink-0">
                    <span
                      className={cn(
                        'text-[10px] font-bold px-3 py-1.5 rounded-full',
                        cls.status === t.statusCompleted
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
                          : cls.status === t.statusUpcoming
                            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600'
                            : cls.status === t.statusInProgress
                              ? 'bg-amber-50 text-amber-600 animate-pulse'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                      )}
                    >
                      {cls.status}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-8">
                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
                  <Calendar className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-slate-400 font-medium text-sm">{t.noClassToday}</p>
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Recent Assignments */}
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
          <div className="p-6 border-b border-slate-50 dark:border-slate-700/50 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-600" />
              {t.recentAssignments}
            </h2>
            <Link to="/assignments" className="text-xs font-bold text-blue-600 hover:text-blue-700">
              {t.viewAll}
            </Link>
          </div>
          <div className="p-6 flex-1 flex flex-col justify-between">
            <div className="flex flex-col gap-4 mb-6">
              {displayRecent.slice(0, 3).map((assignment) => {
                const isSubmitted = submittedAssignmentIds.has(assignment.id);
                return (
                  <div
                    key={assignment.id}
                    className="flex items-start gap-4 p-4 rounded-2xl border border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <div
                      className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                        isSubmitted
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
                          : 'bg-blue-50 dark:bg-blue-500/10 text-blue-600'
                      )}
                    >
                      <ClipboardList className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {assignment.title}
                      </h4>
                      <p className="text-xs font-medium text-slate-500 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t.dueDate.replace('{date}', formatVN(assignment.dueDate, 'dd/MM/yyyy'))}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {isSubmitted ? (
                        <span className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 text-[10px] font-bold px-3 py-1.5 rounded-full flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> {t.submittedBadge}
                        </span>
                      ) : (
                        <span className="bg-amber-50 dark:bg-amber-500/10 text-amber-600 text-[10px] font-bold px-3 py-1.5 rounded-full">
                          {t.notSubmittedBadge}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {pending.length === 0 ? (
              <div className="bg-blue-50/50 dark:bg-blue-500/10 rounded-2xl p-4 flex items-center gap-4 border border-blue-100/50 dark:border-blue-500/20">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 shrink-0">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-blue-800 dark:text-blue-300">
                    {t.allCompleted}
                  </h4>
                  <p className="text-xs text-blue-600 mt-0.5">{t.keepItUp}</p>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50/50 dark:bg-amber-500/10 rounded-2xl p-4 flex items-center gap-4 border border-amber-100/50 dark:border-amber-500/20">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-800 dark:text-amber-300">
                    {t.pendingAssignments.replace('{count}', String(pending.length))}
                  </h4>
                  <p className="text-xs text-amber-600 mt-0.5">{t.completeSoon}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Notifications & Quick Access */}
        <div className="flex flex-col gap-6">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col flex-1">
            <div className="p-6 border-b border-slate-50 dark:border-slate-700/50 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-500" />
                {t.newNotifications}
              </h2>
              <Link to="#" className="text-xs font-bold text-blue-600 hover:text-blue-700">
                {t.viewAll}
              </Link>
            </div>
            <div className="p-6 flex flex-col gap-4">
              {studentNotifications.length > 0 ? (
                studentNotifications.slice(0, 3).map((notif) => {
                  const createdAtDate = toDate(notif.createdAt);

                  return (
                    <div key={notif.id} className="flex items-start gap-4">
                      <div
                        className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                          notif.type === 'absence'
                            ? 'bg-red-50 text-red-500 dark:bg-red-500/10'
                            : notif.type === 'missing_assignment'
                              ? 'bg-amber-50 text-amber-500 dark:bg-amber-500/10'
                              : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10'
                        )}
                      >
                        {notif.type === 'absence' ? (
                          <AlertCircle className="w-5 h-5" />
                        ) : notif.type === 'missing_assignment' ? (
                          <BookOpen className="w-5 h-5" />
                        ) : (
                          <Megaphone className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                          {notif.title}
                        </h4>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                          {notif.message}
                        </p>
                        {createdAtDate && (
                          <p className="text-[10px] text-slate-400 mt-1">
                            {formatDistanceToNow(createdAtDate, {
                              addSuffix: true,
                              locale: vi,
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-12 h-12 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mb-2">
                    <Bell className="w-5 h-5 text-slate-300 dark:text-slate-500" />
                  </div>
                  <p className="text-xs font-medium text-slate-400">{t.noNewNotifications}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm p-6">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-4">
              {t.quickAccess}
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <Link to="/knowledge" className="flex flex-col items-center gap-2 group">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center group-hover:-translate-y-1 transition-transform shadow-md shadow-blue-200">
                  <FileText className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 text-center leading-tight group-hover:text-blue-600 transition-colors">
                  {t.learningDocs.split('\n').map((line, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <br />}
                      {line}
                    </React.Fragment>
                  ))}
                </span>
              </Link>
              <Link to="/classes" className="flex flex-col items-center gap-2 group">
                <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center group-hover:-translate-y-1 transition-transform shadow-md shadow-amber-200">
                  <Calendar className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 text-center leading-tight group-hover:text-amber-500 transition-colors">
                  {t.schedule}
                  <br />
                  &nbsp;
                </span>
              </Link>
              <Link to="#" className="flex flex-col items-center gap-2 group">
                <div className="w-12 h-12 rounded-2xl bg-purple-500 text-white flex items-center justify-center group-hover:-translate-y-1 transition-transform shadow-md shadow-purple-200">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 text-center leading-tight group-hover:text-purple-500 transition-colors">
                  {t.scores}
                  <br />
                  &nbsp;
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
