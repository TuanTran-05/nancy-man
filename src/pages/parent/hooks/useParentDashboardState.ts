import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  addDays,
  format,
  isAfter,
  isBefore,
  startOfDay,
  startOfWeek,
  endOfWeek,
  subWeeks,
} from 'date-fns';
import { enGB, vi } from 'date-fns/locale';
import { useAuth } from '../../../contexts/AuthContext';
import { useParentDashboardData } from '../../../hooks/useParentDashboardData';
import {
  Attendance,
  Evaluation,
  Notification as AppNotification,
  Submission,
  UserProfile,
} from '../../../types';
import { filterByTerm } from '../../../lib/academic/termUtils';
import { getVNDate } from '../../../lib/core/utils';
import { isStudentFaceStoragePath, resolveStudentFaceUrl } from '../../../lib/student/faceImage';
import { createLocalizer, localize } from '../../../lib/i18n/localize';
import {
  buildRadarComparisonData,
  buildTermTrendData,
  buildTimelineItems,
  formatAverageScore,
  getAverageScore100,
  getLevelLabel,
  getSafeDate,
  getStatusText,
} from '../utils';
import { useParentNotifications } from './useParentNotifications';
import type {
  HeatmapCell,
  WarningAlertItem,
  TeacherCommentItem,
  RecentAssignmentItem,
} from '../types';

export function getDisplayedHomeworkScore(highestGrade: number | null) {
  return typeof highestGrade === 'number' ? highestGrade : null;
}

export function getHomeworkScoreDisplayState(highestGrade: number | null) {
  const score = getDisplayedHomeworkScore(highestGrade);
  return {
    score: score === null ? null : Math.round(score * 10) / 10,
    isGraded: score !== null,
  };
}

export function buildUnavailableComparison(finalScore10: number, attendanceRate: number | null) {
  return {
    scoreStudent: finalScore10 > 0 ? Number(finalScore10.toFixed(1)) : 0,
    scoreClassAverage: null as number | null,
    attendanceStudent: attendanceRate || 0,
    attendanceClassAverage: null as number | null,
    rankLabel: 'Chưa có dữ liệu',
  };
}

export function getEvaluationFinalScore10(evaluation?: Evaluation | null) {
  if (!evaluation) return 0;

  if (typeof evaluation.finalScore === 'number') {
    const clampedFinalScore = Math.min(100, Math.max(0, evaluation.finalScore));
    return clampedFinalScore / 10;
  }

  return (getAverageScore100(evaluation) ?? 0) / 10;
}

