import React from 'react';
import toast from 'react-hot-toast';
import {
  Users,
  CalendarDays,
  ChevronDown,
  Download,
  Loader2,
  GraduationCap,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ClipboardList,
  Search,
  LineChart as LineChartIcon,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';
import { Student, Class } from '../../../types';
import { cn } from '../../../lib/core/utils';
import { DonutChart, HorizontalBarChart } from '../../../components/charts/ReportCharts';
import { AlignedDropdown } from '../../../components/common/AlignedDropdown';
import {
  DashboardMetricCard,
  DashboardCard,
  DashboardMiniStat,
  DonutLegend,
} from '../../../components/dashboard/DashboardWidgets';
import { formatMonthRange } from '../../../lib/reports/utils';
import {
  exportStudentDirectoryWorkbook,
  fetchStudentDirectoryExportStudents,
} from '../../../lib/exports/studentDirectoryExport';
import { formatClassNameWithTeacher } from '../../../lib/classes/sortClasses';
import { translations } from '../../../lib/i18n/translations';
import { matchesStudentStatusFilter } from '../../../lib/student/statusFilters';
import {
  buildGenderCounts,
  buildStudentsPerClassCounts,
  findUnevaluatedStudents,
} from '../../../lib/reports/reportStudentCharts';

interface ReportsEmbeddedDashboardProps {
  defaultClassId?: string;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  selectedClassId: string;
  setSelectedClassId: (classId: string) => void;
  dashboardSearch: string;
  setDashboardSearch: (search: string) => void;
  validStudents: Student[];
  classes: Class[];
  teachers: { uid: string; displayName: string }[];
  currentMonthAtts: any[];
  previousMonthAtts: any[];
  submissions: any[];
  validAssignmentIds: Set<string>;
  activeClassesList: Class[];
  academicPerformanceData: any[];
  weeklyData: any[];
  language: 'vi' | 'en';
  t: any; // translation reports object
}

export default function ReportsEmbeddedDashboard({
  defaultClassId,
  selectedMonth,
  setSelectedMonth,
  selectedClassId,
  setSelectedClassId,
  dashboardSearch,
  setDashboardSearch,
  validStudents,
  classes,
  teachers,
  currentMonthAtts,
  previousMonthAtts,
  submissions,
  validAssignmentIds,
  activeClassesList,
  academicPerformanceData,
  weeklyData,
  language,
  t,
}: ReportsEmbeddedDashboardProps) {
  const tm = t.misc;
  const tp = t.performance;
  const tg = t.gender;
  // Read straight from the catalog: the export labels must exist even when a
  // caller passes a partial `t`.
  const te = translations[language].reports.studentExport;

  const searchQuery = dashboardSearch.trim().toLowerCase();
  const dashboardStudents = searchQuery
    ? validStudents.filter((student) => {
        const classInfo = classes.find((c) => c.id === student.classId);
        const teacherInfo = teachers.find((teacher) => teacher.uid === classInfo?.teacherId);
        return [
          student.name,
          student.studentId,
          student.code,
          classInfo?.name,
          teacherInfo?.displayName,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(searchQuery));
      })
    : validStudents;

  const dashboardStudentIds = new Set(dashboardStudents.map((student) => student.id));
  // `validStudents` is already the canonical roster, so the headcount is simply its
  // size. Every donut below shares this denominator, which is what keeps the KPI card
  // and the gender/grade cards from showing two different "total students".
  const dashboardTotalStudents = dashboardStudents.length;
  const dashboardLearningStudents = dashboardStudents.filter((student) =>
    matchesStudentStatusFilter(student, 'active')
  ).length;

  const dashboardAtts = currentMonthAtts.filter((item) => dashboardStudentIds.has(item.studentId));
  const dashboardPresentAtts = dashboardAtts.filter((item) => item.status === 'present').length;
  const dashboardAvgAttRate =
    dashboardAtts.length > 0 ? Math.round((dashboardPresentAtts / dashboardAtts.length) * 100) : 0;

  const dashboardPreviousAtts = previousMonthAtts.filter((item) =>
    dashboardStudentIds.has(item.studentId)
  );
  const dashboardPreviousPresent = dashboardPreviousAtts.filter(
    (item) => item.status === 'present'
  ).length;
  const dashboardPreviousRate =
    dashboardPreviousAtts.length > 0
      ? Math.round((dashboardPreviousPresent / dashboardPreviousAtts.length) * 100)
      : 0;
  const dashboardAttendanceDelta = dashboardAvgAttRate - dashboardPreviousRate;

  const dashboardUngradedSubs = submissions.filter(
    (submission) =>
      submission.status === 'submitted' &&
      validAssignmentIds.has(submission.assignmentId) &&
      dashboardStudentIds.has(submission.studentId)
  ).length;

  const dashboardClassCount = searchQuery
    ? new Set(dashboardStudents.map((student) => student.classId)).size
    : activeClassesList.length;

  const dashboardClassDistribution = buildStudentsPerClassCounts(
    dashboardStudents,
    activeClassesList
  );
  const dashboardStudentsPerClass = [
    ...dashboardClassDistribution.perClass,
    ...(dashboardClassDistribution.outsideVisibleClasses > 0
      ? [
          {
            classId: 'outside-visible-classes',
            label: tm?.outsideVisibleClasses || 'Unassigned / hidden class',
            value: dashboardClassDistribution.outsideVisibleClasses,
          },
        ]
      : []),
  ].filter((item) => item.value > 0);

  const genderCounts = buildGenderCounts(dashboardStudents);
  const dashboardGenderData = [
    {
      label: tg?.male || 'Male',
      value: genderCounts.male,
      color: '#2563eb',
    },
    {
      label: tg?.female || 'Female',
      value: genderCounts.female,
      color: '#ec4899',
    },
    {
      label: tg?.other || 'Other',
      value: genderCounts.other,
      color: '#cbd5e1',
    },
  ];
  const genderTotal = dashboardGenderData.reduce((sum, item) => sum + item.value, 0);

  const performanceScopeStudents =
    selectedClassId === 'all'
      ? dashboardStudents
      : dashboardStudents.filter((student) => student.classId === selectedClassId);
  const performanceScopeStudentIds = new Set(performanceScopeStudents.map((student) => student.id));

  const evaluatedDashboardPerformanceData = academicPerformanceData
    .map((item) => {
      const categoryStudents = item.students.filter(({ student }: any) =>
        performanceScopeStudentIds.has(student.id)
      );
      return { ...item, value: categoryStudents.length, students: categoryStudents };
    })
    .filter((item) => item.value > 0);

  const evaluatedPerformanceStudentIds = new Set(
    evaluatedDashboardPerformanceData.flatMap((item) =>
      item.students.map(({ student }: any) => student.id)
    )
  );
  const unevaluatedStudents = findUnevaluatedStudents(
    performanceScopeStudents,
    evaluatedPerformanceStudentIds
  );

  const dashboardPerformanceData = [
    ...evaluatedDashboardPerformanceData,
    ...(unevaluatedStudents.length > 0
      ? [
          {
            label: tm?.notEvaluated || 'Not evaluated',
            value: unevaluatedStudents.length,
            color: '#94a3b8',
            students: unevaluatedStudents.map((student) => ({ student, score: 0 })),
          },
        ]
      : []),
  ];

  const dashboardScores = evaluatedDashboardPerformanceData.flatMap((item) =>
    item.students.map((entry: any) => {
      const score = Number(entry.score);
      return score > 10 ? score / 10 : score;
    })
  );

  const averageScore =
    dashboardScores.length > 0
      ? dashboardScores.reduce((sum, score) => sum + score, 0) / dashboardScores.length
      : 0;
  const strongStudents = dashboardScores.filter((score) => score >= 8).length;
  const supportStudents = dashboardScores.filter((score) => score < 6.5).length;

  const gradeTg = translations[language].reports.grade;
  const dashboardGradeData = (() => {
    const counts: Record<number, number> = {};
    let unknownCount = 0;

    dashboardStudents.forEach((student) => {
      if (student.grade && student.grade >= 1 && student.grade <= 12) {
        counts[student.grade] = (counts[student.grade] || 0) + 1;
      } else {
        unknownCount++;
      }
    });

    return [
      {
        label: gradeTg?.elementary || 'Elementary',
        value:
          (counts[1] || 0) +
          (counts[2] || 0) +
          (counts[3] || 0) +
          (counts[4] || 0) +
          (counts[5] || 0),
        color: '#2563eb',
      },
      {
        label: gradeTg?.middle || 'Middle School',
        value: (counts[6] || 0) + (counts[7] || 0) + (counts[8] || 0) + (counts[9] || 0),
        color: '#10b981',
      },
      {
        label: gradeTg?.high || 'High School',
        value: (counts[10] || 0) + (counts[11] || 0) + (counts[12] || 0),
        color: '#fb923c',
      },
      { label: gradeTg?.unknown || 'Unknown', value: unknownCount, color: '#a855f7' },
    ].filter((item) => item.value > 0);
  })();
  const gradeTotal = dashboardGradeData.reduce((sum, item) => sum + item.value, 0);

  const maleCount = dashboardGenderData[0]?.value || 0;
  const femaleCount = dashboardGenderData[1]?.value || 0;
  const genderDifference = Math.abs(maleCount - femaleCount);
  const genderLeadTitle =
    maleCount === femaleCount
      ? tm?.balancedGender || 'Balanced gender mix'
      : maleCount > femaleCount
        ? tm?.maleLeadsFemale || 'Male leads female'
        : tm?.femaleLeadsMale || 'Female leads male';
  const genderLeadValue =
    maleCount === femaleCount
      ? tm?.zeroStudents || '0 students'
      : `${genderDifference} ${tm?.students || 'students'}`;

  const monthRangeLabel = formatMonthRange(selectedMonth, language);
  const todayLabel = new Date().toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const todayFileStamp = new Date().toISOString().slice(0, 10);
  const allClassesLabel = t.filters.allClasses || tm?.allClasses || 'All classes';

  const [isExporting, setIsExporting] = React.useState(false);

  const exportedClassName = defaultClassId
    ? classes.find((classInfo) => classInfo.id === defaultClassId)?.name || ''
    : '';

  /**
   * Exports every student record the current user may see - the whole center on
   * the students page, or just the class when the dashboard is embedded in a
   * class detail. The student list is re-read here because the report channel
   * only carries the academic projection, which has no contact number.
   */
  const exportStudentDirectory = async () => {
    if (isExporting) return;
    setIsExporting(true);
    const toastId = toast.loading(te.exporting);

    try {
      const students = await fetchStudentDirectoryExportStudents();
      const rows = await exportStudentDirectoryWorkbook({
        students,
        classes,
        teachers,
        classId: defaultClassId,
        fileName: `${te.fileName}-${todayFileStamp}.xlsx`,
        labels: {
          sheetName: te.sheetName,
          title: defaultClassId ? te.classTitle.replace('{class}', exportedClassName) : te.title,
          generatedAt: te.generatedAt.replace('{date}', todayLabel),
          totalStudents: te.totalStudents,
          headers: te.headers,
          gender: te.gender,
          status: te.status,
          unassignedClass: te.unassignedClass,
          unknownTeacher: te.unknownTeacher,
        },
      });

      if (rows.length === 0) {
        toast.error(te.empty, { id: toastId });
        return;
      }
      toast.success(te.success.replace('{count}', String(rows.length)), { id: toastId });
    } catch (error) {
      console.error('Error exporting student directory:', error);
      toast.error(te.error, { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  const metricCards = [
    {
      label: t.kpi.totalStudents,
      value: dashboardTotalStudents,
      icon: Users,
      color: '#2563eb',
      bg: 'bg-blue-50',
      note: (tm?.currentlyLearning || '{count} currently learning').replace(
        '{count}',
        String(dashboardLearningStudents)
      ),
      trend: 'up' as const,
      sparkline: dashboardStudentsPerClass.map((item) => item.value),
    },
    {
      label: t.kpi.avgAttendance,
      value: `${dashboardAvgAttRate}%`,
      icon: BookOpen,
      color: '#10b981',
      bg: 'bg-emerald-50',
      note:
        dashboardAttendanceDelta === 0
          ? tm?.noChange || 'No change'
          : `${dashboardAttendanceDelta > 0 ? '+' : ''}${dashboardAttendanceDelta}% ${tm?.vsLastMonth || 'vs last month'}`,
      trend:
        dashboardAttendanceDelta > 0
          ? ('up' as const)
          : dashboardAttendanceDelta < 0
            ? ('down' as const)
            : ('flat' as const),
      sparkline: weeklyData.map((item) => item.value),
    },
    {
      label: t.kpi.ungradedSubmissions,
      value: dashboardUngradedSubs,
      icon: ShieldCheck,
      color: '#fb923c',
      bg: 'bg-orange-50',
      note:
        dashboardUngradedSubs > 0
          ? tm?.needsGrading || 'Needs grading'
          : tm?.noPendingWork || 'No pending work',
      trend: dashboardUngradedSubs > 0 ? ('down' as const) : ('flat' as const),
      sparkline: [
        1,
        dashboardUngradedSubs,
        Math.max(0, dashboardUngradedSubs - 1),
        dashboardUngradedSubs,
      ],
    },
    {
      label: t.kpi.activeClasses,
      value: dashboardClassCount,
      icon: LineChartIcon,
      color: '#9333ea',
      bg: 'bg-purple-50',
      note: (tm?.trackedClasses || '{count} tracked classes').replace(
        '{count}',
        String(activeClassesList.length)
      ),
      trend: 'up' as const,
      sparkline: dashboardStudentsPerClass.map((item) => item.value + 1),
    },
  ];

  const translationsGrade = translations[language].reports.grade;

  return (
    <div className="w-full space-y-5 pb-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Users className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              {tm?.studentOverview || 'Student overview'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {tm?.studentOverviewDesc ||
                'Track student learning and classroom activity across the system.'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex h-11 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-500 shadow-sm md:w-[360px]">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={dashboardSearch}
              onChange={(event) => setDashboardSearch(event.target.value)}
              placeholder={tm?.searchStudentsPlaceholder || 'Search students, classes, teachers...'}
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
            />
            <span className="hidden rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500 sm:inline">
              Ctrl K
            </span>
          </label>

          <label className="relative flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            <span>{monthRangeLabel}</span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(event) => {
                if (event.target.value) setSelectedMonth(event.target.value);
              }}
              aria-label={tm?.selectReportMonth || 'Select report month'}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>

          <button
            type="button"
            onClick={() => void exportStudentDirectory()}
            disabled={isExporting}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-bold text-blue-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isExporting ? te.exporting : tm?.exportReport || 'Export report'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => (
          <DashboardMetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <DashboardCard title={tg?.title || 'Gender Distribution'} icon={Users} iconColor="#2563eb">
          <div className="grid gap-6 md:grid-cols-[240px_1fr] md:items-center">
            <DonutChart
              data={dashboardGenderData}
              colors={dashboardGenderData.map((item) => item.color || '#2563eb')}
              tm={tm}
            />
            <DonutLegend data={dashboardGenderData} total={genderTotal} />
          </div>
          <div className="mt-5 grid grid-cols-1 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white md:grid-cols-3 md:divide-x md:divide-y-0">
            <DashboardMiniStat
              icon={Users}
              label={t.kpi.totalStudents}
              value={genderTotal}
              color="#2563eb"
              bg="bg-blue-50"
            />
            <DashboardMiniStat
              icon={Users}
              label={genderLeadTitle}
              value={genderLeadValue}
              color="#2563eb"
              bg="bg-blue-50"
            />
            <DashboardMiniStat
              icon={CalendarDays}
              label={tm?.updated || 'Updated'}
              value={todayLabel}
              color="#2563eb"
              bg="bg-blue-50"
            />
          </div>
        </DashboardCard>

        <DashboardCard
          title={tp?.title || 'Academic Performance'}
          icon={GraduationCap}
          iconColor="#2563eb"
          action={
            <AlignedDropdown
              ariaLabel={allClassesLabel}
              value={selectedClassId}
              onChange={setSelectedClassId}
              options={[
                { value: 'all', label: allClassesLabel },
                ...activeClassesList.map((classInfo) => ({
                  value: classInfo.id,
                  label: formatClassNameWithTeacher(classInfo, teachers),
                })),
              ]}
              align="right"
              className="min-w-[11rem]"
              buttonClassName="h-9 rounded-xl border-slate-200 bg-white pl-4 pr-3 text-sm font-semibold text-slate-700 shadow-none focus:border-blue-300 focus:ring-blue-100"
              menuClassName="w-max max-w-[min(28rem,calc(100vw-2rem))]"
            />
          }
        >
          <HorizontalBarChart data={dashboardPerformanceData} tm={tm} />
          <div className="mt-5 grid grid-cols-1 divide-y divide-slate-100 rounded-xl border border-slate-200 md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {tm?.averageScore || 'Average score'}
                </p>
                <p className="text-lg font-bold text-slate-950">{averageScore.toFixed(1)} / 10</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {tm?.fromEightScore || '8+ score'}
                </p>
                <p className="text-lg font-bold text-slate-950">
                  {strongStudents} {tm?.students || 'students'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                <TrendingDown className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {tm?.needsSupport || 'Needs support'}
                </p>
                <p className="text-lg font-bold text-slate-950">
                  {supportStudents} {tm?.students || 'students'}
                </p>
              </div>
            </div>
          </div>
        </DashboardCard>
      </div>

      <DashboardCard
        title={translationsGrade?.stage || 'Stage Distribution'}
        icon={GraduationCap}
        iconColor="#8b5cf6"
      >
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[0.42fr_0.58fr] xl:items-center">
          <div className="grid gap-6 md:grid-cols-[220px_1fr] md:items-center">
            <DonutChart
              data={dashboardGradeData}
              colors={dashboardGradeData.map((item) => item.color || '#2563eb')}
              tm={tm}
            />
            <DonutLegend data={dashboardGradeData} total={gradeTotal} />
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                <ClipboardList className="h-10 w-10" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-bold text-slate-950">
                  {tm?.quickInsight || 'Quick insight'}
                </h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {tm?.quickInsightDesc ||
                    'Live data helps you understand student status quickly and accurately.'}
                </p>
                <button
                  type="button"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                  onClick={() => {
                    window.location.href = '/reports';
                  }}
                >
                  {tm?.viewDetails || 'View details'}
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
}
