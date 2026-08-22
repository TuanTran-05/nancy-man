import type React from 'react';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  Loader2,
  Scan,
  UserCheck,
  Users,
} from 'lucide-react';

import type {
  Attendance,
  Class,
  ClassSessionSummary,
  Evaluation,
  Student,
  StudentClassroomRisk,
} from '../../../../types';
import { apiRequest } from '../../../../lib/api/apiClient';
import { cn, formatVN } from '../../../../lib/core/utils';
import { useLanguage } from '../../../../lib/i18n/useLanguage';

type ActiveTab = 'students' | 'attendance' | 'reports';
type RosterFilter = 'all' | 'unmarked' | 'absent' | 'late' | 'missing_assignment' | 'risk';

type TodayClassControlCenterProps = {
  classData: Class;
  todayStr: string;
  todaySessionSummary: ClassSessionSummary;
  isPaused: boolean;
  isArchived: boolean;
  rosterSearchTerm: string;
  setRosterSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  rosterFilter: RosterFilter;
  setRosterFilter: React.Dispatch<React.SetStateAction<RosterFilter>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ActiveTab>>;
  setIsFaceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openDailyReportModal: (targetDate?: string) => void;
  isTogglingAttendance: boolean;
  actionRosterStudents: Student[];
  todayAttendanceTargetStudents: Student[];
  todayAttendanceMap: Map<string, Attendance>;
  isAttendancePending: (studentId: string, date: string) => boolean;
  getPendingAttendanceStatus: (studentId: string, date: string) => Attendance['status'] | undefined;
  savingAbsencePermissionStudentId: string | null;
  riskByStudent: Map<string, StudentClassroomRisk>;
  evaluations: Evaluation[];
  overdueAssignmentCountByStudent: Map<string, number>;
  highlightMatch: (text: string, highlight: string) => React.ReactNode;
  handleTodayAttendanceStatus: (studentId: string, status: Attendance['status']) => Promise<void>;
  handleMarkAllPresentForToday: (studentIds: string[]) => Promise<void>;
  onMarkAllPresentError?: (error: unknown) => void;
  handleToggleAbsencePermission: (studentId: string) => Promise<void>;
  openTodayAttendanceDetail: (studentId: string) => void;
  confirmingDeleteAttendanceId: string | null;
  setConfirmingDeleteAttendanceId: React.Dispatch<React.SetStateAction<string | null>>;
  deletingAttendanceRecordId: string | null;
  setDeletingAttendanceRecordId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function TodayClassControlCenter({
  classData,
  todayStr,
  todaySessionSummary,
  isPaused,
  isArchived,
  rosterSearchTerm,
  setRosterSearchTerm,
  rosterFilter,
  setRosterFilter,
  setActiveTab,
  setIsFaceModalOpen,
  openDailyReportModal,
  isTogglingAttendance,
  actionRosterStudents,
  todayAttendanceTargetStudents,
  todayAttendanceMap,
  isAttendancePending,
  getPendingAttendanceStatus,
  savingAbsencePermissionStudentId,
  riskByStudent,
  evaluations,
  overdueAssignmentCountByStudent,
  highlightMatch,
  handleTodayAttendanceStatus,
  handleMarkAllPresentForToday,
  onMarkAllPresentError,
  handleToggleAbsencePermission,
  openTodayAttendanceDetail,
  confirmingDeleteAttendanceId,
  setConfirmingDeleteAttendanceId,
  deletingAttendanceRecordId,
  setDeletingAttendanceRecordId,
}: TodayClassControlCenterProps) {
  const { t } = useLanguage();
  const markAllPresentStudentIds = todayAttendanceTargetStudents
    .filter((student) => student.enrollmentStatus !== 'on_leave')
    .filter((student) => todayAttendanceMap.get(student.id)?.status !== 'present')
    .map((student) => student.id);
  const isMarkAllPresentDisabled =
    isPaused || isArchived || isTogglingAttendance || markAllPresentStudentIds.length === 0;

  return (
    <div className="space-y-5">
      <div className="sticky top-4 z-20 rounded-3xl border border-border-default bg-surface/95 p-5 shadow-xl shadow-slate-200/70 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 dark:bg-blue-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                {t.todayClassControlCenter.classControlCenter}
              </span>
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-bold',
                  todaySessionSummary.completionState === 'completed' &&
                    'bg-emerald-100 text-emerald-700 dark:text-emerald-400',
                  todaySessionSummary.completionState === 'attendance_done' &&
                    'bg-blue-100 text-blue-700',
                  todaySessionSummary.completionState === 'pending_attendance' &&
                    'bg-amber-100 text-amber-700'
                )}
              >
                {todaySessionSummary.completionState === 'completed'
                  ? t.todayClassControlCenter.sessionCompleted
                  : todaySessionSummary.completionState === 'attendance_done'
                    ? t.todayClassControlCenter.attendanceDone
                    : t.todayClassControlCenter.attendancePending}
              </span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-heading">
                {t.todayClassControlCenter.todaySession} • {formatVN(todayStr, 'dd/MM/yyyy')}
              </h2>
              <p className="text-sm text-slate-500">
                {classData.startTime ? `${classData.startTime} • ` : ''}
                {todaySessionSummary.pendingAttendanceCount}{' '}
                {t.todayClassControlCenter.needsAttendance} •{' '}
                {todaySessionSummary.absentCount + todaySessionSummary.lateCount}{' '}
                {t.todayClassControlCenter.absentLate} • {todaySessionSummary.riskStudentCount}{' '}
                {t.todayClassControlCenter.needsAttention}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:flex">
            <button
              onClick={() => setActiveTab('attendance')}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border-default bg-surface px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-hover"
            >
              <UserCheck className="w-4 h-4" />
              {t.todayClassControlCenter.openAttendance}
            </button>
            <button
              onClick={() =>
                void Promise.resolve(handleMarkAllPresentForToday(markAllPresentStudentIds)).catch(
                  onMarkAllPresentError
                )
              }
              disabled={isMarkAllPresentDisabled}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition',
                isMarkAllPresentDisabled
                  ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              {t.todayClassControlCenter.markAllPresent}
            </button>
            <button
              onClick={() => setIsFaceModalOpen(true)}
              disabled={isPaused || isArchived}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition',
                isPaused || isArchived
                  ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              )}
            >
              <Scan className="w-4 h-4" />
              {t.todayClassControlCenter.faceAttendance}
            </button>
            <button
              onClick={() => openDailyReportModal(todayStr)}
              disabled={isArchived}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition',
                isArchived
                  ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                  : 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              <ClipboardCheck className="w-4 h-4" />
              {t.todayClassControlCenter.dailyReport}
            </button>
          </div>
        </div>
      </div>

      <section className="rounded-3xl border border-border-default bg-surface p-5 shadow-sm dark:shadow-black/20">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-slate-400">
              {t.todayClassControlCenter.todayOverview}
            </p>
            <h3 className="text-xl font-bold text-heading">
              {t.todayClassControlCenter.controlCenterDesc}
            </h3>
          </div>
          <div className="relative w-full max-w-md">
            <Filter className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-400" />
            <input
              value={rosterSearchTerm}
              onChange={(event) => setRosterSearchTerm(event.target.value)}
              placeholder={t.todayClassControlCenter.searchPlaceholder}
              className="w-full rounded-2xl border border-border-default bg-page py-3 pl-10 pr-4 text-sm outline-none transition focus:border-blue-300"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              key: 'unmarked' as const,
              label: t.todayClassControlCenter.unmarked,
              value: todaySessionSummary.pendingAttendanceCount,
              tone: 'amber',
            },
            {
              key: 'absent' as const,
              label: t.todayClassControlCenter.absentLateLabel,
              value: todaySessionSummary.absentCount + todaySessionSummary.lateCount,
              tone: 'rose',
            },
            {
              key: 'missing_assignment' as const,
              label: t.todayClassControlCenter.overdueAssignment,
              value: todaySessionSummary.overdueAssignmentStudentCount,
              tone: 'blue',
            },
            {
              key: 'risk' as const,
              label: t.todayClassControlCenter.riskLabel,
              value: todaySessionSummary.riskStudentCount,
              tone: 'violet',
            },
          ].map((card) => (
            <button
              key={card.key}
              onClick={() => setRosterFilter((prev) => (prev === card.key ? 'all' : card.key))}
              className={cn(
                'rounded-2xl border px-4 py-4 text-left transition',
                rosterFilter === card.key
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-border-default bg-page hover:bg-surface'
              )}
            >
              <p className="text-sm font-medium opacity-80">{card.label}</p>
              <p className="mt-2 text-3xl font-bold">{card.value}</p>
              <p className="mt-2 text-xs font-medium opacity-70">
                {rosterFilter === card.key
                  ? t.todayClassControlCenter.filtering
                  : t.todayClassControlCenter.clickToFilter}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ['all', t.todayClassControlCenter.all],
            ['unmarked', t.todayClassControlCenter.unmarked],
            ['absent', t.todayClassControlCenter.absent],
            ['late', t.todayClassControlCenter.late],
            ['missing_assignment', t.todayClassControlCenter.overdueAssignment],
            ['risk', t.todayClassControlCenter.risk],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRosterFilter(value as typeof rosterFilter)}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-semibold transition',
                rosterFilter === value
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {label}
            </button>
          ))}
          {isTogglingAttendance && (
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.todayClassControlCenter.savingAttendance}
            </div>
          )}
        </div>

        <div className="mt-5 space-y-3">
          {actionRosterStudents.length > 0 ? (
            actionRosterStudents.map((student) => {
              const todayAttendance = todayAttendanceMap.get(student.id);
              const isSavingTodayAttendance = isAttendancePending(student.id, todayStr);
              const pendingTodayAttendanceStatus = getPendingAttendanceStatus(student.id, todayStr);
              const isSavingAbsencePermission = savingAbsencePermissionStudentId === student.id;
              const risk = riskByStudent.get(student.id);
              const latestEval = evaluations
                .filter((evaluation) => evaluation.studentId === student.id)
                .sort(
                  (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()
                )[0];
              const overdueCount = overdueAssignmentCountByStudent.get(student.id) || 0;

              return (
                <div
                  key={student.id}
                  aria-busy={isSavingTodayAttendance}
                  className={cn(
                    'rounded-3xl border border-border-default bg-surface p-4 shadow-sm dark:shadow-black/20 transition hover:border-slate-300',
                    isSavingTodayAttendance && 'border-blue-200 bg-blue-50/40'
                  )}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-lg font-bold text-blue-600">
                        {student.name[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-lg font-bold text-heading">
                            {highlightMatch(student.name, rosterSearchTerm)}
                          </h4>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            {highlightMatch(student.studentId, rosterSearchTerm)}
                          </span>
                          {student.enrollmentStatus === 'on_leave' && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              {t.todayClassControlCenter.onLeave}
                            </span>
                          )}
                          {todayAttendance?.status === 'present' && (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              {t.todayClassControlCenter.present}
                            </span>
                          )}
                          {todayAttendance?.status === 'late' && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              {t.todayClassControlCenter.lateLabel}
                            </span>
                          )}
                          {todayAttendance?.status === 'absent' && (
                            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                              {todayAttendance.permission
                                ? t.todayClassControlCenter.absentWithPermission
                                : t.todayClassControlCenter.absentWithoutPermission}
                            </span>
                          )}
                          {!todayAttendance && student.enrollmentStatus !== 'on_leave' && (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                              {t.todayClassControlCenter.notMarked}
                            </span>
                          )}
                          {isSavingTodayAttendance && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t.todayClassControlCenter.saving}
                            </span>
                          )}
                          {overdueCount > 0 && (
                            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              {t.classDetail.overdueCount.replace('{count}', String(overdueCount))}
                            </span>
                          )}
                          {risk?.level !== 'low' && (
                            <span
                              className={cn(
                                'rounded-full px-2.5 py-1 text-xs font-semibold',
                                risk?.level === 'high' && 'bg-rose-100 text-rose-700',
                                risk?.level === 'medium' && 'bg-amber-100 text-amber-700'
                              )}
                            >
                              {risk?.level === 'high'
                                ? t.todayClassControlCenter.highRisk
                                : t.todayClassControlCenter.mediumRisk}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                          {risk?.reasons?.slice(0, 2).map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                            >
                              {reason}
                            </span>
                          ))}
                          {latestEval && (
                            <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              {t.todayClassControlCenter.latestScore}{' '}
                              {typeof latestEval.finalScore === 'number'
                                ? latestEval.finalScore
                                : latestEval.totalScore}
                            </span>
                          )}
                        </div>

                        <p className="line-clamp-2 text-sm text-slate-500">
                          {latestEval?.positivePoints?.[0] ||
                            latestEval?.improvementPoints ||
                            t.todayClassControlCenter.noRecentComment}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {!todayAttendance && (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-3 w-full sm:w-auto">
                          <button
                            onClick={() => void handleTodayAttendanceStatus(student.id, 'present')}
                            disabled={
                              isPaused ||
                              isArchived ||
                              student.enrollmentStatus === 'on_leave' ||
                              isTogglingAttendance
                            }
                            className="inline-flex min-w-[88px] items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSavingTodayAttendance &&
                            pendingTodayAttendanceStatus === 'present' ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t.todayClassControlCenter.saving}
                              </>
                            ) : (
                              t.todayClassControlCenter.present
                            )}
                          </button>
                          <button
                            onClick={() => void handleTodayAttendanceStatus(student.id, 'late')}
                            disabled={
                              isPaused ||
                              isArchived ||
                              student.enrollmentStatus === 'on_leave' ||
                              isTogglingAttendance
                            }
                            className="inline-flex min-w-[88px] items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSavingTodayAttendance && pendingTodayAttendanceStatus === 'late' ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t.todayClassControlCenter.saving}
                              </>
                            ) : (
                              t.todayClassControlCenter.late
                            )}
                          </button>
                          <button
                            onClick={() => void handleTodayAttendanceStatus(student.id, 'absent')}
                            disabled={
                              isPaused ||
                              isArchived ||
                              student.enrollmentStatus === 'on_leave' ||
                              isTogglingAttendance
                            }
                            className="inline-flex min-w-[88px] items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSavingTodayAttendance &&
                            pendingTodayAttendanceStatus === 'absent' ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t.todayClassControlCenter.saving}
                              </>
                            ) : (
                              t.todayClassControlCenter.absent
                            )}
                          </button>
                        </div>
                      )}
                      {isSavingTodayAttendance && todayAttendance && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="inline-flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t.todayClassControlCenter.saving}
                        </div>
                      )}
                      {todayAttendance?.status === 'absent' && (
                        <button
                          onClick={() => void handleToggleAbsencePermission(student.id)}
                          disabled={
                            isPaused ||
                            isArchived ||
                            isSavingTodayAttendance ||
                            isSavingAbsencePermission
                          }
                          className={cn(
                            'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50',
                            todayAttendance.permission
                              ? 'bg-slate-900 text-white hover:bg-slate-800'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          )}
                        >
                          {isSavingAbsencePermission && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          {isSavingAbsencePermission
                            ? t.todayClassControlCenter.saving
                            : todayAttendance.permission
                              ? t.todayClassControlCenter.absentWithPermission
                              : t.todayClassControlCenter.absentWithoutPermission}
                        </button>
                      )}
                      <button
                        onClick={() => openTodayAttendanceDetail(student.id)}
                        disabled={isSavingTodayAttendance}
                        className="rounded-2xl border border-border-default bg-surface px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t.todayClassControlCenter.detail}
                      </button>
                      {todayAttendance && (
                        <div className="relative">
                          {confirmingDeleteAttendanceId === todayAttendance.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={async () => {
                                  if (deletingAttendanceRecordId) return;
                                  const attendanceId = todayAttendance.id;
                                  setDeletingAttendanceRecordId(attendanceId);
                                  try {
                                    await apiRequest('/api/v1/attendance/delete-record', {
                                      method: 'DELETE',
                                      body: { id: attendanceId },
                                    });
                                    toast.success(t.todayClassControlCenter.attendanceDeleted);
                                    setConfirmingDeleteAttendanceId(null);
                                  } catch (error: any) {
                                    console.error('Error deleting attendance:', error);
                                    if (error.code === 'permission-denied') {
                                      toast.error(t.todayClassControlCenter.permissionDenied);
                                    } else {
                                      toast.error(t.todayClassControlCenter.attendanceDeleteError);
                                    }
                                    setConfirmingDeleteAttendanceId(null);
                                  } finally {
                                    setDeletingAttendanceRecordId(null);
                                  }
                                }}
                                disabled={deletingAttendanceRecordId === todayAttendance.id}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deletingAttendanceRecordId === todayAttendance.id && (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                )}
                                {deletingAttendanceRecordId === todayAttendance.id
                                  ? t.todayClassControlCenter.deleting
                                  : t.todayClassControlCenter.confirm}
                              </button>
                              <button
                                onClick={() => setConfirmingDeleteAttendanceId(null)}
                                disabled={deletingAttendanceRecordId === todayAttendance.id}
                                className="rounded-2xl border border-border-default bg-surface px-2 py-3 text-sm font-bold text-slate-500 transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {t.todayClassControlCenter.cancel}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmingDeleteAttendanceId(todayAttendance.id)}
                              disabled={isPaused || isArchived || isSavingTodayAttendance}
                              className={cn(
                                'rounded-2xl border border-border-default bg-page px-4 py-3 text-sm font-bold transition',
                                isPaused || isArchived || isSavingTodayAttendance
                                  ? 'opacity-50 cursor-not-allowed text-slate-400'
                                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                              )}
                            >
                              {t.todayClassControlCenter.reGrade}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-3xl border border-dashed border-border-default bg-page px-6 py-12 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-lg font-bold text-slate-700">
                {t.todayClassControlCenter.noMatchingStudents}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {t.todayClassControlCenter.tryDifferentFilter}
              </p>
            </div>
          )}
        </div>

        {todaySessionSummary.completionState !== 'completed' && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">{t.todayClassControlCenter.sessionStatus}</p>
              <p>
                {todaySessionSummary.completionState === 'pending_attendance'
                  ? t.todayClassControlCenter.pendingAttendanceMsg.replace(
                      '{count}',
                      String(todaySessionSummary.pendingAttendanceCount)
                    )
                  : t.todayClassControlCenter.attendanceDoneMsg}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