export function useParentDashboardState(profile: UserProfile | null, language: 'vi' | 'en') {
  const { setBlockedInfo } = useAuth();
  const locale = localize(language, vi, enGB);
  const tr = useMemo(() => createLocalizer(language), [language]);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'home';
  const [studentFaceUrl, setStudentFaceUrl] = useState('');

  const {
    classData,
    studentData,
    evaluations,
    attendance,
    assignments,
    submissions,
    notifications,
    loading,
  } = useParentDashboardData(profile);

  useEffect(() => {
    let cancelled = false;
    if (!studentData) {
      setStudentFaceUrl('');
      return;
    }
    const direct = studentData.faceImage || '';
    const hasStoragePath = studentData.faceImageStoragePath || isStudentFaceStoragePath(direct);
    if (!hasStoragePath) {
      setStudentFaceUrl(direct);
      return;
    }

    resolveStudentFaceUrl(studentData.id, direct, studentData.faceImageStoragePath)
      .then((url) => {
        if (!cancelled) setStudentFaceUrl(url);
      })
      .catch(() => {
        if (!cancelled) setStudentFaceUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [studentData]);

  const [selectedTerm, setSelectedTerm] = useState('current');
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  const [expandedComments, setExpandedComments] = useState<string[]>([]);
  const [checkedPlanIds, setCheckedPlanIds] = useState<string[]>([]);

  useEffect(() => {
    if (!classData?.terms?.some((term) => term.id === selectedTerm) && selectedTerm !== 'current') {
      setSelectedTerm('current');
    }
  }, [classData, selectedTerm]);

  useEffect(() => {
    if (studentData?.enrollmentStatus !== 'dropped' || !studentData?.statusChangedAt) return;

    const statusChangedAt = new Date(studentData.statusChangedAt);
    const droppedForDays = Math.floor(
      (Date.now() - statusChangedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (droppedForDays > 30) {
      setBlockedInfo({
        email: studentData.name || profile?.displayName || 'Phụ huynh',
        reason: 'dropped_parent',
      });
    }
  }, [studentData, setBlockedInfo, profile?.displayName, language]);

  const handleTabChange = (tab: 'home' | 'progress' | 'homework') => {
    const nextParams = new URLSearchParams(searchParams);
    if (tab === 'home') nextParams.delete('tab');
    else nextParams.set('tab', tab);
    setSearchParams(nextParams);
  };

  const formatDateLabel = (value?: string | number | Date | null, pattern = 'dd/MM/yyyy') => {
    const date = getSafeDate(value);
    if (!date) return '--';
    return format(date, pattern, { locale });
  };

  const sortedEvaluations = useMemo(
    () =>
      [...evaluations].sort((left, right) => {
        const leftDate = getSafeDate(left.date)?.getTime() ?? 0;
        const rightDate = getSafeDate(right.date)?.getTime() ?? 0;
        return rightDate - leftDate;
      }),
    [evaluations]
  );

  const filteredAttendance = useMemo(
    () => filterByTerm(attendance, (item) => item.date, classData, selectedTerm),
    [attendance, classData, selectedTerm]
  );

  const filteredEvaluations = useMemo(
    () =>
      filterByTerm(sortedEvaluations, (item) => item.date, classData, selectedTerm).sort(
        (left, right) => {
          const leftDate = getSafeDate(left.date)?.getTime() ?? 0;
          const rightDate = getSafeDate(right.date)?.getTime() ?? 0;
          return rightDate - leftDate;
        }
      ),
    [sortedEvaluations, classData, selectedTerm]
  );

  const filteredAssignments = useMemo(
    () =>
      filterByTerm(
        assignments,
        (item) => item.createdAt || item.dueDate,
        classData,
        selectedTerm
      ).sort((left, right) => {
        const leftDate = getSafeDate(left.dueDate)?.getTime() ?? 0;
        const rightDate = getSafeDate(right.dueDate)?.getTime() ?? 0;
        return rightDate - leftDate;
      }),
    [assignments, classData, selectedTerm]
  );

  const filteredAssignmentIds = useMemo(
    () => new Set(filteredAssignments.map((assignment) => assignment.id)),
    [filteredAssignments]
  );

  const filteredSubmissions = useMemo(
    () => submissions.filter((submission) => filteredAssignmentIds.has(submission.assignmentId)),
    [submissions, filteredAssignmentIds]
  );

  const latestEval = filteredEvaluations[0] ?? null;
  const previousEval = filteredEvaluations[1] ?? null;
  const previousAverageScore100 = getAverageScore100(previousEval);

  const latestSubmissionByAssignment = useMemo(() => {
    const submissionMap = new Map<string, Submission>();
    filteredSubmissions.forEach((submission) => {
      const existing = submissionMap.get(submission.assignmentId);
      const currentTime = getSafeDate(submission.submittedAt)?.getTime() ?? 0;
      const existingTime = getSafeDate(existing?.submittedAt)?.getTime() ?? 0;
      if (!existing || currentTime > existingTime) {
        submissionMap.set(submission.assignmentId, submission);
      }
    });
    return submissionMap;
  }, [filteredSubmissions]);

  const highestGradedSubmissionByAssignment = useMemo(() => {
    const submissionMap = new Map<string, Submission>();
    filteredSubmissions.forEach((submission) => {
      if (submission.status === 'graded' && typeof submission.grade === 'number') {
        const existing = submissionMap.get(submission.assignmentId);
        if (!existing || submission.grade > (existing.grade ?? -1)) {
          submissionMap.set(submission.assignmentId, submission);
        }
      }
    });
    return submissionMap;
  }, [filteredSubmissions]);

  const averageScore100 = useMemo(() => {
    if (highestGradedSubmissionByAssignment.size > 0) {
      let total = 0;
      highestGradedSubmissionByAssignment.forEach((sub) => {
        total += sub.grade!;
      });
      return (total / highestGradedSubmissionByAssignment.size) * 10;
    }
    return getAverageScore100(latestEval);
  }, [highestGradedSubmissionByAssignment, latestEval]);

  const studentName =
    studentData?.name || profile?.displayName?.replace('Phụ huynh ', '') || 'Học sinh';
  const studentShortName = studentName.split(' ').filter(Boolean).slice(-1)[0] || studentName;
  const className = classData?.name || 'Chưa xếp lớp';
  const levelLabel = getLevelLabel(className, averageScore100);

  const presentCount = filteredAttendance.filter((item) => item.status === 'present').length;
  const lateCount = filteredAttendance.filter((item) => item.status === 'late').length;
  const absentCount = filteredAttendance.filter((item) => item.status === 'absent').length;
  const attendanceRate =
    filteredAttendance.length > 0
      ? Math.round(((presentCount + lateCount) / filteredAttendance.length) * 100)
      : 0;

  const homeworkSubmittedCount = latestSubmissionByAssignment.size;
  const homeworkLateCount = filteredAssignments.filter((assignment) => {
    const submission = latestSubmissionByAssignment.get(assignment.id);
    if (!submission) return false;
    const submittedAt = getSafeDate(submission.submittedAt);
    const dueDate = getSafeDate(assignment.dueDate);
    return Boolean(submittedAt && dueDate && isAfter(submittedAt, dueDate));
  }).length;
  const homeworkMissingCount = Math.max(filteredAssignments.length - homeworkSubmittedCount, 0);

  const scoreTrend =
    averageScore100 !== null && previousAverageScore100 !== null
      ? Number(((averageScore100 - previousAverageScore100) / 10).toFixed(1))
      : null;

  const currentTermStart = classData?.startDate ?? null;
  const currentTermEnd = classData?.endDate ?? null;
  const selectedTermMeta =
    selectedTerm === 'current'
      ? {
          id: 'current',
          name: 'Học kỳ hiện tại',
          startDate: currentTermStart,
          endDate: currentTermEnd,
        }
      : (classData?.terms?.find((term) => term.id === selectedTerm) ?? null);

  const radarData = buildRadarComparisonData(latestEval, previousEval);

  const termTrendData = useMemo(() => {
    return buildTermTrendData(evaluations, classData?.terms ?? [], locale).map((point) => ({
      name: point.label,
      tooltipLabel: point.tooltipLabel ?? point.label,
      score: Number((point.average / 10).toFixed(1)),
      isActual: point.isActual,
    }));
  }, [classData?.terms, evaluations, locale]);

  const homeworkBarData = useMemo(() => {
    const recentAssignments = [...filteredAssignments]
      .sort((left, right) => {
        const leftTime = getSafeDate(left.dueDate)?.getTime() ?? 0;
        const rightTime = getSafeDate(right.dueDate)?.getTime() ?? 0;
        return leftTime - rightTime;
      })
      .slice(-6);

    return recentAssignments.map((assignment, index) => {
      const latestSubmission = latestSubmissionByAssignment.get(assignment.id);
      const gradedAttempts = filteredSubmissions.filter(
        (submission) =>
          submission.assignmentId === assignment.id && typeof submission.grade === 'number'
      );
      const highestGrade = gradedAttempts.length
        ? Math.max(...gradedAttempts.map((submission) => submission.grade ?? 0))
        : null;
      const dueDate = getSafeDate(assignment.dueDate);
      const submittedAt = getSafeDate(latestSubmission?.submittedAt);
      const isLate = Boolean(submittedAt && dueDate && isAfter(submittedAt, dueDate));

      const scoreDisplay = getHomeworkScoreDisplayState(highestGrade);

      return {
        name: assignment.title.length > 14 ? `${assignment.title.slice(0, 14)}…` : assignment.title,
        fullName: assignment.title,
        score: scoreDisplay.score,
        isGraded: scoreDisplay.isGraded,
        status: highestGrade === null ? (latestSubmission ? 'Chưa chấm' : 'Chưa nộp') : 'Đã chấm',
        fill: index % 2 === 0 ? '#60A5FA' : '#4F46E5',
      };
    });
  }, [filteredAssignments, filteredSubmissions, latestSubmissionByAssignment]);

  const donutData = [
    {
      name: 'Đã nộp',
      value: Math.max(homeworkSubmittedCount - homeworkLateCount, 0),
    },
    {
      name: 'Nộp muộn',
      value: homeworkLateCount,
    },
    {
      name: 'Chưa nộp',
      value: homeworkMissingCount,
    },
  ];

  const finalScore10 = getEvaluationFinalScore10(latestEval);

  const comparisonData = buildUnavailableComparison(finalScore10, attendanceRate || null);

  const warningAlerts = useMemo(() => {
    const alerts: WarningAlertItem[] = [];
    if (scoreTrend !== null && scoreTrend < 0) {
      alerts.push({
        id: 'score-trend',
        tone: 'danger',
        title: 'Điểm trung bình giảm sút',
        description: `Điểm trung bình của học sinh đã giảm sút khoảng ${Math.abs(scoreTrend).toFixed(1)} điểm so với kỳ trước.`,
      });
    }

    if (homeworkMissingCount > 0) {
      alerts.push({
        id: 'missing-homework',
        tone: homeworkMissingCount >= 2 ? 'danger' : 'warning',
        title: 'Có bài tập chưa hoàn thành',
        description: `${studentName} hiện đang còn thiếu ${homeworkMissingCount} bài tập chưa nộp.`,
      });
    }

    if (lateCount > 0) {
      alerts.push({
        id: 'late-attendance',
        tone: 'warning',
        title: 'Đi học muộn',
        description: `Học sinh đã đi học muộn ${lateCount} lần trong kỳ này.`,
      });
    }

    return alerts.filter((alert) => !dismissedAlertIds.includes(alert.id));
  }, [dismissedAlertIds, homeworkMissingCount, lateCount, scoreTrend, studentName]);

  const teacherComments = useMemo(() => {
    const comments: TeacherCommentItem[] = [];

    filteredEvaluations.slice(0, 4).forEach((evaluation) => {
      if (evaluation.aiFeedback) {
        comments.push({
          id: `${evaluation.id}-ai`,
          title: 'Nhận xét chung',
          text: evaluation.aiFeedback,
          date: evaluation.date,
        });
      }

      if (evaluation.positivePoints?.length) {
        comments.push({
          id: `${evaluation.id}-positive`,
          title: 'Điểm nổi bật',
          text: evaluation.positivePoints.join(' • '),
          date: evaluation.date,
        });
      }

      if (evaluation.improvementPoints) {
        comments.push({
          id: `${evaluation.id}-improve`,
          title: 'Cần cải thiện',
          text: evaluation.improvementPoints,
          date: evaluation.date,
        });
      }
    });

    return comments.slice(0, 6);
  }, [filteredEvaluations]);

  const actionPlans = useMemo(
    () => [
      {
        id: 'speaking',
        label:
          homeworkMissingCount > 0
            ? 'Hoàn thành các bài tập còn thiếu'
            : 'Luyện nói tiếng Anh 15 phút mỗi ngày',
      },
      {
        id: 'reading',
        label: 'Đọc truyện ngắn tiếng Anh cuối tuần',
      },
      {
        id: 'vocabulary',
        label: 'Ôn tập 10 từ vựng mới mỗi tối',
      },
    ],
    [homeworkMissingCount, lateCount]
  );

  const timelineItems = useMemo(
    () =>
      buildTimelineItems(classData?.terms ?? [], evaluations, {
        currentClass:
          classData && classData.startDate && classData.endDate
            ? {
                id: 'current',
                name: classData.name,
                startDate: classData.startDate,
                endDate: classData.endDate,
              }
            : null,
        selectedTerm,
        formatDateLabel,
      }),
    [classData, evaluations, selectedTerm, formatDateLabel]
  );

  const recentAssignmentItems = useMemo<RecentAssignmentItem[]>(() => {
    return filteredAssignments.slice(0, 6).map((assignment) => {
      const latestSubmission = latestSubmissionByAssignment.get(assignment.id);
      const grade =
        filteredSubmissions
          .filter(
            (submission) =>
              submission.assignmentId === assignment.id && typeof submission.grade === 'number'
          )
          .sort((left, right) => (right.grade ?? 0) - (left.grade ?? 0))[0]?.grade ?? null;
      const dueDate = getSafeDate(assignment.dueDate);
      const submittedAt = getSafeDate(latestSubmission?.submittedAt);
      const isLate = Boolean(dueDate && submittedAt && isAfter(submittedAt, dueDate));
      const isOverdue = Boolean(!latestSubmission && dueDate && isBefore(dueDate, new Date()));

      return {
        id: assignment.id,
        title: assignment.title,
        dueDate: assignment.dueDate,
        statusLabel: latestSubmission
          ? isLate
            ? 'Nộp muộn'
            : 'Đã nộp'
          : isOverdue
            ? 'Quá hạn'
            : 'Chưa nộp',
        statusTone: latestSubmission ? (isLate ? 'orange' : 'green') : 'red',
        gradeLabel: grade === null ? 'Chờ chấm điểm' : `Điểm: ${grade}/10`,
      };
    });
  }, [filteredAssignments, filteredSubmissions, latestSubmissionByAssignment]);

  const attendanceHeatmap = useMemo<HeatmapCell[][]>(() => {
    const scheduleDays = classData?.daysOfWeek ?? [];
    const attendanceMap = new Map<string, Attendance['status']>(
      filteredAttendance.map((item) => {
        const d = getSafeDate(item.date);
        const dateStr = d ? format(d, 'yyyy-MM-dd') : item.date;
        return [dateStr, item.status] as const;
      })
    );

    let termStart = selectedTermMeta?.startDate ? getSafeDate(selectedTermMeta.startDate) : null;
    let termEnd = selectedTermMeta?.endDate ? getSafeDate(selectedTermMeta.endDate) : null;

    if (!termStart || !termEnd) {
      if (filteredAttendance.length > 0) {
        const dates = filteredAttendance
          .map((a) => getSafeDate(a.date)?.getTime() || 0)
          .filter((t) => t > 0);
        termStart = new Date(Math.min(...dates));
        termEnd = new Date(Math.max(...dates));
      } else {
        termStart = subWeeks(new Date(), 12);
        termEnd = new Date();
      }
    }

    const start = startOfWeek(termStart!, { weekStartsOn: 1 });
    const end = endOfWeek(termEnd!, { weekStartsOn: 1 });

    const totalWeeks = Math.max(
      1,
      Math.min(52, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)))
    );

    return Array.from({ length: totalWeeks }, (_, weekIndex) =>
      Array.from({ length: 7 }, (_, dayIndex) => {
        const date = addDays(start, weekIndex * 7 + dayIndex);
        const iso = format(date, 'yyyy-MM-dd');

        const inSelectedWindow =
          selectedTermMeta?.startDate && selectedTermMeta?.endDate
            ? (() => {
                const current = startOfDay(date);
                const startDate = startOfDay(termStart!);
                const endDate = startOfDay(termEnd!);
                return !isBefore(current, startDate) && !isAfter(current, endDate);
              })()
            : true;

        const dayOfWeek = date.getDay();
        const isScheduled = scheduleDays.length > 0 ? scheduleDays.includes(dayOfWeek) : true;
        const hasAttendance = attendanceMap.has(iso);
        const hasClass = (isScheduled || hasAttendance) && inSelectedWindow;

        const status = hasClass ? (attendanceMap.get(iso) ?? 'empty') : 'empty';
        const label = hasClass
          ? getStatusText(status, 'Chưa có dữ liệu', 'Có mặt', 'Đi học muộn', 'Nghỉ học')
          : 'Không có lịch học';

        return {
          date,
          iso,
          status,
          label,
        };
      })
    );
  }, [
    classData?.daysOfWeek,
    filteredAttendance,
    selectedTermMeta?.startDate,
    selectedTermMeta?.endDate,
  ]);

  const heatmapMonths = useMemo(
    () =>
      attendanceHeatmap
        .map((column) => column[0])
        .filter((cell): cell is HeatmapCell => Boolean(cell)),
    [attendanceHeatmap]
  );

  const daysRemainingAfterDrop =
    studentData?.enrollmentStatus === 'dropped' && studentData?.statusChangedAt
      ? Math.max(
          0,
          30 -
            Math.floor(
              (Date.now() - new Date(studentData.statusChangedAt).getTime()) / (1000 * 60 * 60 * 24)
            )
        )
      : null;

  const notifHook = useParentNotifications((notifications || []) as AppNotification[]);
  return {
    classData,
    studentData,
    evaluations,
    attendance,
    assignments,
    submissions,
    notifications,
    loading,
    studentFaceUrl,
    selectedTerm,
    setSelectedTerm,
    dismissedAlertIds,
    setDismissedAlertIds,
    expandedComments,
    setExpandedComments,
    checkedPlanIds,
    setCheckedPlanIds,
    currentTab,
    handleTabChange,
    formatDateLabel,
    sortedEvaluations,
    filteredAttendance,
    filteredEvaluations,
    filteredAssignments,
    filteredAssignmentIds,
    filteredSubmissions,
    latestEval,
    previousEval,
    averageScore100,
    studentName,
    studentShortName,
    className,
    levelLabel,
    presentCount,
    lateCount,
    absentCount,
    attendanceRate,
    homeworkSubmittedCount,
    homeworkLateCount,
    homeworkMissingCount,
    scoreTrend,
    selectedTermMeta,
    radarData,
    termTrendData,
    homeworkBarData,
    donutData,
    comparisonData,
    warningAlerts,
    teacherComments,
    actionPlans,
    timelineItems,
    recentAssignmentItems,
    attendanceHeatmap,
    heatmapMonths,
    daysRemainingAfterDrop,
    notif: notifHook,
  };
}
