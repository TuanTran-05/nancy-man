import type React from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  Activity,
  BookOpen,
  DollarSign,
  KeyRound,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import type { FinanceReport } from '../../lib/api/financeApi';
import { sortClassesByStatusGradeName } from '../../lib/classes/sortClasses';
import { ApiDateTextInput } from '../../components/forms/ApiDateTimeInputs';

const formatCompactNumber = (value: number) => {
  const absValue = Math.abs(value);
  if (absValue >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (absValue >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
};

const AdminSparkline = ({ values, color }: { values: number[]; color: string }) => {
  const safeValues = values.length > 1 ? values : [0, values[0] || 0, values[0] || 0, 0];
  const max = Math.max(...safeValues, 1);
  const min = Math.min(...safeValues);
  const range = Math.max(max - min, 1);
  const points = safeValues
    .map((value, index) => {
      const x = (index / (safeValues.length - 1)) * 120;
      const y = 42 - ((value - min) / range) * 32;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox="0 0 120 48"
      className="h-10 w-24 shrink-0 overflow-visible sm:h-12 sm:w-28"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline points={`0,48 ${points} 120,48`} fill={color} opacity="0.08" stroke="none" />
    </svg>
  );
};

const AdminMetricCard = ({
  label,
  subtitle,
  value,
  note,
  icon: Icon,
  color,
  bg,
  sparkline,
  to,
}: {
  label: string;
  subtitle: string;
  value: React.ReactNode;
  note: React.ReactNode;
  icon: React.ElementType;
  color: string;
  bg: string;
  sparkline: number[];
  to?: string;
}) => {
  const { t } = useLanguage();
  const cardClassName =
    'relative min-h-[140px] overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_16px_44px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_56px_rgba(15,23,42,0.11)] sm:min-h-[150px] sm:rounded-2xl sm:p-5';
  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl sm:h-14 sm:w-14 sm:rounded-2xl',
              bg
            )}
          >
            <Icon className="h-6 w-6 sm:h-7 sm:w-7" style={{ color }} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase leading-tight text-slate-500">{label}</p>
            <p className="mt-1 text-xs font-medium leading-snug text-slate-400">{subtitle}</p>
            <div className="mt-2 break-words text-2xl font-bold leading-tight text-slate-950 sm:text-3xl">
              {value}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label={t.adminDashboard.moreLabel}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 text-xs font-semibold text-slate-500">{note}</div>
        <AdminSparkline values={sparkline} color={color} />
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={cardClassName}>
        {cardContent}
      </Link>
    );
  }

  return <div className={cardClassName}>{cardContent}</div>;
};

