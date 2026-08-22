import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useParams, useNavigate } from 'react-router';
import { auth } from '../../lib/auth/sessionAuth';
import { Attendance, SubstituteRequest, UserProfile, Student } from '../../types';
import { ClassAttendanceStudentQuickProfile } from './classDetail/components/ClassAttendanceStudentQuickProfile';
import { AttendanceEligibilityOverrideModal } from '../../components/classDetail/AttendanceEligibilityOverrideModal';
import {
  buildStudentEligibilityResolvers,
  type AttendanceTermScope,
} from '../../lib/attendance/classAttendanceEligibility';
import type { SessionEligibility } from '../../../shared/studentSessionEligibility';
import { AlertCircle } from 'lucide-react';
import { getVNDate, getVNTodayStr, toTime, toVNDateStr } from '../../lib/core/utils';
import { EvaluationModal } from '../../components/classDetail/EvaluationModal';
import { EvalSelectModal } from '../../components/classDetail/EvalSelectModal';
import { DailyReportModal } from '../../components/classDetail/DailyReportModal';
import { AttendanceDetailModal } from '../../components/classDetail/AttendanceDetailModal';
import { NotifyAbsenceModal } from '../../components/classDetail/NotifyAbsenceModal';
import { filterByTerm } from '../../lib/academic/termUtils';
import { useClassData } from '../../hooks/useClassData';
import { useAttendanceManager } from '../../hooks/useAttendanceManager';
import { QuickNotifyModal } from '../../components/classDetail/QuickNotifyModal';
import { SubstituteClassBanner } from '../../components/classDetail/SubstituteClassBanner';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { useZaloNotifications } from '../../hooks/useZaloNotifications';
import { ZaloConfirmDialog } from '../../components/classDetail/ZaloConfirmDialog';
import { ZaloEvalConfirmDialog } from '../../components/classDetail/ZaloEvalConfirmDialog';
import { ResetCourseModal } from '../../components/classDetail/ResetCourseModal';
import { DailyReportPDFTemplate } from '../../components/classDetail/DailyReportPDFTemplate';
import { exportAttendanceReport } from '../../lib/exports/exportAttendancePDF';
import { selectEnrolledStudentRows } from '../../lib/student/currentRecords';
import { getEffectiveClassDates as getEffectiveClassDatesExtracted } from '../../lib/classes/classDates';
import { apiRequest } from '../../lib/api/apiClient';
import { ClassHeaderWithStudentCreate } from './classDetail/components/ClassHeaderWithStudentCreate';
import { ClassStatusBanners } from './classDetail/components/ClassStatusBanners';
import { TodayClassControlCenter } from './classDetail/components/TodayClassControlCenter';
import { ClassDetailTabs } from './classDetail/components/ClassDetailTabs';
import { ClassHolidays } from '../../components/classDetail/ClassHolidays';
import { TrialReviewPanel } from '../../components/classDetail/TrialReviewPanel';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { canUseAcademicRecords } from '../../lib/auth/roleCapabilities';
import { readChannel } from '../../lib/api/readApi';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../../lib/api/frontendReadApi';

// Extracted hooks
import { useEvaluationModal } from './hooks/useEvaluationModal';
import { useDailyReport } from './hooks/useDailyReport';
import { useStudentActionRoster } from './hooks/useStudentActionRoster';
import { useTodaySessionSummary } from './hooks/useTodaySessionSummary';
import { useClassDetailMisc } from './hooks/useClassDetailMisc';
import { useCourseClosing } from './hooks/useCourseClosing';

const FaceAttendanceModal = React.lazy(() =>
  import('../../components/classDetail/FaceAttendanceModal').then((module) => ({
    default: module.FaceAttendanceModal,
  }))
);

export function showAttendanceBulkSkippedToast(
  skipped: { not_enrolled?: string[]; on_leave?: string[] } | null | undefined,
  messageTemplate: string,
  notify: (message: string, options?: { icon?: string }) => unknown = toast
) {
  const totalSkipped = (skipped?.not_enrolled?.length || 0) + (skipped?.on_leave?.length || 0);
  if (totalSkipped === 0) return;
  notify(messageTemplate.replace('{count}', String(totalSkipped)), { icon: 'ℹ️' });
}

