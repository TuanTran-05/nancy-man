import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart,
  BarChart3,
  LineChart as LineChartIcon,
  Radar,
  Filter,
  BookOpen,
  Users,
  ClipboardList,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  TrendingDown,
  Target,
  Zap,
  Clock,
  ShieldCheck,
  Gamepad2,
  GraduationCap,
  CalendarDays,
  Download,
  MoreVertical,
  Search,
  ChevronDown,
  ArrowUpRight,
  Minus,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Student, Class, Attendance, Assignment, Submission, Evaluation } from '../../types';
import { readChannel } from '../../lib/api/readApi';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { cn } from '../../lib/core/utils';
import { ModalPortal } from '../../components/common/ModalPortal';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import { FRONTEND_COLLECTION_LIMIT } from '../../lib/api/readLimits';
import {
  PieChartVisual,
  DonutChart,
  BarChart,
  HorizontalBarChart,
  LineChart,
  RadarChart,
} from '../../components/charts/ReportCharts';
import {
  Sparkline,
  DashboardMetricCard,
  DashboardCard,
  DashboardMiniStat,
  DonutLegend,
} from '../../components/dashboard/DashboardWidgets';
import { formatMonthRange, exportCsv } from '../../lib/reports/utils';
import { buildReportStudentScope } from '../../lib/reports/reportStudentScope';
import {
  buildCurrentStudentStatusCounts,
  buildGenderCounts,
  buildStudentsPerClassCounts,
  findUnevaluatedStudents,
} from '../../lib/reports/reportStudentCharts';
import ReportsEmbeddedDashboard from './reports/ReportsEmbeddedDashboard';

const REPORT_COLLECTION_LIMIT = FRONTEND_COLLECTION_LIMIT;

type ReportsMonthlyRead = {
  month: string;
  students: Student[];
  classes: Class[];
  attendance: Attendance[];
  assignments: Assignment[];
  submissions: Submission[];
  evaluations: Evaluation[];
  teachers: { uid: string; displayName: string }[];
};

// Inline SVG Chart Components