const AdminDonut = ({
  data,
  center,
  caption,
}: {
  data: { label: string; value: number; color: string }[];
  center?: string;
  caption?: string;
}) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  const circumference = 2 * Math.PI * 38;

  return (
    <div className="relative mx-auto h-44 w-44 sm:h-52 sm:w-52">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="38" fill="transparent" stroke="#eef2f7" strokeWidth="12" />
        {data
          .filter((item) => item.value > 0)
          .map((item) => {
            const length = total > 0 ? (item.value / total) * circumference : 0;
            const dashOffset = -offset;
            offset += length;
            return (
              <circle
                key={item.label}
                cx="50"
                cy="50"
                r="38"
                fill="transparent"
                stroke={item.color}
                strokeWidth="12"
                strokeDasharray={`${length} ${circumference}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
              />
            );
          })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-slate-950">{center}</span>
          {caption && <span className="text-xs font-medium text-slate-500">{caption}</span>}
        </div>
      )}
    </div>
  );
};

const OverviewPanel = ({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  iconColor: string;
  children: React.ReactNode;
}) => {
  const { t } = useLanguage();
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_16px_44px_rgba(15,23,42,0.07)] sm:rounded-2xl sm:p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold leading-tight text-slate-950">
            <Icon className="h-5 w-5 shrink-0" style={{ color: iconColor }} />
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm leading-snug text-slate-500">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label={t.adminDashboard.moreLabel}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      {children}
    </section>
  );
};

type ClassStudentCounts = Record<
  string,
  { total: number; active: number; onLeave: number; dropped: number; promoted?: number }
>;

type AdminOverviewTabProps = {
  language: string;
  t: any;
  activeStudentsCount: number;
  studentsCount: number;
  activeRate: number;
  classSparkline: number[];
  registeredTeachers: Array<{ uid: string; displayName?: string }>;
  classes: Array<{
    id: string;
    name: string;
    teacherId?: string;
    status?: string;
    grade?: number | string | null;
  }>;
  fundReport: FinanceReport | null;
  reportLoading: boolean;
  financeBalance: number;
  reportFrom: string;
  setReportFrom: React.Dispatch<React.SetStateAction<string>>;
  reportTo: string;
  setReportTo: React.Dispatch<React.SetStateAction<string>>;
  handleLoadFundReport: () => void;
  genderData: Array<{ label: string; value: number; color: string }>;
  performanceRows: Array<{ label: string; value: number; color: string }>;
  performanceTotal: number;
  passCount: number;
  passRate: number;
  systemActivity: Array<{
    label: string;
    value: number;
    icon: React.ElementType;
    color: string;
    bg: string;
  }>;
  classStudentCounts: ClassStudentCounts;
};

export function AdminOverviewTab({
  language,
  t,
  activeStudentsCount,
  studentsCount,
  activeRate,
  classSparkline,
  registeredTeachers,
  classes,
  fundReport,
  reportLoading,
  financeBalance,
  reportFrom,
  setReportFrom,
  reportTo,
  setReportTo,
  handleLoadFundReport,
  genderData,
  performanceRows,
  performanceTotal,
  passCount,
  passRate,
  systemActivity,
  classStudentCounts,
}: AdminOverviewTabProps) {
  const sortedClasses = sortClassesByStatusGradeName(classes);
  // Percentages must divide by the roster the buckets were built from, not by a
  // separately-sourced total, otherwise the slices never add up to 100%.
  const genderTotal = genderData.reduce((sum, item) => sum + item.value, 0);

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-5 sm:space-y-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label={t.studentsLabel}
          subtitle={t.studentsSubtitle}
          value={
            <>
              {activeStudentsCount} <span className="text-slate-400">/ {studentsCount}</span>
            </>
          }
          note={
            <span>
              <span className="font-bold text-blue-600">{activeRate}%</span> {t.studentsActive}
            </span>
          }
          icon={Users}
          color="#2563eb"
          bg="bg-blue-50"
          sparkline={classSparkline}
          to="/students"
        />
        <AdminMetricCard
          label={t.teachersLabel}
          subtitle={t.teachersSubtitle}
          value={registeredTeachers.length}
          note={
            <span>
              <span className="font-bold text-emerald-600">100%</span> {t.teachersActive}
            </span>
          }
          icon={ShieldCheck}
          color="#10b981"
          bg="bg-emerald-50"
          sparkline={registeredTeachers.map((_, index) => index + 1)}
          to="/teachers"
        />
        <AdminMetricCard
          label={t.classesLabel}
          subtitle={t.classesSubtitle}
          value={classes.length}
          note={
            <span>
              <span className="font-bold text-orange-500">
                +{classes.filter((cls) => cls.status === 'active').length}
              </span>{' '}
              {t.classesActive}
            </span>
          }
          icon={BookOpen}
          color="#fb923c"
          bg="bg-orange-50"
          to="/classes"
          sparkline={classSparkline.map((value) => value + 1)}
        />
        <AdminMetricCard
          label={t.fundReportLabel}
          subtitle={t.fundReportSubtitle}
          to="/admin/finance-report"
          value={
            <>
              {formatCompactNumber(financeBalance)}{' '}
              <span className="text-base font-semibold text-slate-500">đ</span>
            </>
          }
          note={
            fundReport ? (
              <span>
                <span className="font-bold text-emerald-600">
                  +{formatCompactNumber(fundReport.totalIncome)}
                </span>{' '}
                /{' '}
                <span className="font-bold text-rose-500">
                  -{formatCompactNumber(fundReport.totalExpenses)}
                </span>
              </span>
            ) : (
              <span>{reportLoading ? t.loading : t.noData}</span>
            )
          }
          icon={DollarSign}
          color="#9333ea"
          bg="bg-purple-50"
          sparkline={[
            fundReport?.totalIncome || 0,
            Math.max(fundReport?.totalIncome || 0, fundReport?.totalExpenses || 0),
            Math.abs(financeBalance),
            fundReport?.totalExpenses || 0,
          ]}
        />
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <div className="min-w-0">
            <label className="block text-xs font-semibold text-slate-500 mb-1">{t.fromDate}</label>
            <ApiDateTextInput
              label={t.fromDate}
              hideLabel
              value={reportFrom}
              onChange={setReportFrom}
              inputClassName="h-11 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 focus:border-blue-300 focus:ring-blue-100 sm:w-auto"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-semibold text-slate-500 mb-1">{t.toDate}</label>
            <ApiDateTextInput
              label={t.toDate}
              hideLabel
              value={reportTo}
              onChange={setReportTo}
              inputClassName="h-11 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 focus:border-blue-300 focus:ring-blue-100 sm:w-auto"
            />
          </div>
          <button
            onClick={() => handleLoadFundReport()}
            disabled={reportLoading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-60 sm:w-auto"
          >
            {reportLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {t.loadReport}
          </button>
        </div>
        <Link
          to="/admin/staff-password-resets"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-5 py-3 text-center text-sm font-bold leading-tight text-purple-700 transition hover:bg-purple-100 sm:w-auto"
        >
          <KeyRound className="h-4 w-4 shrink-0" />
          {t.staffResetRequests}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-[0.95fr_1.05fr_0.92fr]">
        <OverviewPanel
          title={t.studentStatus}
          subtitle={t.genderDistribution}
          icon={Users}
          iconColor="#2563eb"
        >
          <div className="grid gap-5 md:grid-cols-[210px_1fr] md:items-center xl:grid-cols-1 2xl:grid-cols-[210px_1fr]">
            <AdminDonut data={genderData} />
            <div className="space-y-4">
              {genderData.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
                    <span className="h-3 w-3 rounded" style={{ backgroundColor: item.color }} />
                    {item.label}
                  </div>
                  <div className="text-sm font-bold text-slate-950">
                    {item.value}{' '}
                    <span className="font-medium text-slate-400">
                      ({genderTotal > 0 ? ((item.value / genderTotal) * 100).toFixed(1) : 0}
                      %)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </OverviewPanel>

        <OverviewPanel
          title={t.learningResults}
          subtitle={t.academicQualityOverview}
          icon={BookOpen}
          iconColor="#fb923c"
        >
          <div className="grid gap-6 md:grid-cols-[210px_1fr] md:items-center">
            <AdminDonut
              data={[
                { label: t.donutPass, value: passCount, color: '#5b8cff' },
                {
                  label: t.donutSupport,
                  value: Math.max(performanceTotal - passCount, 0),
                  color: '#e5e7eb',
                },
              ]}
              center={`${passRate}%`}
              caption={t.passing}
            />
            <div className="space-y-4">
              {performanceRows.map((row) => {
                const percent =
                  performanceTotal > 0 ? Math.round((row.value / performanceTotal) * 100) : 0;
                return (
                  <div key={row.label}>
                    <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-600">
                      <span>{row.label}</span>
                      <span className="text-slate-950">
                        {row.value} <span className="font-medium text-slate-400">({percent}%)</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${percent}%`, backgroundColor: row.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </OverviewPanel>

        <OverviewPanel
          title={t.systemActivity}
          subtitle={t.last7Days}
          icon={Activity}
          iconColor="#2563eb"
        >
          <div className="divide-y divide-slate-100">
            {systemActivity.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn('flex h-9 w-9 items-center justify-center rounded-xl', item.bg)}
                      style={{ color: item.color }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-semibold text-slate-600">{item.label}</span>
                  </div>
                  <span className="text-sm font-bold text-slate-950">+{item.value}</span>
                </div>
              );
            })}
          </div>
        </OverviewPanel>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_16px_44px_rgba(15,23,42,0.07)] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-500" />
            {t.classesOverview.title}
          </h2>
          <Link
            to="/classes"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-bold text-blue-600 transition hover:bg-blue-50"
          >
            {t.classesOverview.manage}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100">
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase">
                  {t.classesOverview.table.class}
                </th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase">
                  {t.classesOverview.table.teacher}
                </th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase">
                  {t.classesOverview.table.status}
                </th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-center">
                  {t.classesOverview.table.totalStudents}
                </th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-center">
                  {t.classesOverview.table.learning}
                </th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-center">
                  {t.classesOverview.table.onLeave}
                </th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-center">
                  {t.classesOverview.table.dropped}
                </th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-center">
                  {t.action}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedClasses.map((cls) => {
                const teacher = registeredTeachers.find((t) => t.uid === cls.teacherId);
                return (
                  <tr key={cls.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <Link
                        to={`/classes/${cls.id}`}
                        className="text-sm font-bold text-slate-950 hover:text-blue-600 transition-colors"
                      >
                        {cls.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">
                          {teacher?.displayName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="text-xs text-slate-600">
                          {teacher?.displayName || t.classesOverview.unassigned}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase',
                          cls.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : cls.status === 'paused'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-700'
                        )}
                      >
                        {cls.status === 'active'
                          ? t.classesOverview.statusOptions.active
                          : cls.status === 'paused'
                            ? t.classesOverview.statusOptions.paused
                            : t.classesOverview.statusOptions.archived}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-bold text-slate-950">
                      {classStudentCounts[cls.id]?.total || 0}
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-bold text-emerald-600">
                      {classStudentCounts[cls.id]?.active || 0}
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-bold text-amber-600">
                      {classStudentCounts[cls.id]?.onLeave || 0}
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-bold text-red-600">
                      {classStudentCounts[cls.id]?.dropped || 0}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Link
                        to={`/classes/${cls.id}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600"
                        title={t.classesOverview.manage}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {classes.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-400 italic text-sm">
                    {t.classesOverview.noClasses}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hidden">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-surface p-6 rounded-2xl border border-border-default shadow-sm dark:shadow-black/20 flex items-center space-x-4">
            <div className="w-12 h-12 bg-blue-50 dark:bg-blue-500/10 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                {t.stats.students}
              </p>
              <p className="text-2xl font-black text-heading">
                {Object.values(classStudentCounts).reduce((acc, curr) => acc + curr.active, 0)} /{' '}
                {studentsCount}
              </p>
            </div>
          </div>
          <div className="bg-surface p-6 rounded-2xl border border-border-default shadow-sm dark:shadow-black/20 flex items-center space-x-4">
            <div className="w-12 h-12 bg-blue-50 dark:bg-blue-500/10 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                {t.stats.teachers}
              </p>
              <p className="text-2xl font-black text-heading">{registeredTeachers.length}</p>
            </div>
          </div>
          <div className="bg-surface p-6 rounded-2xl border border-border-default shadow-sm dark:shadow-black/20 flex items-center space-x-4">
            <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                {t.stats.classes}
              </p>
              <p className="text-2xl font-black text-heading">{classes.length}</p>
            </div>
          </div>
          <div
            className={`bg-surface p-6 rounded-2xl border shadow-sm dark:shadow-black/20 flex items-center space-x-4 ${
              fundReport && fundReport.balance < 0
                ? 'border-red-200 dark:border-red-800'
                : 'border-border-default'
            }`}
          >
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                fundReport && fundReport.balance < 0
                  ? 'bg-red-50 dark:bg-red-500/10 text-red-600'
                  : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
              }`}
            >
              <DollarSign className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                {t.fundReportLabel}
              </p>
              {reportLoading && !fundReport ? (
                <div className="h-7 flex items-center">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : fundReport ? (
                <>
                  <p
                    className={`text-xl font-black ${
                      fundReport.balance >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {fundReport.balance > 1000000
                      ? (fundReport.balance / 1000000).toFixed(1) + 'M'
                      : fundReport.balance > 1000
                        ? (fundReport.balance / 1000).toFixed(1) + 'K'
                        : fundReport.balance}
                    <span className="text-xs font-medium text-slate-400 ml-1">đ</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <span className="text-emerald-500">
                      +{(fundReport.totalIncome / 1000000).toFixed(1)}M
                    </span>
                    {' / '}
                    <span className="text-red-500">
                      -{(fundReport.totalExpenses / 1000000).toFixed(1)}M
                    </span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400">—</p>
              )}
            </div>
          </div>
        </div>

        {/* Fund Report Date Picker */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t.fromDate}</label>
            <ApiDateTextInput
              label={t.fromDate}
              hideLabel
              value={reportFrom}
              onChange={setReportFrom}
              inputClassName="px-3 py-2 bg-white border-slate-100 rounded-xl text-sm focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t.toDate}</label>
            <ApiDateTextInput
              label={t.toDate}
              hideLabel
              value={reportTo}
              onChange={setReportTo}
              inputClassName="px-3 py-2 bg-white border-slate-100 rounded-xl text-sm focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => handleLoadFundReport()}
            disabled={reportLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {reportLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {t.loadReport}
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <Link
            to="/admin/staff-password-resets"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded-xl font-medium hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors border border-purple-200 dark:border-purple-800"
          >
            <KeyRound className="w-4 h-4" />
            {t.staffResetRequests}
          </Link>
        </div>

        {/* Classes Overview */}
        <div className="bg-surface rounded-2xl border border-border-default shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-border-light flex items-center justify-between bg-page/50">
            <h2 className="text-lg font-bold text-heading flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-amber-500" />
              {t.classesOverview.title}
            </h2>
            <Link
              to="/classes"
              className="text-sm text-blue-600 font-medium hover:bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              {t.classesOverview.manage}
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left border-collapse">
              <thead>
                <tr className="bg-page/50 border-b border-border-light">
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {t.classesOverview.table.class}
                  </th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {t.classesOverview.table.teacher}
                  </th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {t.classesOverview.table.status}
                  </th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                    {t.classesOverview.table.totalStudents}
                  </th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                    {t.classesOverview.table.learning}
                  </th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                    {t.classesOverview.table.onLeave}
                  </th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                    {t.classesOverview.table.dropped}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedClasses.map((cls) => {
                  const teacher = registeredTeachers.find((t) => t.uid === cls.teacherId);
                  return (
                    <tr key={cls.id} className="hover:bg-hover transition-colors">
                      <td className="px-6 py-4">
                        <Link
                          to={`/classes/${cls.id}`}
                          className="text-sm font-bold text-heading hover:text-blue-600 transition-colors"
                        >
                          {cls.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">
                            {teacher?.displayName?.[0]?.toUpperCase() || '?'}
                          </div>
                          <span className="text-xs text-slate-600">
                            {teacher?.displayName || t.classesOverview.unassigned}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase',
                            cls.status === 'active'
                              ? 'bg-emerald-100 text-emerald-700 dark:text-emerald-400'
                              : cls.status === 'paused'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          {cls.status === 'active'
                            ? t.classesOverview.statusOptions.active
                            : cls.status === 'paused'
                              ? t.classesOverview.statusOptions.paused
                              : t.classesOverview.statusOptions.archived}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-bold text-heading">
                        {classStudentCounts[cls.id]?.total || 0}
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-bold text-emerald-600">
                        {classStudentCounts[cls.id]?.active || 0}
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-bold text-amber-600">
                        {classStudentCounts[cls.id]?.onLeave || 0}
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-bold text-red-600">
                        {classStudentCounts[cls.id]?.dropped || 0}
                      </td>
                    </tr>
                  );
                })}
                {classes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-400 italic text-sm">
                      {t.classesOverview.noClasses}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
