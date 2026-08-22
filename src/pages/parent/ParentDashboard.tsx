import React from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  Calendar,
  Loader2,
  Star,
  TrendingUp,
  X,
  Banknote,
  Clock,
} from 'lucide-react';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { cn } from '../../lib/core/utils';
import { UserProfile } from '../../types';
import {
  ActionPlan,
  AttendanceHeatmap,
  ComparisonSection,
  MobileBottomNav,
  OverviewCard,
  PillInfo,
  RecentHomeworkList,
  SemesterTimeline,
  TeacherComments,
  WarningAlerts,
} from './components/DashboardWidgets';
import { formatAverageScore, getInitials } from './utils';
import { useParentDashboardState } from './hooks/useParentDashboardState';
import { NotificationDetailModal } from './components/NotificationDetailModal';

const LearningProgressCharts = React.lazy(() =>
  import('./components/LearningProgressCharts').then((module) => ({
    default: module.LearningProgressCharts,
  }))
);

interface ParentDashboardProps {
  profile: UserProfile | null;
}

export default function ParentDashboard({ profile }: ParentDashboardProps) {
  const { language, t } = useLanguage();
  const state = useParentDashboardState(profile, language);

  useBodyScrollLock(state.notif.isNotificationOpen || !!state.notif.selectedNotification);

  if (state.loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      </div>
    );
  }

  const evaluationLabel = (() => {
    if (state.averageScore100 === null) return t.parent.awaitingEvaluation;
    if (state.averageScore100 >= 90) return t.parent.excellent;
    if (state.averageScore100 >= 80) return t.parent.veryGood;
    if (state.averageScore100 >= 70) return t.parent.good;
    return t.parent.needsSupport;
  })();

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return t.parent.goodMorning;
    if (hour < 18) return t.parent.goodAfternoon;
    return t.parent.goodEvening;
  })();

  const overviewCards = [
    {
      icon: TrendingUp,
      label: t.parent.averageScore,
      value: formatAverageScore(state.averageScore100),
      sub: state.averageScore100 === null ? t.parent.noDataYet : t.parent.tenPointScale,
      trend: state.scoreTrend,
      color: 'blue' as const,
    },
    {
      icon: Calendar,
      label: t.parent.attendance,
      value: `${state.attendanceRate}%`,
      sub: t.parent.absentCountSub.replace('{count}', String(state.absentCount)),
      color: 'emerald' as const,
    },
    {
      icon: BookOpen,
      label: t.parent.homeworkDone,
      value: `${state.homeworkSubmittedCount}/${state.filteredAssignments.length}`,
      sub: t.parent.submittedTotal,
      color: 'orange' as const,
    },
    {
      icon: Star,
      label: t.parent.teacherRating,
      value: evaluationLabel,
      sub: t.parent.latestEvaluation,
      color: 'violet' as const,
    },
  ];

  const unreadBellCount = state.notif.unreadNotifications.length;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(191,219,254,0.55),_transparent_38%),linear-gradient(180deg,_#f5fbff_0%,_#eef6ff_40%,_#f8fbff_100%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(30,58,138,0.15),_transparent_38%),linear-gradient(180deg,_#0f172a_0%,_#1e293b_40%,_#0f172a_100%)] pb-28 lg:pb-10">
      <div className="mx-auto max-w-7xl px-4 lg:px-8 py-5 lg:py-8 space-y-6 lg:space-y-8">
        {state.studentData?.enrollmentStatus === 'dropped' &&
          state.daysRemainingAfterDrop !== null && (
            <motion.div
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[28px] border border-red-200 dark:border-red-900/50 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl p-4 lg:p-5 shadow-[0_18px_55px_rgba(239,68,68,0.12)] dark:shadow-[0_18px_55px_rgba(220,38,38,0.1)]"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-red-50 dark:bg-red-500/10 p-2.5 text-red-500 dark:text-red-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    {t.parent.droppedNotice}
                  </p>
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400/80">
                    {t.parent.parentLockCountdown.replace(
                      '{days}',
                      String(state.daysRemainingAfterDrop)
                    )}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_rgba(37,99,235,0.96),_rgba(59,130,246,0.88)_50%,_rgba(249,115,22,0.72))] px-5 py-6 lg:px-8 lg:py-8 shadow-[0_24px_80px_rgba(37,99,235,0.28)]"
        >
          <div className="absolute inset-0 rounded-[32px] bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.26),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(191,219,254,0.24),_transparent_36%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-1 items-start gap-4">
              <div className="h-20 w-20 lg:h-24 lg:w-24 shrink-0 rounded-[26px] border border-white/35 bg-white/15 p-1.5 backdrop-blur-xl shadow-[0_18px_48px_rgba(15,23,42,0.18)]">
                {state.studentFaceUrl ? (
                  <img
                    src={state.studentFaceUrl}
                    alt={state.studentName}
                    className="h-full w-full rounded-[22px] object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,_rgba(255,255,255,0.24),_rgba(255,255,255,0.1))] text-2xl font-bold text-white">
                    {getInitials(state.studentName)}
                  </div>
                )}
              </div>

              <div className="pt-1 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center rounded-full bg-white/14 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-50 backdrop-blur-md">
                    {t.parent.parentProgressDashboard}
                  </div>

                  <div className="relative z-50">
                    <button
                      type="button"
                      onClick={() => state.notif.setIsNotificationOpen((value) => !value)}
                      className="relative inline-flex h-10 w-10 lg:h-12 lg:w-12 items-center justify-center rounded-xl lg:rounded-2xl border border-white/30 bg-white/16 text-white backdrop-blur-xl transition hover:bg-white/22 shadow-[0_4px_24px_rgba(37,99,235,0.2)]"
                    >
                      <Bell className="w-5 h-5" />
                      {unreadBellCount > 0 && (
                        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-lg shadow-orange-500/40">
                          {unreadBellCount > 9 ? '9+' : unreadBellCount}
                        </span>
                      )}
                    </button>

                    <AnimatePresence>
                      {state.notif.isNotificationOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.98 }}
                          className="absolute left-0 lg:left-0 top-12 lg:top-14 w-[320px] max-w-[calc(100vw-4rem)] overflow-hidden rounded-[24px] border border-blue-100 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-[0_22px_55px_rgba(15,23,42,0.18)]"
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 px-4 py-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {t.parent.notifications}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {language === 'vi'
                                  ? `${state.notif.unreadNotifications.length} thông báo chưa đọc`
                                  : `${state.notif.unreadNotifications.length} unread`}
                              </p>
                            </div>
                            {state.notif.unreadNotifications.length > 0 && (
                              <button
                                type="button"
                                onClick={state.notif.markAllNotificationsAsRead}
                                disabled={state.notif.isMarkingNotifications}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 transition hover:text-blue-700 dark:hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {state.notif.isMarkingNotifications && (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                )}
                                {state.notif.isMarkingNotifications
                                  ? t.parent.saving
                                  : t.parent.markAll}
                              </button>
                            )}
                          </div>

                          <div className="max-h-80 overflow-y-auto">
                            {state.notif.unreadNotifications.slice(0, 5).length ? (
                              state.notif.unreadNotifications.slice(0, 5).map((notification) => (
                                <button
                                  key={notification.id}
                                  type="button"
                                  onClick={() => {
                                    state.notif.setSelectedNotification(notification);
                                    state.notif.setIsNotificationOpen(false);
                                    if (!notification.isRead) {
                                      void state.notif.markNotificationAsRead(notification.id);
                                    }
                                  }}
                                  className={cn(
                                    'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/50',
                                    !notification.isRead && 'bg-orange-50/50 dark:bg-orange-500/10'
                                  )}
                                >
                                  <div className="rounded-2xl bg-orange-100 dark:bg-orange-900/40 p-2 text-orange-600 dark:text-orange-400">
                                    <Bell className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      {notification.title}
                                    </p>
                                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-2">
                                      {notification.message}
                                    </p>
                                    <p className="mt-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                      {state.formatDateLabel(
                                        notification.createdAt,
                                        'HH:mm - dd/MM'
                                      )}
                                    </p>
                                  </div>
                                </button>
                              ))
                            ) : (
                              <div className="px-4 py-8 text-center">
                                <Bell className="mx-auto h-10 w-10 text-slate-200 dark:text-slate-600" />
                                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                  {t.parent.noNewNotifications}
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                <h1 className="mt-3 text-2xl lg:text-[2rem] font-bold text-white">
                  {greeting},{' '}
                  <span className="text-orange-100">
                    {t.parent.parentOf.replace('{name}', state.studentShortName)}
                  </span>
                </h1>
                <p className="mt-2 text-sm lg:text-base text-blue-50/90 max-w-2xl">
                  {t.parent.parentProgressDesc}
                </p>

                <div className="mt-4 flex flex-wrap gap-2.5">
                  <PillInfo label={t.parent.classLabel} value={state.className} />
                  <PillInfo label={t.parent.level} value={state.levelLabel} />
                  <PillInfo
                    label={t.parent.course}
                    value={
                      state.selectedTermMeta ? `${state.selectedTermMeta.name}` : t.parent.current
                    }
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-3 lg:min-w-[290px]">
              <div className="flex items-center justify-end gap-3">
                <div className="rounded-[22px] border border-white/26 bg-white/14 px-4 py-2.5 backdrop-blur-xl flex-1 text-right lg:text-left shadow-[0_8px_32px_rgba(37,99,235,0.12)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100/90">
                    {t.parent.currentReport}
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {state.selectedTermMeta?.startDate && state.selectedTermMeta?.endDate
                      ? `${state.formatDateLabel(state.selectedTermMeta.startDate)} - ${state.formatDateLabel(state.selectedTermMeta.endDate)}`
                      : t.parent.updating}
                  </p>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/22 bg-white/14 p-4 backdrop-blur-xl">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100/90">
                  {t.parent.courseSelector}
                </label>
                <select
                  value={state.selectedTerm}
                  onChange={(event) => state.setSelectedTerm(event.target.value)}
                  className="w-full rounded-2xl border border-white/18 dark:border-slate-700/60 bg-white/92 dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 outline-none ring-0 transition focus:border-blue-300 dark:focus:border-blue-500"
                >
                  <option value="current">
                    {t.parent.currentCourse}
                    {state.selectedTermMeta?.startDate && state.selectedTermMeta?.endDate
                      ? ` (${state.formatDateLabel(state.selectedTermMeta.startDate)} - ${state.formatDateLabel(state.selectedTermMeta.endDate)})`
                      : ''}
                  </option>
                  {state.classData?.terms?.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name} ({state.formatDateLabel(term.startDate)} -{' '}
                      {state.formatDateLabel(term.endDate)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </motion.section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {overviewCards.map((card, index) => (
            <OverviewCard key={card.label} {...card} delay={index * 0.05} language={language} />
          ))}
        </section>

        <div className="hidden lg:grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-6">
            <React.Suspense
              fallback={
                <div className="min-h-[360px] rounded-[28px] border border-slate-100/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/60 animate-pulse" />
              }
            >
              <LearningProgressCharts
                language={language}
                radarData={state.radarData}
                termTrendData={state.termTrendData}
                homeworkBarData={state.homeworkBarData}
                donutData={state.donutData}
                totalAssignments={state.filteredAssignments.length}
              />
            </React.Suspense>

            <AttendanceHeatmap
              language={language}
              data={state.attendanceHeatmap}
              months={state.heatmapMonths}
            />

            <TeacherComments
              language={language}
              comments={state.teacherComments}
              expandedComments={state.expandedComments}
              onToggleExpand={(commentId) =>
                state.setExpandedComments((current) =>
                  current.includes(commentId)
                    ? current.filter((id) => id !== commentId)
                    : [...current, commentId]
                )
              }
              formatDateLabel={state.formatDateLabel}
            />

            <SemesterTimeline language={language} timelineItems={state.timelineItems} />
          </div>

          <div className="col-span-4 space-y-6">
            <ComparisonSection
              language={language}
              scoreStudent={state.comparisonData.scoreStudent}
              scoreClassAverage={state.comparisonData.scoreClassAverage}
              attendanceStudent={state.comparisonData.attendanceStudent}
              attendanceClassAverage={state.comparisonData.attendanceClassAverage}
              rankLabel={state.comparisonData.rankLabel}
            />

            <Link
              to="/parent/tuition"
              className="group rounded-[28px] border border-slate-100/70 dark:border-slate-700/60 bg-white/90 dark:bg-slate-800/90 p-5 lg:p-6 shadow-[0_14px_45px_rgba(15,23,42,0.07)] dark:shadow-none backdrop-blur-xl flex items-center gap-4 hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors"
            >
              <div className="rounded-2xl bg-blue-50 dark:bg-blue-500/10 p-2.5 text-blue-600 dark:text-blue-400">
                <Banknote className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base lg:text-lg font-bold text-slate-900 dark:text-slate-100">
                  {t.parent.tuition}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {t.parent.viewTuitionHint}
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
            </Link>

            <WarningAlerts
              language={language}
              alerts={state.warningAlerts}
              onDismiss={(id) => state.setDismissedAlertIds((current) => [...current, id])}
            />

            <ActionPlan
              language={language}
              plans={state.actionPlans}
              checkedPlanIds={state.checkedPlanIds}
              onTogglePlan={(planId) =>
                state.setCheckedPlanIds((current) =>
                  current.includes(planId)
                    ? current.filter((id) => id !== planId)
                    : [...current, planId]
                )
              }
            />

            <RecentHomeworkList
              language={language}
              items={state.recentAssignmentItems}
              formatDateLabel={state.formatDateLabel}
            />
          </div>
        </div>

        <div className="lg:hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={state.currentTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {state.currentTab === 'home' && (
                <>
                  <ComparisonSection
                    language={language}
                    scoreStudent={state.comparisonData.scoreStudent}
                    scoreClassAverage={state.comparisonData.scoreClassAverage}
                    attendanceStudent={state.comparisonData.attendanceStudent}
                    attendanceClassAverage={state.comparisonData.attendanceClassAverage}
                    rankLabel={state.comparisonData.rankLabel}
                  />

                  <WarningAlerts
                    language={language}
                    alerts={state.warningAlerts}
                    onDismiss={(id) => state.setDismissedAlertIds((current) => [...current, id])}
                  />

                  <ActionPlan
                    language={language}
                    plans={state.actionPlans}
                    checkedPlanIds={state.checkedPlanIds}
                    onTogglePlan={(planId) =>
                      state.setCheckedPlanIds((current) =>
                        current.includes(planId)
                          ? current.filter((id) => id !== planId)
                          : [...current, planId]
                      )
                    }
                  />
                </>
              )}

              {state.currentTab === 'progress' && (
                <>
                  <React.Suspense
                    fallback={
                      <div className="min-h-[320px] rounded-[28px] border border-slate-100/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/60 animate-pulse" />
                    }
                  >
                    <LearningProgressCharts
                      language={language}
                      radarData={state.radarData}
                      termTrendData={state.termTrendData}
                      homeworkBarData={[]}
                      donutData={[]}
                      totalAssignments={state.filteredAssignments.length}
                      mode="progress"
                    />
                  </React.Suspense>

                  <AttendanceHeatmap
                    language={language}
                    data={state.attendanceHeatmap}
                    months={state.heatmapMonths}
                  />

                  <TeacherComments
                    language={language}
                    comments={state.teacherComments}
                    expandedComments={state.expandedComments}
                    onToggleExpand={(commentId) =>
                      state.setExpandedComments((current) =>
                        current.includes(commentId)
                          ? current.filter((id) => id !== commentId)
                          : [...current, commentId]
                      )
                    }
                    formatDateLabel={state.formatDateLabel}
                  />

                  <SemesterTimeline language={language} timelineItems={state.timelineItems} />
                </>
              )}

              {state.currentTab === 'homework' && (
                <>
                  <React.Suspense
                    fallback={
                      <div className="min-h-[320px] rounded-[28px] border border-slate-100/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/60 animate-pulse" />
                    }
                  >
                    <LearningProgressCharts
                      language={language}
                      radarData={[]}
                      termTrendData={[]}
                      homeworkBarData={state.homeworkBarData}
                      donutData={state.donutData}
                      totalAssignments={state.filteredAssignments.length}
                      mode="homework"
                    />
                  </React.Suspense>

                  <RecentHomeworkList
                    language={language}
                    items={state.recentAssignmentItems}
                    formatDateLabel={state.formatDateLabel}
                  />
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {state.notif.selectedNotification && (
          <NotificationDetailModal
            notification={state.notif.selectedNotification}
            onClose={() => state.notif.setSelectedNotification(null)}
            formatDateLabel={state.formatDateLabel}
            closeLabel={t.parent.close}
            detailsLabel={t.parent.notificationDetails}
          />
        )}
      </AnimatePresence>

      <MobileBottomNav
        currentTab={state.currentTab}
        language={language}
        onSelectTab={state.handleTabChange}
      />
    </div>
  );
}