export default function Reports({
  defaultClassId,
  embedded = false,
}: {
  defaultClassId?: string;
  embedded?: boolean;
}) {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = translations[language].reports;
  const tm = t.misc;
  const tp = t.performance;
  const tg = t.gender;
  const trd = t.radar;

  const [activeTab, setActiveTab] = useState<
    'overview' | 'attendance' | 'assignments' | 'evaluations'
  >('overview');

  // Data State
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [teachers, setTeachers] = useState<{ uid: string; displayName: string }[]>([]);

  const [selectedCategory, setSelectedCategory] = useState<{
    label: string;
    students: { student: Student; score: number }[];
    color: string;
  } | null>(null);

  // Filter State
  const [selectedClassId, setSelectedClassId] = useState<string>(defaultClassId || 'all');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [showInactiveClasses, setShowInactiveClasses] = useState(true); // Default to true if embedded so we see the paused class's data
  const [dashboardSearch, setDashboardSearch] = useState('');

  useBodyScrollLock(!!selectedCategory);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    setLoading(true);
    readChannel<ReportsMonthlyRead>('reports-monthly', {
      scope: 'academic',
      month: selectedMonth,
      limit: REPORT_COLLECTION_LIMIT,
    })
      .then((data) => {
        if (cancelled) return;
        const mapped = data.students || [];
        setStudents(mapped as Student[]);
        setClasses((data.classes || []) as Class[]);
        setAttendance((data.attendance || []) as Attendance[]);
        setAssignments((data.assignments || []) as Assignment[]);
        setSubmissions((data.submissions || []) as Submission[]);
        setEvaluations((data.evaluations || []) as Evaluation[]);
        setTeachers(data.teachers || []);
        if (mapped.length > 0) {
          setSelectedStudentId((prev) => prev || mapped[0].id);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStudents([]);
          setClasses([]);
          setAttendance([]);
          setAssignments([]);
          setSubmissions([]);
          setEvaluations([]);
          setTeachers([]);
        }
        console.error('Error fetching report data:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile, selectedMonth]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[500px]">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ---- Tab 1: OVERVIEW Computed Data ----
  const activeClassesList = sortClassesByTeacherThenName(
    classes.filter((c) => {
      if (embedded && defaultClassId) return c.id === defaultClassId;
      return showInactiveClasses ? c.status !== 'archived' : c.status === 'active';
    }),
    teachers
  );
  const activeClassIds = new Set(activeClassesList.map((c) => c.id));

  // Headcounts come from the canonical roster so this page and the students
  // directory cannot disagree. Class-based scoping is applied per chart instead,
  // otherwise students in archived or unassigned classes vanish from the totals.
  const reportClassId =
    defaultClassId || (!embedded && selectedClassId !== 'all' ? selectedClassId : undefined);
  const studentScope = buildReportStudentScope(students, reportClassId);
  const validStudents = studentScope.roster;

  const statusCounts = buildCurrentStudentStatusCounts(studentScope);

  // Rates are scoped to the roster, not to the visible classes, so the attendance
  // percentage and the headcount describe the same population.
  const rosterStudentIds = studentScope.studentIds;

  const currentMonthAtts = attendance.filter(
    (a) => a.date.startsWith(selectedMonth) && rosterStudentIds.has(a.studentId)
  );
  const totalAtts = currentMonthAtts.length;
  const presentAtts = currentMonthAtts.filter((a) => a.status === 'present').length;
  const avgAttRate = totalAtts > 0 ? Math.round((presentAtts / totalAtts) * 100) : 0;

  const previousMonthDate = new Date(`${selectedMonth}-01T00:00:00`);
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonth = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const previousMonthAtts = attendance.filter(
    (a) => a.date.startsWith(previousMonth) && rosterStudentIds.has(a.studentId)
  );
  const previousPresentAtts = previousMonthAtts.filter((a) => a.status === 'present').length;
  const previousAvgAttRate =
    previousMonthAtts.length > 0
      ? Math.round((previousPresentAtts / previousMonthAtts.length) * 100)
      : 0;
  const attendanceDelta = avgAttRate - previousAvgAttRate;

  // `assignments` is already limited to classes this user may see, so this only
  // guards against submissions pointing at an assignment that no longer exists.
  // Narrowing further by class would drop roster students whose class was archived.
  const validAssignmentIds = new Set(assignments.map((a) => a.id));
  const ungradedSubs = submissions.filter(
    (s) =>
      s.status === 'submitted' &&
      validAssignmentIds.has(s.assignmentId) &&
      rosterStudentIds.has(s.studentId)
  ).length;

  // This chart partitions the same current roster as the KPI. Historical dropped
  // students are deliberately excluded so its bars always add up to the headcount.
  const studentStatusData = [
    { label: t.status.active, value: statusCounts.learning, color: '#10b981' },
    { label: t.status.trial, value: statusCounts.trial, color: '#06b6d4' },
    { label: t.status.leave, value: statusCounts.onLeave, color: '#f59e0b' },
  ].filter((d) => d.value > 0);

  const chartClasses = reportClassId
    ? activeClassesList.filter((classInfo) => classInfo.id === reportClassId)
    : activeClassesList;
  const classDistribution = buildStudentsPerClassCounts(validStudents, chartClasses);
  const studentsPerClassData = [
    ...classDistribution.perClass.map((item) => ({ ...item, color: '#3b82f6' })),
    ...(classDistribution.outsideVisibleClasses > 0
      ? [
          {
            label: tm?.outsideVisibleClasses || 'Unassigned / hidden class',
            value: classDistribution.outsideVisibleClasses,
            color: '#94a3b8',
          },
        ]
      : []),
  ];

  // Calculate Academic Performance Distribution based on latest evaluation finalScore
  const latestEvaluationsMap = new Map<string, Evaluation>();
  evaluations.forEach((ev) => {
    if (rosterStudentIds.has(ev.studentId) && ev.finalScore !== undefined) {
      if (selectedClassId !== 'all' && ev.classId !== selectedClassId) return;
      const existing = latestEvaluationsMap.get(ev.studentId);
      if (!existing || new Date(ev.date) > new Date(existing.date)) {
        latestEvaluationsMap.set(ev.studentId, ev);
      }
    }
  });

  const excellentStudents: { student: Student; score: number }[] = []; // >= 90
  const goodStudents: { student: Student; score: number }[] = []; // 80 - 89
  const fairStudents: { student: Student; score: number }[] = []; // 65 - 79
  const averageStudents: { student: Student; score: number }[] = []; // < 65

  latestEvaluationsMap.forEach((ev, studentId) => {
    const rawScore = ev.finalScore;
    if (typeof rawScore === 'undefined' || rawScore === null) return;

    // Some final scores might be out of 10 or 100.
    const numScore = Number(rawScore);
    if (!isNaN(numScore)) {
      const student = validStudents.find((s) => s.id === studentId);
      if (student) {
        const score = numScore <= 10 ? numScore * 10 : numScore;
        const entry = { student, score: numScore };
        if (score >= 90) excellentStudents.push(entry);
        else if (score >= 80) goodStudents.push(entry);
        else if (score >= 65) fairStudents.push(entry);
        else averageStudents.push(entry);
      }
    }
  });

  excellentStudents.sort((a, b) => b.score - a.score);
  goodStudents.sort((a, b) => b.score - a.score);
  fairStudents.sort((a, b) => b.score - a.score);
  averageStudents.sort((a, b) => b.score - a.score);

  const academicPerformanceData = [
    {
      label: tp?.excellent || 'Excellent',
      value: excellentStudents.length,
      color: '#10b981',
      students: excellentStudents,
    }, // Emerald-500
    {
      label: tp?.good || 'Good',
      value: goodStudents.length,
      color: '#06b6d4',
      students: goodStudents,
    }, // Sky-500
    {
      label: tp?.fair || 'Fair',
      value: fairStudents.length,
      color: '#f59e0b',
      students: fairStudents,
    }, // Amber-500
    {
      label: tp?.average || 'Average',
      value: averageStudents.length,
      color: '#f43f5e',
      students: averageStudents,
    }, // Rose-500
  ].filter((d) => d.value > 0);

  const evaluatedPerformanceStudentIds = new Set(
    academicPerformanceData.flatMap((item) => item.students.map(({ student }) => student.id))
  );
  const unevaluatedPerformanceStudents = findUnevaluatedStudents(
    validStudents,
    evaluatedPerformanceStudentIds
  );
  const academicPerformanceChartData = [
    ...academicPerformanceData,
    ...(unevaluatedPerformanceStudents.length > 0
      ? [
          {
            label: tm?.notEvaluated || 'Not evaluated',
            value: unevaluatedPerformanceStudents.length,
            color: '#94a3b8',
            students: unevaluatedPerformanceStudents.map((student) => ({ student, score: 0 })),
          },
        ]
      : []),
  ];

  const genderCounts = buildGenderCounts(validStudents);
  const genderDistributionData = [
    {
      label: tg?.male || 'Male',
      value: genderCounts.male,
      color: '#3b82f6',
    },
    {
      label: tg?.female || 'Female',
      value: genderCounts.female,
      color: '#f472b6',
    },
    {
      label: tg?.other || 'Other',
      value: genderCounts.other,
      color: '#94a3b8',
    },
  ];

  const gradeDistData = (() => {
    const gradeTg = translations[language].reports.grade;
    const counts: Record<number, number> = {};
    let unknownCount = 0;

    validStudents.forEach((s) => {
      if (s.grade && s.grade >= 1 && s.grade <= 12) {
        counts[s.grade] = (counts[s.grade] || 0) + 1;
      } else {
        unknownCount++;
      }
    });

    return {
      stageData: [
        {
          label: gradeTg?.elementary || 'Elementary',
          value:
            (counts[1] || 0) +
            (counts[2] || 0) +
            (counts[3] || 0) +
            (counts[4] || 0) +
            (counts[5] || 0),
          color: '#10b981',
        },
        {
          label: gradeTg?.middle || 'Middle School',
          value: (counts[6] || 0) + (counts[7] || 0) + (counts[8] || 0) + (counts[9] || 0),
          color: '#3b82f6',
        },
        {
          label: gradeTg?.high || 'High School',
          value: (counts[10] || 0) + (counts[11] || 0) + (counts[12] || 0),
          color: '#8b5cf6',
        },
        { label: gradeTg?.unknown || 'Unknown', value: unknownCount, color: '#94a3b8' },
      ].filter((d) => d.value > 0),
      gradeBarData: [
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => ({
          label: `${g}`,
          value: counts[g] || 0,
          color: g <= 5 ? '#10b981' : g <= 9 ? '#3b82f6' : '#8b5cf6',
        })),
        ...(unknownCount > 0 ? [{ label: '?', value: unknownCount, color: '#94a3b8' }] : []),
      ],
    };
  })();

  // ---- Tab 2: ATTENDANCE Computed Data ----
  const attClassFiltered =
    selectedClassId === 'all'
      ? attendance.filter((a) => rosterStudentIds.has(a.studentId))
      : attendance.filter((a) => a.classId === selectedClassId);

  const attMonthFiltered = attClassFiltered.filter((a) => a.date.startsWith(selectedMonth));

  // Weekly attendance rate
  // Rough week binning based on date (assuming 4 weeks)
  const weeklyData = [1, 2, 3, 4].map((w) => {
    const weekStart = `${selectedMonth}-0${w === 1 ? 1 : w === 2 ? 8 : w === 3 ? 15 : 22}`;
    const weekEnd = `${selectedMonth}-${w === 1 ? '07' : w === 2 ? '14' : w === 3 ? '21' : '31'}`;
    const wAtts = attMonthFiltered.filter((a) => a.date >= weekStart && a.date <= weekEnd);
    const wp = wAtts.filter((a) => a.status === 'present').length;
    return {
      label: `${tm?.week || 'Week'} ${w}`,
      value: wAtts.length ? Math.round((wp / wAtts.length) * 100) : 0,
    };
  });

  const studentsInFilteredClasses =
    selectedClassId === 'all'
      ? validStudents
      : validStudents.filter((s) => s.classId === selectedClassId);

  const attTableData = studentsInFilteredClasses.map((s) => {
    const sa = attMonthFiltered.filter((a) => a.studentId === s.id);
    const pres = sa.filter((a) => a.status === 'present').length;
    const abs = sa.filter((a) => a.status === 'absent').length;
    const late = sa.filter((a) => a.status === 'late').length;
    const rate = sa.length > 0 ? Math.round((pres / sa.length) * 100) : 0;

    // Attempt to lookup class name
    let displayName = s.name;
    if (selectedClassId === 'all') {
      const clsName = classes.find((c) => c.id === s.classId)?.name;
      if (clsName) {
        displayName += ` (${clsName})`;
      }
    }

    return { ...s, displayName, pres, abs, late, rate };
  });

  // ---- Tab 3: ASSIGNMENTS Computed Data ----
  const assClassFiltered =
    selectedClassId === 'all'
      ? assignments.filter((a) => activeClassIds.has(a.classId))
      : assignments.filter((a) => a.classId === selectedClassId);

  const assTableData = assClassFiltered.map((a) => {
    const subs = submissions.filter((s) => s.assignmentId === a.id && s.status === 'graded');
    const scores = subs.map((s) => s.grade || 0);

    let displayName = a.title;
    if (selectedClassId === 'all') {
      const clsName = classes.find((c) => c.id === a.classId)?.name;
      if (clsName) {
        displayName += ` (${clsName})`;
      }
    }

    return {
      name: displayName,
      subsCount: subs.length,
      avg: scores.length
        ? Math.round(scores.reduce((val, cur) => val + cur, 0) / scores.length)
        : 0,
      high: scores.length ? Math.max(...scores) : 0,
      low: scores.length ? Math.min(...scores) : 0,
    };
  });

  // Top 5 students by grade
  const studentScores = studentsInFilteredClasses
    .map((st) => {
      const stSubs = submissions.filter((s) => s.studentId === st.id && s.status === 'graded');
      const sc = stSubs.map((s) => s.grade || 0);
      const avg = sc.length > 0 ? sc.reduce((a, b) => a + b, 0) / sc.length : 0;

      let displayName = st.name;
      if (selectedClassId === 'all') {
        const clsName = classes.find((c) => c.id === st.classId)?.name;
        if (clsName) displayName += ` (${clsName})`;
      }

      return { label: displayName, value: Math.round(avg), color: '#10b981' };
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // ---- Tab 4: EVALUATIONS Computed Data ----
  const stEvals = evaluations
    .filter((e) => e.studentId === selectedStudentId)
    .sort((a, b) => a.date.localeCompare(b.date));

  let radarData: any[] = [];
  if (stEvals.length > 0) {
    const latest = stEvals[stEvals.length - 1].scores;
    radarData = [
      { label: trd?.attendance || 'Attendance', value: Number(latest.attendance) || 0 },
      { label: trd?.effort || 'Effort', value: Number(latest.effort) || 0 },
      { label: trd?.pronunciation || 'Pronunciation', value: Number(latest.pronunciation) || 0 },
      { label: trd?.homework || 'Homework', value: Number(latest.homework) || 0 },
      { label: trd?.behavior || 'Behavior', value: Number(latest.behavior) || 0 },
    ];
  }

  const evalProgressData = stEvals.map((e) => {
    let formattedDate = e.date;
    try {
      const d = new Date(e.date);
      if (!isNaN(d.getTime())) {
        formattedDate = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      }
    } catch {
      /* invalid date */
    }

    return {
      label: formattedDate,
      value: e.totalScore || 0,
    };
  });

  const tabs = [
    { id: 'overview', icon: PieChart, label: t.overview },
    { id: 'attendance', icon: CheckCircle2, label: t.attendance },
    { id: 'assignments', icon: ClipboardList, label: t.assignments },
    { id: 'evaluations', icon: Target, label: t.evaluations },
  ] as const;

  if (embedded) {
    return (
      <ReportsEmbeddedDashboard
        defaultClassId={defaultClassId}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        selectedClassId={selectedClassId}
        setSelectedClassId={setSelectedClassId}
        dashboardSearch={dashboardSearch}
        setDashboardSearch={setDashboardSearch}
        validStudents={validStudents}
        classes={classes}
        teachers={teachers}
        currentMonthAtts={currentMonthAtts}
        previousMonthAtts={previousMonthAtts}
        submissions={submissions}
        validAssignmentIds={validAssignmentIds}
        activeClassesList={activeClassesList}
        academicPerformanceData={academicPerformanceData}
        weeklyData={weeklyData}
        language={language}
        t={t}
      />
    );
  }

  return (
    <div className={cn('mx-auto pb-12', embedded ? 'w-full' : 'max-w-7xl')}>
      {!embedded && (
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-body tracking-tight">{t.title}</h1>
            <p className="text-muted mt-2">{tm?.realtimeInfo || 'Data is updated in real time.'}</p>
          </div>
          <div className="flex items-center space-x-2 bg-page px-4 py-2 rounded-lg border border-border-default">
            <input
              type="checkbox"
              id="showInactive"
              checked={showInactiveClasses}
              onChange={(e) => setShowInactiveClasses(e.target.checked)}
              className="w-4 h-4 text-blue-600 dark:text-blue-400 rounded border-slate-300 focus:ring-blue-500"
            />
            <label
              htmlFor="showInactive"
              className="text-sm font-medium text-slate-700 select-none cursor-pointer"
            >
              {tm?.includePaused || 'Include paused classes'}
            </label>
          </div>
        </div>
      )}

      {/* TABS */}
      <div className="flex space-x-2 border-b border-border-default mb-8 overflow-x-auto pb-1 hide-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center space-x-2 px-6 py-3 rounded-t-xl font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-surface text-blue-600 dark:text-blue-400 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] border-t-2 border-blue-500'
                : 'text-muted hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            <tab.icon className="w-5 h-5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-surface rounded-2xl shadow-sm border border-border-light p-6 sm:p-8"
        >
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {!embedded && (
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-muted mb-1 pointer-events-none">
                      {t.filters.selectClass}
                    </label>
                    <select
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                      className="w-full bg-page border border-border-default rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="all">{t.filters.allClasses}</option>
                      {activeClassesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {formatClassNameWithTeacher(c, teachers)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {/* KPI CARDS */}
              <div className="grid border-x border-t border-border-default rounded-xl overflow-hidden grid-cols-2 md:grid-cols-4">
                {[
                  {
                    label: t.kpi.totalStudents,
                    value: studentScope.total,
                    icon: Users,
                    color: 'text-blue-600 dark:text-blue-400',
                    bg: 'bg-blue-50 dark:bg-blue-500/10',
                  },
                  {
                    label: t.kpi.avgAttendance,
                    value: `${avgAttRate}%`,
                    icon: BookOpen,
                    color: 'text-green-600 dark:text-green-400',
                    bg: 'bg-green-50 dark:bg-green-500/10',
                  },
                  {
                    label: t.kpi.ungradedSubmissions,
                    value: ungradedSubs,
                    icon: ShieldCheck,
                    color: 'text-amber-600 dark:text-amber-400',
                    bg: 'bg-amber-50 dark:bg-amber-500/10',
                  },
                  {
                    label: t.kpi.activeClasses,
                    value: reportClassId
                      ? activeClassesList.filter((classInfo) => classInfo.id === reportClassId)
                          .length
                      : activeClassesList.length,
                    icon: LineChartIcon,
                    color: 'text-purple-600 dark:text-purple-400',
                    bg: 'bg-purple-50 dark:bg-purple-500/10',
                  },
                ].map((kpi, i) => (
                  <div
                    key={i}
                    className="p-6 border-b border-r border-border-default bg-surface hover:bg-hover transition-colors flex flex-col justify-center"
                  >
                    <div className="flex items-center space-x-3 mb-4">
                      <div className={`p-2 rounded-lg ${kpi.bg}`}>
                        <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                      </div>
                      <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                        {kpi.label}
                      </span>
                    </div>
                    <span className="text-3xl sm:text-4xl font-bold text-body">{kpi.value}</span>
                  </div>
                ))}
              </div>

              {/* OVERVIEW CHARTS */}
              <div
                className={cn(
                  'grid gap-6',
                  embedded ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'
                )}
              >
                <div className="p-6 border border-border-default rounded-2xl bg-surface shadow-sm dark:shadow-black/20 hover:shadow-md transition-shadow">
                  <h3 className="font-bold text-slate-700 mb-6 flex items-center">
                    <Users className="w-5 h-5 mr-2 text-blue-500 dark:text-blue-400" />
                    {tg?.title || 'Gender Distribution'}
                  </h3>
                  <PieChartVisual data={genderDistributionData} tm={tm} />
                  <div className="flex justify-center flex-wrap gap-4 mt-8">
                    {genderDistributionData.map((d, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-center space-x-2 text-[11px] sm:text-xs px-2 py-1 rounded-full border transition-all',
                          d.value > 0
                            ? 'bg-surface border-border-default text-body shadow-sm'
                            : 'bg-page border-border-light text-subtle opacity-60'
                        )}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        <span className="font-bold">{d.label}:</span>
                        <span className="font-medium px-1.5 bg-page rounded-md border border-border-light">
                          {d.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-6 border border-border-default rounded-2xl bg-surface shadow-sm dark:shadow-black/20">
                  <h3 className="font-bold text-slate-700 mb-6 flex items-center">
                    <ClipboardList className="w-5 h-5 mr-2 text-blue-500 dark:text-blue-400" />
                    {t.charts.studentStatus}
                  </h3>
                  <HorizontalBarChart data={studentStatusData} tm={tm} />
                </div>

                {!embedded && (
                  <div className="p-6 border border-border-default rounded-2xl bg-surface shadow-sm dark:shadow-black/20">
                    <h3 className="font-bold text-slate-700 mb-6 flex items-center">
                      <BarChart3 className="w-5 h-5 mr-2 text-blue-500 dark:text-blue-400" />
                      {t.charts.studentsPerClass}
                    </h3>
                    <BarChart data={studentsPerClassData} tm={tm} />
                  </div>
                )}

                <div className="p-6 border border-border-default rounded-2xl bg-surface shadow-sm dark:shadow-black/20">
                  <h3 className="font-bold text-slate-700 mb-6 flex items-center">
                    <GraduationCap className="w-5 h-5 mr-2 text-blue-500 dark:text-blue-400" />
                    {tp?.title || 'Academic Performance'}
                  </h3>
                  <HorizontalBarChart
                    data={academicPerformanceChartData}
                    onItemClick={setSelectedCategory}
                    tm={tm}
                  />
                  <div className="mt-8 pt-6 border-t border-slate-50">
                    <div className="flex items-center justify-between text-xs text-muted mb-4 px-2 italic">
                      <span>{tp?.classification || 'Classification by final score'}</span>
                      <span>
                        {tp?.total || 'Total: '}
                        {academicPerformanceChartData.reduce((acc, curr) => acc + curr.value, 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* GRADE & STAGE DISTRIBUTION CHARTS */}
              <div
                className={cn(
                  'grid gap-6',
                  embedded ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'
                )}
              >
                <div className="p-6 border border-border-default rounded-2xl bg-surface shadow-sm dark:shadow-black/20 hover:shadow-md transition-shadow">
                  <h3 className="font-bold text-slate-700 mb-6 flex items-center">
                    <GraduationCap className="w-5 h-5 mr-2 text-violet-500 dark:text-violet-400" />
                    {translations[language].reports.grade?.stage || 'Stage Distribution'}
                  </h3>
                  <PieChartVisual data={gradeDistData.stageData} tm={tm} />
                  <div className="flex justify-center flex-wrap gap-4 mt-8">
                    {gradeDistData.stageData.map((d, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-center space-x-2 text-[11px] sm:text-xs px-2 py-1 rounded-full border transition-all',
                          d.value > 0
                            ? 'bg-surface border-border-default text-body shadow-sm'
                            : 'bg-page border-border-light text-subtle opacity-60'
                        )}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        <span className="font-bold">{d.label}:</span>
                        <span className="font-medium px-1.5 bg-page rounded-md border border-border-light">
                          {d.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-6 border border-border-default rounded-2xl bg-surface shadow-sm dark:shadow-black/20 hover:shadow-md transition-shadow">
                  <h3 className="font-bold text-slate-700 mb-6 flex items-center">
                    <BarChart3 className="w-5 h-5 mr-2 text-violet-500 dark:text-violet-400" />
                    {translations[language].reports.grade?.title || 'Grade Distribution'}
                  </h3>
                  <BarChart data={gradeDistData.gradeBarData} tm={tm} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ATTENDANCE */}
          {activeTab === 'attendance' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                {!embedded && (
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-muted mb-1 pointer-events-none">
                      {t.filters.selectClass}
                    </label>
                    <select
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                      className="w-full bg-page border border-border-default rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="all">{t.filters.allClasses}</option>
                      {activeClassesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {formatClassNameWithTeacher(c, teachers)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted mb-1 pointer-events-none">
                    {t.filters.selectMonth}
                  </label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full bg-page border border-border-default rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="p-6 border border-border-default rounded-2xl mb-8">
                <h3 className="font-bold text-slate-700 mb-6">{t.charts.attendanceByWeek}</h3>
                <LineChart data={weeklyData} tm={tm} />
              </div>

              <div className="overflow-x-auto rounded-xl border border-border-default">
                <table className="w-full text-left text-sm text-slate-600">
                  <thead className="bg-page border-b border-border-default text-xs uppercase font-medium text-muted">
                    <tr>
                      <th className="px-6 py-4">{t.table.studentName}</th>
                      <th className="px-6 py-4 text-center">{t.table.present}</th>
                      <th className="px-6 py-4 text-center">{t.table.absent}</th>
                      <th className="px-6 py-4 text-center">{t.table.late}</th>
                      <th className="px-6 py-4 text-right">{t.table.rate}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-surface">
                    {attTableData.map((st) => (
                      <tr key={st.id} className="hover:bg-hover/50">
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-body">
                          {st.displayName}
                        </td>
                        <td className="px-6 py-4 text-center">{st.pres}</td>
                        <td className="px-6 py-4 text-center text-red-500 dark:text-red-400">
                          {st.abs}
                        </td>
                        <td className="px-6 py-4 text-center text-amber-500 dark:text-amber-400">
                          {st.late}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span
                            className={`px-2 py-1 space-x-1 rounded-md font-bold text-[11px] ${st.rate < 80 ? 'bg-red-100 text-red-700 dark:text-red-400' : 'bg-green-100 text-green-700 dark:text-green-400'}`}
                          >
                            {st.rate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {attTableData.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-subtle">
                          {t.emptyData}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: ASSIGNMENTS */}
          {activeTab === 'assignments' && (
            <div className="space-y-6">
              {!embedded && (
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-muted mb-1 pointer-events-none">
                      {t.filters.selectClass}
                    </label>
                    <select
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                      className="w-full bg-page border border-border-default rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="all">{t.filters.allClasses}</option>
                      {activeClassesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {formatClassNameWithTeacher(c, teachers)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="md:col-span-2 overflow-auto rounded-xl border border-border-default">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-page border-b border-border-default text-xs uppercase font-medium text-muted">
                      <tr>
                        <th className="px-4 py-3">{t.table.assignmentName}</th>
                        <th className="px-4 py-3 text-center">{t.table.submissions}</th>
                        <th className="px-4 py-3 text-center">{t.table.avgScore}</th>
                        <th className="px-4 py-3 text-center">{t.table.highest}</th>
                        <th className="px-4 py-3 text-center">{t.table.lowest}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-surface">
                      {assTableData.map((a, i) => (
                        <tr key={i} className="hover:bg-hover/50">
                          <td className="px-4 py-3 font-medium text-body" title={a.name}>
                            {a.name.length > 30 ? a.name.substring(0, 30) + '..' : a.name}
                          </td>
                          <td className="px-4 py-3 text-center">{a.subsCount}</td>
                          <td className="px-4 py-3 text-center font-bold text-blue-600 dark:text-blue-400">
                            {a.avg}
                          </td>
                          <td className="px-4 py-3 text-center text-green-600 dark:text-green-400 font-medium">
                            {a.high}
                          </td>
                          <td className="px-4 py-3 text-center text-red-600 font-medium">
                            {a.low}
                          </td>
                        </tr>
                      ))}
                      {assTableData.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-subtle">
                            {t.emptyData}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-6 border border-border-default rounded-2xl flex flex-col">
                  <h3 className="font-bold text-slate-700 mb-2">{t.charts.topStudents}</h3>
                  <HorizontalBarChart
                    data={studentScores.map((s) => ({ ...s, color: '#10b981' }))}
                    tm={t}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: EVALUATIONS */}
          {activeTab === 'evaluations' && (
            <div className="space-y-6">
              <div className="flex gap-4 mb-8">
                <div className="flex-1 max-w-sm">
                  <label className="block text-xs font-medium text-muted mb-1 pointer-events-none">
                    {t.filters.selectStudent}
                  </label>
                  <select
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full bg-page border border-border-default rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="" disabled>
                      {t.filters.selectStudent}
                    </option>
                    {validStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code || s.studentId})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!selectedStudentId || stEvals.length === 0 ? (
                <div className="p-8 text-center text-subtle border border-dashed border-border-default rounded-2xl">
                  {t.emptyData}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-6 border border-border-default rounded-2xl flex flex-col items-center">
                    <h3 className="font-bold text-slate-700 mb-2 self-start">
                      {t.charts.evaluationRadar}
                    </h3>
                    <p className="text-xs text-muted mb-6 self-start">
                      {trd?.desc ||
                        'Evaluated on a 100-point scale based on capability indicators.'}
                    </p>
                    <RadarChart data={radarData} />
                  </div>
                  <div className="p-6 border border-border-default rounded-2xl">
                    <h3 className="font-bold text-slate-700 mb-6">{t.charts.progressOverTime}</h3>
                    <LineChart data={evalProgressData} tm={tm} />
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {selectedCategory && (
          <ModalPortal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="px-6 py-4 border-b border-border-light flex items-center justify-between"
                  style={{ backgroundColor: `${selectedCategory.color}10` }}
                >
                  <div>
                    <h3 className="text-xl font-bold" style={{ color: selectedCategory.color }}>
                      {selectedCategory.label}
                    </h3>
                    <p className="text-sm font-medium text-muted mt-0.5">
                      {selectedCategory.students.length} {tm?.students || 'students'}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className="p-2 hover:bg-black/5 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-muted" />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto flex-1 bg-page">
                  <div className="grid gap-2">
                    {selectedCategory.students.length > 0 ? (
                      selectedCategory.students.map((item, i) => {
                        const student = item.student;
                        const c = classes.find((c) => c.id === student.classId);
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 bg-surface rounded-xl border border-border-default"
                          >
                            <div className="flex flex-col">
                              <span className="font-semibold text-body">{student.name}</span>
                              <span className="text-xs text-muted">
                                {student.code || student.studentId}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-sm">
                                {item.score}
                              </span>
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-border-default">
                                {c?.name || tg?.unknown || 'Unknown'}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-8 text-center text-subtle">
                        {tp?.noStudents || 'No students in this category.'}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}