export function selectClassDetailRosterStudents(
  students: Student[],
  classId: string,
  isArchived: boolean,
  isPaused: boolean
): Student[] {
  const scopedStudents = students.filter((student) => student.classId === classId);
  const enrollmentBacked = scopedStudents.filter(
    (student) => student.attendanceEnrollment?.classId === classId
  );
  const legacyFallback = scopedStudents.filter((student) => !student.attendanceEnrollment);
  const visibleLegacy =
    isArchived || isPaused
      ? legacyFallback.filter((student) => student.enrollmentStatus !== 'dropped')
      : selectEnrolledStudentRows(legacyFallback);

  return [...enrollmentBacked, ...visibleLegacy].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

export default function ClassDetail({ profile }: { profile: UserProfile | null }) {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = translations[language].classDetail;
  const tCommon = translations[language].common;
  const tPDF = translations[language].attendancePDF;
  const isOffice = profile?.role === 'office';
  const todayStr = React.useMemo(() => getVNTodayStr(), []);
  const now = Date.now();
  const dailyReportPdfRef = useRef<HTMLDivElement>(null);
  const [selectedAttendanceStudent, setSelectedAttendanceStudent] = useState<Student | null>(null);

  // ─── Substitute request (needed before useClassData) ───
  const [isSubstituteForThisClass, setIsSubstituteForThisClass] = useState(false);
  const [todaySubstituteRequest, setTodaySubstituteRequest] = useState<SubstituteRequest | null>(
    null
  );

  useEffect(() => {
    if (!classId || !profile?.uid || isOffice) return;
    let cancelled = false;
    const loadSubstituteRequest = async () => {
      try {
        const data = await readChannel<{ requests: SubstituteRequest[] }>('substitute-requests', {
          classId,
          date: todayStr,
          status: 'accepted',
        });
        if (cancelled) return;
        const ownRequest = (data.requests || []).find(
          (request) => request.substituteTeacherId === profile.uid
        );
        setTodaySubstituteRequest(ownRequest || null);
        setIsSubstituteForThisClass(Boolean(ownRequest));
      } catch (error) {
        if (!cancelled) console.error('Error loading substitute request through read API:', error);
      }
    };
    void loadSubstituteRequest();
    const interval = window.setInterval(
      () => void loadSubstituteRequest(),
      FRONTEND_READ_POLL_INTERVAL_MS
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [classId, profile?.uid, isOffice, todayStr]);

  // ─── Core data ───
  const {
    classData,
    students,
    attendanceStudents,
    evaluations,
    assignments,
    submissions,
    dailyReports,
    classSessions,
    holidays,
    loading,
    error,
    setClassData,
    setDailyReports,
    refreshStudents,
    refreshAttendanceStudents,
  } = useClassData(classId, profile, isSubstituteForThisClass);

  const isPaused = classData?.status === 'paused';
  const isArchived = classData?.status === 'archived';
  const courseClosing = useCourseClosing(classId);

  const classroomStudents = useMemo(() => {
    return selectClassDetailRosterStudents(students, classId || '', isArchived, isPaused);
  }, [students, classId, isArchived, isPaused]);

  // ─── Zalo OA notifications ───
  const [notifyAbsenceDate, setNotifyAbsenceDate] = useState<string | null>(null);
  const {
    zaloConfirmData,
    setZaloConfirmData,
    zaloEvalConfirmData,
    setZaloEvalConfirmData,
    isSendingZalo,
    zaloAbsenceCounts,
    handleAbsentMarked,
    handleZaloConfirm,
    handleSendZaloEvaluation,
    handleSendZaloFromCard,
    handleZaloEvalConfirm,
  } = useZaloNotifications({
    classId,
    classData,
    profile,
    students: classroomStudents,
    notifyAbsenceDate,
  });

  // ─── Attendance manager ───
  const {
    attendanceData,
    isToggling: isTogglingAttendance,
    isAttendancePending,
    getPendingAttendanceStatus,
    toggleAttendance: handleAttendanceToggle,
    bulkSetAttendance,
    setAttendanceReadRange,
    isAttendanceRangeLoading,
  } = useAttendanceManager(classId, profile, handleAbsentMarked);

  const attendanceTargetStudents = useMemo(
    () =>
      classroomStudents.filter(
        (student) =>
          (student.attendanceEnrollment?.status ?? student.enrollmentStatus) !== 'on_leave'
      ),
    [classroomStudents]
  );

  const todayAttendanceMap = useMemo(
    () =>
      new Map(
        attendanceData
          .filter((attendance) => attendance.date === todayStr)
          .map((attendance) => [attendance.studentId, attendance] as const)
      ),
    [attendanceData, todayStr]
  );

  // ─── Assignment/submission data ───
  const overdueAssignments = useMemo(
    () =>
      assignments
        .filter(
          (assignment) =>
            assignment.classId === classData?.id &&
            (assignment.createdAt ? toTime(assignment.createdAt) <= now : true)
        )
        .sort((a, b) => {
          const timeA = toTime(a.createdAt);
          const timeB = toTime(b.createdAt);
          return timeB - timeA;
        }),
    [assignments, classData?.id, now]
  );

  const latestSubmissionByAssignmentStudent = useMemo(() => {
    const map = new Map<string, string>();
    submissions.forEach((submission) => {
      const key = `${submission.assignmentId}_${submission.studentId}`;
      const current = map.get(key);
      if (!current || new Date(submission.submittedAt).getTime() > new Date(current).getTime()) {
        map.set(key, submission.submittedAt);
      }
    });
    return map;
  }, [submissions]);

  const { overdueAssignmentCountByStudent, missingAssignmentsByStudent } = useMemo(() => {
    const countMap = new Map<string, number>();
    const namesMap = new Map<string, string[]>();
    for (const student of classroomStudents) {
      const missing: string[] = [];
      for (const assignment of overdueAssignments) {
        const key = `${assignment.id}_${student.id}`;
        if (!latestSubmissionByAssignmentStudent.has(key)) {
          missing.push(assignment.title);
        }
      }
      namesMap.set(student.id, missing);
      countMap.set(student.id, missing.length);
    }
    return { overdueAssignmentCountByStudent: countMap, missingAssignmentsByStudent: namesMap };
  }, [classroomStudents, overdueAssignments, latestSubmissionByAssignmentStudent]);

  const fourteenDaysAgo = new Date(getVNDate());
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDayStr = toVNDateStr(fourteenDaysAgo);

  // ─── Misc hook (holidays, online, course period, reset, attendance detail, UI state) ───
  const misc = useClassDetailMisc({
    classId,
    classData,
    setClassData,
    profile,
    todayStr,
    todayAttendanceMap,
    isAttendancePending,
    onCourseClosingRefresh: courseClosing.refresh,
    t,
  });

  // ─── Attendance Term Scope & Eligibility ───
  const attendanceTermScope = useMemo<AttendanceTermScope | null>(() => {
    if (!classData) return null;
    const termStart = misc.coursePeriod.start || classData.startDate;
    const termEnd = misc.coursePeriod.end || classData.endDate || null;
    return termStart ? { classId: classData.id, termStart, termEnd } : null;
  }, [classData, misc.coursePeriod.end, misc.coursePeriod.start]);

  useEffect(() => {
    if (!attendanceTermScope) return;
    void refreshAttendanceStudents({ attendanceTermStart: attendanceTermScope.termStart });
    setAttendanceReadRange({
      from: attendanceTermScope.termStart,
      to: attendanceTermScope.termEnd || todayStr,
    });
  }, [attendanceTermScope, refreshAttendanceStudents, setAttendanceReadRange, todayStr]);

  const todayTermScope = useMemo<AttendanceTermScope | null>(() => {
    if (!classData || !classData.startDate) return null;
    return {
      classId: classData.id,
      termStart: classData.startDate,
      termEnd: classData.endDate || null,
    };
  }, [classData]);

  const todayEligibilityResolvers = useMemo(() => {
    if (!todayTermScope) return new Map();
    return buildStudentEligibilityResolvers(classroomStudents, todayTermScope);
  }, [classroomStudents, todayTermScope]);

  // ─── Override Modal State & Handlers ───
  const [overrideModalState, setOverrideModalState] = useState<{
    isOpen: boolean;
    studentId: string;
    studentName: string;
    date: string;
    eligibility: SessionEligibility;
    isSubmitting: boolean;
    error: string | null;
  }>({
    isOpen: false,
    studentId: '',
    studentName: '',
    date: '',
    eligibility: 'not_enrolled',
    isSubmitting: false,
    error: null,
  });

  const handleAttendanceOverrideRequested = useCallback(
    (studentId: string, date: string, eligibility: SessionEligibility) => {
      const student = (attendanceStudents || classroomStudents).find((s) => s.id === studentId);
      setOverrideModalState({
        isOpen: true,
        studentId,
        studentName: student?.name || studentId,
        date,
        eligibility,
        isSubmitting: false,
        error: null,
      });
    },
    [attendanceStudents, classroomStudents]
  );

  const handleConfirmOverride = useCallback(
    async (input: { status: Attendance['status']; reason: string }) => {
      setOverrideModalState((curr) => ({ ...curr, isSubmitting: true, error: null }));
      try {
        await handleAttendanceToggle(
          overrideModalState.studentId,
          overrideModalState.date,
          input.status,
          {
            eligibilityOverride: true,
            overrideReason: input.reason,
          }
        );
        setOverrideModalState((curr) => ({ ...curr, isOpen: false, isSubmitting: false }));
      } catch (err: any) {
        setOverrideModalState((curr) => ({
          ...curr,
          isSubmitting: false,
          error: err?.message || t.classAttendanceTab.overrideFailed,
        }));
        throw err;
      }
    },
    [handleAttendanceToggle, overrideModalState.studentId, overrideModalState.date, t]
  );

  const handleSafeAttendanceToggle = useCallback(
    async (studentId: string, date: string, explicitStatus?: Attendance['status']) => {
      try {
        await handleAttendanceToggle(studentId, date, explicitStatus);
      } catch (err: any) {
        if (err?.status === 409 || err?.errorCode === 'attendance_ineligible') {
          toast.error(t.classDetail.attendanceIneligibleConflict);
          void refreshStudents();
          if (attendanceTermScope) {
            void refreshAttendanceStudents({
              attendanceTermStart: attendanceTermScope.termStart,
            });
          }
          return;
        }
        throw err;
      }
    },
    [handleAttendanceToggle, refreshStudents, refreshAttendanceStudents, attendanceTermScope, t]
  );

  const handleMarkAllPresent = useCallback(
    async (date: string, studentIds: string[]) => {
      try {
        const result = await bulkSetAttendance(studentIds, date, 'present');
        showAttendanceBulkSkippedToast(result?.skipped, t.classDetail.attendanceBulkSkipped);
      } catch (err) {
        console.error('Bulk attendance failed:', err);
        toast.error(t.classDetail.attendanceBulkUpdateError);
      }
    },
    [bulkSetAttendance, t]
  );

  const currentClassEvaluations = useMemo(
    () => (classData ? filterByTerm(evaluations, (ev) => ev.date, classData, 'current') : []),
    [classData, evaluations]
  );

  // ─── Student Action Roster ───
  const roster = useStudentActionRoster({
    classroomStudents,
    attendanceData,
    fourteenDayStr,
    todayStr,
    overdueAssignmentCountByStudent,
    evaluations: currentClassEvaluations,
    todayAttendanceMap,
    classData,
    t,
  });

  // ─── Today Session Summary ───
  const { isTodayClassDay, hasMultipleAttendanceToday, todaySessionSummary } =
    useTodaySessionSummary({
      todayStr,
      classData,
      attendanceData,
      attendanceTargetStudents,
      todayAttendanceMap,
      riskByStudent: roster.riskByStudent,
      overdueAssignmentCountByStudent,
      classroomStudents,
      dailyReports,
      t,
      eligibilityByStudent: todayEligibilityResolvers,
    });

  // ─── Term/Report data ───
  const matchedTerm = classData?.terms?.find(
    (term: any) => term.startDate === (misc.coursePeriod.start || classData?.startDate)
  );
  const selectedTermId = matchedTerm ? matchedTerm.id : 'current';

  const filteredClassEvaluations = classData
    ? filterByTerm(evaluations, (ev) => ev.date, classData, selectedTermId)
    : [];

  const reportData = useMemo(
    () =>
      classroomStudents
        .map((student) => {
          const studentEvals = filteredClassEvaluations.filter((ev) => ev.studentId === student.id);
          const midtermEval = studentEvals.find((ev) => ev.evaluationType === 'midterm');
          const finalEval = studentEvals.find((ev) => ev.evaluationType === 'final');

          let mEval = midtermEval;
          let fEval = finalEval;

          if (!midtermEval && !finalEval && studentEvals.length > 0) {
            const sorted = [...studentEvals].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
            if (sorted.length >= 2) {
              mEval = sorted[0];
              fEval = sorted[sorted.length - 1];
            } else {
              fEval = sorted[0];
            }
          }

          return { student, midtermEvaluation: mEval, finalEvaluation: fEval };
        })
        .sort((a, b) => a.student.name.localeCompare(b.student.name)),
    [classroomStudents, filteredClassEvaluations]
  );

  // ─── Evaluation Modal ───
  const evalModal = useEvaluationModal({
    classId,
    classData,
    coursePeriod: misc.coursePeriod,
    evaluations,
    attendanceData,
    assignments,
    submissions,
    filteredClassEvaluations,
    handleSendZaloEvaluation,
    t,
  });

  // ─── Daily Report ───
  const dailyReport = useDailyReport({
    classId,
    dailyReports,
    todaySessionSummary,
    setDailyReports,
    dailyReportPdfRef,
    setIsExporting: misc.setIsExporting,
    classData,
    t,
    attendanceData,
    classroomStudents,
  });

  // ─── Computed helpers ───
  const classDaysOfWeek = useMemo(() => classData?.daysOfWeek || [], [classData?.daysOfWeek]);
  const resetCourseHolidays = useMemo(
    () => [...new Set([...(classData?.holidays || []), ...misc.systemHolidays])],
    [classData?.holidays, misc.systemHolidays]
  );

  const getEffectiveClassDates = () => {
    return getEffectiveClassDatesExtracted(
      classData,
      misc.coursePeriod,
      holidays,
      attendanceData,
      classSessions
    );
  };

  const getClassDatesForMonth = () => {
    const allDates = getEffectiveClassDates();
    return allDates.filter(
      (d) =>
        d.getMonth() === misc.selectedMonth.getMonth() &&
        d.getFullYear() === misc.selectedMonth.getFullYear()
    );
  };

  const handleDeleteDates = async (dates: string[]) => {
    if (!classData || dates.length === 0) return;

    const confirmDelete = window.confirm(
      t.deleteDataConfirm.replace('{count}', String(dates.length))
    );
    if (!confirmDelete) return;

    const toastId = toast.loading(t.deletingData.replace('{count}', String(dates.length)));
    if (import.meta.env.DEV) console.log('Starting deletion for dates:', dates);

    try {
      const result = await apiRequest<{ deletedCount: number }>('/api/v1/attendance/delete-dates', {
        method: 'POST',
        body: { classId: classData.id, dates },
      });

      if (import.meta.env.DEV) console.log(`Deleted ${result.deletedCount} records.`);
      const count = result.deletedCount;

      if (result.deletedCount > 0) {
        toast.success(t.deleteDataSuccess.replace('{count}', String(count)), { id: toastId });
      } else {
        toast.error(t.deleteDataNotFound, { id: toastId });
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error(t.deleteDataError + (error instanceof Error ? error.message : String(error)), {
        id: toastId,
      });
    }
  };

  const handleExportAttendanceReport = async () => {
    if (misc.isExporting || isAttendanceRangeLoading) return;
    misc.setIsExporting(true);
    try {
      const effectiveDates = getEffectiveClassDates().map(toVNDateStr);
      await exportAttendanceReport(
        classData,
        misc.coursePeriod,
        holidays,
        attendanceStudents || classroomStudents,
        attendanceData,
        tPDF,
        auth.currentUser?.displayName,
        effectiveDates
      );
    } finally {
      misc.setIsExporting(false);
    }
  };

  const exportWord = async () => {
    if (!classData || reportData.length === 0) return;
    misc.setIsExporting(true);

    try {
      const { exportClassReportWord } = await import('../../lib/exports/exportWord');
      await exportClassReportWord(classData, misc.coursePeriod, reportData);
    } catch (error) {
      console.error('Error generating Word document:', error);
    } finally {
      misc.setIsExporting(false);
    }
  };

  const handleTodayAttendanceStatus = async (
    studentId: string,
    status: 'present' | 'absent' | 'late'
  ) => {
    await handleAttendanceToggle(studentId, todayStr, status);
  };

  const handleMarkAllPresentForToday = React.useCallback(
    (studentIds: string[]) => handleMarkAllPresent(todayStr, studentIds),
    [handleMarkAllPresent, todayStr]
  );

  const handleMarkAllPresentError = React.useCallback(
    (error: unknown) => {
      console.error('Bulk attendance update failed:', error);
      toast.error(t.attendanceBulkUpdateError);
    },
    [t.attendanceBulkUpdateError]
  );

  const highlightMatch = (text: string, highlight: string) => {
    if (!highlight.trim()) return <>{text}</>;

    const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'));

    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} className="bg-yellow-200 text-heading rounded-sm px-[1px]">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  // ─── Derived flags ───
  const isAdmin = profile?.role === 'admin';
  const canManageClassHolidays =
    profile?.role === 'admin' ||
    profile?.role === 'office' ||
    (profile?.role === 'teacher' && classData?.teacherId === profile.uid && !isArchived);

  const isExpired = (() => {
    if (!classData) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(classData.endDate);
    end.setHours(0, 0, 0, 0);
    return today > end;
  })();

  // ─── Early returns ───
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-slate-600 font-medium">{error}</p>
        <button
          onClick={() => navigate('/classes')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
        >
          {t.backToClasses}
        </button>
      </div>
    );
  }

  if (loading || !classData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Render ───
  return (
    <div className="space-y-6">
      <ClassStatusBanners
        isArchived={isArchived}
        isPaused={isPaused}
        isExpired={isExpired}
        isAdmin={isAdmin || isOffice}
        onStartNewCourse={() => {
          misc.setResetDates({ startDate: '', endDate: '' });
          misc.setIsResetModalOpen(true);
        }}
      />

      {/* Substitute Teaching Banner */}
      {todaySubstituteRequest && (
        <SubstituteClassBanner
          request={todaySubstituteRequest}
          onGoToAttendance={() => misc.setActiveTab('attendance')}
        />
      )}

      <ClassHeaderWithStudentCreate
        classData={classData}
        studentCount={classroomStudents.length}
        isOnline={misc.isOnline}
        isAdmin={isAdmin}
        canManageClass={isAdmin || isOffice}
        canUseTeachingTools={profile?.role === 'teacher'}
        canAddStudent={canUseAcademicRecords(profile?.role)}
        isArchived={isArchived}
        isPaused={isPaused}
        todayStr={todayStr}
        onStudentsChanged={refreshStudents}
        onOpenResetCourse={() => {
          misc.setResetDates({ startDate: classData.startDate, endDate: classData.endDate });
          misc.setIsResetModalOpen(true);
        }}
        onOpenFaceAttendance={() => misc.setIsFaceModalOpen(true)}
        onOpenDailyReport={dailyReport.openDailyReportModal}
      />

      {!isOffice && (isTodayClassDay || hasMultipleAttendanceToday) && (
        <TodayClassControlCenter
          classData={classData}
          todayStr={todayStr}
          todaySessionSummary={todaySessionSummary}
          isPaused={isPaused}
          isArchived={isArchived}
          rosterSearchTerm={roster.rosterSearchTerm}
          setRosterSearchTerm={roster.setRosterSearchTerm}
          rosterFilter={roster.rosterFilter}
          setRosterFilter={roster.setRosterFilter}
          setActiveTab={misc.setActiveTab}
          setIsFaceModalOpen={misc.setIsFaceModalOpen}
          openDailyReportModal={dailyReport.openDailyReportModal}
          isTogglingAttendance={isTogglingAttendance}
          actionRosterStudents={roster.actionRosterStudents}
          todayAttendanceTargetStudents={attendanceTargetStudents}
          todayAttendanceMap={todayAttendanceMap}
          isAttendancePending={isAttendancePending}
          getPendingAttendanceStatus={getPendingAttendanceStatus}
          savingAbsencePermissionStudentId={misc.savingAbsencePermissionStudentId}
          riskByStudent={roster.riskByStudent}
          evaluations={currentClassEvaluations}
          overdueAssignmentCountByStudent={overdueAssignmentCountByStudent}
          highlightMatch={highlightMatch}
          handleTodayAttendanceStatus={handleTodayAttendanceStatus}
          handleMarkAllPresentForToday={handleMarkAllPresentForToday}
          onMarkAllPresentError={handleMarkAllPresentError}
          handleToggleAbsencePermission={misc.handleToggleAbsencePermission}
          openTodayAttendanceDetail={misc.openTodayAttendanceDetail}
          confirmingDeleteAttendanceId={misc.confirmingDeleteAttendanceId}
          setConfirmingDeleteAttendanceId={misc.setConfirmingDeleteAttendanceId}
          deletingAttendanceRecordId={misc.deletingAttendanceRecordId}
          setDeletingAttendanceRecordId={misc.setDeletingAttendanceRecordId}
        />
      )}

      {canManageClassHolidays && (
        <ClassHolidays
          classId={classData.id}
          holidays={classData.holidays || []}
          daysOfWeek={classDaysOfWeek}
          onHolidaysUpdated={misc.handleHolidaysUpdated}
        />
      )}

      <TrialReviewPanel
        profile={profile}
        students={classroomStudents}
        attendance={attendanceData}
      />

      <ClassDetailTabs
        activeTab={misc.activeTab}
        setActiveTab={misc.setActiveTab}
        profile={profile}
        classData={classData}
        courseClosing={courseClosing}
        coursePeriod={misc.coursePeriod}
        setCoursePeriod={misc.setCoursePeriod}
        selectedMonth={misc.selectedMonth}
        setSelectedMonth={misc.setSelectedMonth}
        exportWord={exportWord}
        isExporting={misc.isExporting}
        reportDataLength={reportData.length}
        students={classroomStudents}
        searchTerm={roster.searchTerm}
        setSearchTerm={roster.setSearchTerm}
        filteredClassEvaluations={filteredClassEvaluations}
        handleEditEval={evalModal.handleEditEval}
        handleDeleteEval={evalModal.handleDeleteEval}
        handleOpenEvalSelect={evalModal.handleOpenEvalSelect}
        isArchived={isArchived}
        isPaused={isPaused}
        handleSendZaloFromCard={handleSendZaloFromCard}
        isSendingZalo={isSendingZalo}
        attendanceData={attendanceData}
        classDates={getClassDatesForMonth()}
        handleAttendanceToggle={handleSafeAttendanceToggle}
        handleMarkAllPresent={handleMarkAllPresent}
        handleMarkAllPresentError={handleMarkAllPresentError}
        setSelectedAttendanceForDetail={misc.setSelectedAttendanceForDetail}
        setNotifyAbsenceDate={setNotifyAbsenceDate}
        exportAttendanceReport={handleExportAttendanceReport}
        handleDeleteDates={handleDeleteDates}
        classSessions={classSessions}
        handleConfirmSession={misc.handleConfirmSession}
        isTogglingAttendance={isTogglingAttendance}
        isAttendancePending={isAttendancePending}
        confirmingSessionDate={misc.confirmingSessionDate}
        onOpenAttendanceStudent={setSelectedAttendanceStudent}
        selectedAttendanceStudentId={selectedAttendanceStudent?.id || null}
        onSelectedAttendanceStudentHidden={() => setSelectedAttendanceStudent(null)}
        attendanceStudents={attendanceStudents}
        termScope={attendanceTermScope}
        onAttendanceOverrideRequested={handleAttendanceOverrideRequested}
      />

      <AttendanceEligibilityOverrideModal
        isOpen={overrideModalState.isOpen}
        studentName={overrideModalState.studentName}
        date={overrideModalState.date}
        eligibility={overrideModalState.eligibility}
        isSubmitting={overrideModalState.isSubmitting}
        submitError={overrideModalState.error}
        onClose={() => setOverrideModalState((curr) => ({ ...curr, isOpen: false }))}
        onConfirm={handleConfirmOverride}
      />

      {selectedAttendanceStudent && (
        <ClassAttendanceStudentQuickProfile
          key={selectedAttendanceStudent.id}
          profile={profile}
          classData={classData}
          student={selectedAttendanceStudent}
          isArchived={isArchived}
          isPaused={isPaused}
          refreshStudents={refreshStudents}
          onClose={() => setSelectedAttendanceStudent(null)}
        />
      )}

      {/* Attendance Detail Modal */}
      <AttendanceDetailModal
        isOpen={!!misc.selectedAttendanceForDetail}
        onClose={() => misc.setSelectedAttendanceForDetail(null)}
        attendance={misc.selectedAttendanceForDetail}
        student={classroomStudents.find(
          (s) => s.id === misc.selectedAttendanceForDetail?.studentId
        )}
        onUpdate={misc.handleUpdateAttendanceDetail}
        setAttendance={misc.setSelectedAttendanceForDetail}
        isSaving={misc.isSavingAttendanceDetail}
      />

      {/* Face Attendance Modal */}
      {misc.isFaceModalOpen && (
        <React.Suspense fallback={null}>
          <FaceAttendanceModal
            isOpen={misc.isFaceModalOpen}
            onClose={() => misc.setIsFaceModalOpen(false)}
            classData={classData}
            students={classroomStudents}
            onAttendanceMarked={handleAttendanceToggle}
          />
        </React.Suspense>
      )}

      {/* Notify Absence Modal */}
      <NotifyAbsenceModal
        isOpen={!!notifyAbsenceDate}
        onClose={() => setNotifyAbsenceDate(null)}
        date={notifyAbsenceDate}
        students={classroomStudents}
        classData={classData}
        attendanceData={attendanceData}
        handleSendNotification={roster.handleSendNotification}
        sendingNotificationId={roster.sendingNotificationId}
        zaloAbsenceCounts={zaloAbsenceCounts}
        onSendZalo={async (studentId) => {
          const student = classroomStudents.find((s) => s.id === studentId);
          if (!student || !classData || !profile) return;
          setZaloConfirmData({ studentId, date: notifyAbsenceDate || '', classId: classData.id });
        }}
      />

      <ZaloConfirmDialog
        zaloConfirmData={zaloConfirmData}
        students={classroomStudents}
        className={classData?.name}
        isSendingZalo={isSendingZalo}
        onClose={() => setZaloConfirmData(null)}
        onConfirm={handleZaloConfirm}
      />

      <ZaloEvalConfirmDialog
        zaloEvalConfirmData={zaloEvalConfirmData}
        className={classData?.name}
        courseEndDate={classData?.endDate}
        isSendingZalo={isSendingZalo}
        onClose={() => setZaloEvalConfirmData(null)}
        onConfirm={handleZaloEvalConfirm}
      />

      {/* Evaluation Modal */}
      <EvaluationModal
        isOpen={evalModal.isEvalModalOpen}
        onClose={() => evalModal.setIsEvalModalOpen(false)}
        student={evalModal.selectedStudentForEval}
        classData={classData}
        editingEvalId={evalModal.editingEvalId}
        formData={evalModal.evalFormData}
        setFormData={evalModal.setEvalFormData}
        onSubmit={evalModal.handleEvalSubmit}
        isSaving={evalModal.isSavingEval}
        onGenerateAIFeedback={evalModal.handleGenerateAIFeedback}
        isGeneratingAI={evalModal.isGeneratingAI}
        onSendZaloEvaluation={evalModal.handleSendZaloEvaluationAndSave}
        isSendingZalo={isSendingZalo}
        hideTypeSelector={evalModal.hideTypeSelector}
      />

      {/* Eval Select Modal */}
      <EvalSelectModal
        isOpen={evalModal.isEvalSelectOpen}
        onClose={() => evalModal.setIsEvalSelectOpen(false)}
        student={evalModal.selectedStudentForSelect}
        midtermEval={evalModal.selectMidtermEval}
        finalEval={evalModal.selectFinalEval}
        onSelect={evalModal.handleSelectEvalType}
      />

      <QuickNotifyModal
        isOpen={roster.isQuickNotifyModalOpen}
        onClose={() => roster.setIsQuickNotifyModalOpen(false)}
        classData={classData}
        students={classroomStudents}
        defaultStudentIds={roster.notifyStudentIds}
        defaultTemplateKey={roster.defaultNotifyTemplate}
        contextDate={todayStr}
        isSending={!!roster.sendingNotificationId}
        onSend={({ studentId, title, message, type, templateKey, contextDate }) =>
          roster.handleSendNotification(studentId, title, message, type, templateKey, contextDate)
        }
        studentMissingAssignments={missingAssignmentsByStudent}
      />

      <ConfirmModal
        isOpen={!!evalModal.evalToDelete}
        onClose={() => evalModal.setEvalToDelete(null)}
        onConfirm={evalModal.confirmDeleteEval}
        title={t.deleteEvalTitle}
        message={t.deleteEvalConfirm}
        confirmText={tCommon.delete}
        isLoading={evalModal.isDeletingEval}
      />

      {/* Daily Report Modal */}
      <DailyReportModal
        isOpen={dailyReport.isDailyReportModalOpen}
        onClose={() => dailyReport.setIsDailyReportModalOpen(false)}
        classData={classData}
        dailyReports={dailyReports}
        formData={dailyReport.dailyReportFormData}
        setFormData={dailyReport.setDailyReportFormData}
        onSubmit={dailyReport.handleSaveDailyReport}
        onExport={dailyReport.handleExportDailyReportPDF}
        isSaving={dailyReport.isSavingReport}
        isExporting={misc.isExporting}
        pendingAttendanceCount={todaySessionSummary.pendingAttendanceCount}
        completionState={todaySessionSummary.completionState}
      />

      <DailyReportPDFTemplate
        dailyReportPdfRef={dailyReportPdfRef}
        classData={classData}
        students={classroomStudents}
        attendanceData={attendanceData}
        dailyReportFormData={dailyReport.dailyReportFormData}
      />
      <ResetCourseModal
        isOpen={misc.isResetModalOpen}
        onClose={() => misc.setIsResetModalOpen(false)}
        className={classData.name}
        grade={classData.grade}
        daysOfWeek={classDaysOfWeek}
        holidays={resetCourseHolidays}
        outgoingEndDate={classData.endDate}
        resetDates={misc.resetDates}
        onResetDatesChange={misc.setResetDates}
        isResettingClass={misc.isResettingClass}
        onSubmit={misc.handleResetClass}
        courseClosing={courseClosing.snapshot}
        resetError={misc.resetError}
      />
    </div>
  );
}
