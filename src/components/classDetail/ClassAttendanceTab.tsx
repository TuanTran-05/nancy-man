import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MessageSquare,
  CheckCircle2,
  X,
  Clock,
  Lock,
  Edit2,
  Trash2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Student, Attendance, ClassSession } from '../../types';
import { formatVN, cn, toVNDateStr, getDayFromStr } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { deriveStudentLifecycle } from '../../../shared/studentLifecycle';
import { selectEnrolledStudentRows } from '../../lib/student/currentRecords';
import {
  buildAttendanceIndex,
  buildStudentEligibilityResolvers,
  resolveClassAttendanceCell,
  attendanceCellKey,
  type AttendanceTermScope,
} from '../../lib/attendance/classAttendanceEligibility';
import type { SessionEligibility } from '../../../shared/studentSessionEligibility';

interface ClassAttendanceTabProps {
  selectedMonth: Date;
  setSelectedMonth: (date: Date) => void;
  attendanceData: Attendance[];
  students: Student[];
  classDates: Date[];
  onAttendanceToggle: (studentId: string, date: string) => void;
  onOpenDetail: (attendance: Attendance) => void;
  onNotifyAbsence: (date: string) => void;
  onExportReport: () => void;
  onMarkAllPresent?: (date: string, studentIds: string[]) => void | Promise<void>;
  onMarkAllPresentError?: (error: unknown) => void;
  onDeleteDates?: (dates: string[]) => void | Promise<void>;
  daysOfWeek?: number[];
  classSessions?: ClassSession[];
  onConfirmSession?: (date: string, status: 'taught' | 'cancelled' | 'makeup') => void;
  isArchived?: boolean;
  isPaused?: boolean;
  isAttendanceWritePending?: boolean;
  isAttendancePending?: (studentId: string, date: string) => boolean;
  confirmingSessionDate?: string | null;
  isExportingReport?: boolean;
  onOpenStudent: (student: Student) => void;
  selectedStudentId?: string | null;
  onSelectedStudentHidden?: () => void;
  termScope?: AttendanceTermScope | null;
  onAttendanceOverrideRequested?: (
    studentId: string,
    date: string,
    eligibility: SessionEligibility
  ) => void;
}

export const ClassAttendanceTab: React.FC<ClassAttendanceTabProps> = ({
  selectedMonth,
  setSelectedMonth,
  attendanceData,
  students,
  classDates,
  onAttendanceToggle,
  onOpenDetail,
  onNotifyAbsence,
  onExportReport,
  onMarkAllPresent,
  onMarkAllPresentError,
  onDeleteDates,
  daysOfWeek = [],
  classSessions = [],
  onConfirmSession,
  isArchived,
  isPaused,
  isAttendanceWritePending = false,
  isAttendancePending,
  confirmingSessionDate,
  isExportingReport = false,
  onOpenStudent,
  selectedStudentId,
  onSelectedStudentHidden,
  termScope,
  onAttendanceOverrideRequested,
}) => {
  const { t } = useLanguage();
  const [showOnLeave, setShowOnLeave] = React.useState(false);

  const attendanceByCell = React.useMemo(
    () => buildAttendanceIndex(attendanceData),
    [attendanceData]
  );

  const fallbackTermScope = React.useMemo<AttendanceTermScope>(
    () =>
      termScope || {
        classId: students[0]?.classId || '',
        termStart: '2000-01-01',
        termEnd: null,
      },
    [termScope, students]
  );

  const eligibilityByStudent = React.useMemo(
    () => buildStudentEligibilityResolvers(students, fallbackTermScope),
    [students, fallbackTermScope]
  );

  // Helper to resolve session status for a date
  const getSessionStatus = (dateStr: string): 'taught' | 'cancelled' | 'makeup' | null => {
    const session = classSessions.find((s) => s.date === dateStr);
    return session ? (session.status as 'taught' | 'cancelled' | 'makeup') : null;
  };

  // Archived/paused classes are read-only history, so keep every historical student visible.
  const rosterStudents = React.useMemo(
    () =>
      isArchived || isPaused || students.some((student) => student.attendanceEnrollment)
        ? students
        : selectEnrolledStudentRows(students),
    [isArchived, isPaused, students]
  );

  const displayStudents = React.useMemo(
    () =>
      rosterStudents.filter((s) => {
        if (isArchived || isPaused) return true;
        if (s.attendanceEnrollment) {
          return s.attendanceEnrollment.status !== 'on_leave' || showOnLeave;
        }
        const lifecycle = deriveStudentLifecycle(s);
        if (lifecycle === 'archived') return false;
        if (s.enrollmentStatus === 'dropped' || s.enrollmentStatus === 'promoted') return false;
        if (s.enrollmentStatus === 'on_leave' && !showOnLeave) return false;
        return true;
      }),
    [isArchived, isPaused, rosterStudents, showOnLeave]
  );

  const visibleStudentIds = React.useMemo(
    () => new Set(displayStudents.map((student) => student.id)),
    [displayStudents]
  );
  const previousSelectionRef = React.useRef<{ id: string | null; visible: boolean }>({
    id: null,
    visible: false,
  });

  React.useEffect(() => {
    if (!selectedStudentId) {
      previousSelectionRef.current = { id: null, visible: false };
      return;
    }
    const isVisible = visibleStudentIds.has(selectedStudentId);
    const previous = previousSelectionRef.current;
    if (previous.id === selectedStudentId && previous.visible && !isVisible) {
      onSelectedStudentHidden?.();
    }
    previousSelectionRef.current = { id: selectedStudentId, visible: isVisible };
  }, [onSelectedStudentHidden, selectedStudentId, visibleStudentIds]);

  const [selectedDates, setSelectedDates] = React.useState<string[]>([]);
  const [isDeletingSelectedDates, setIsDeletingSelectedDates] = React.useState(false);

  const toggleDateSelection = (dateStr: string) => {
    setSelectedDates((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]
    );
  };

  const handleDeleteSelected = async () => {
    if (isDeletingSelectedDates) return;
    if (import.meta.env.DEV)
      console.log('ClassAttendanceTab - Attempting delete for:', selectedDates);
    if (selectedDates.length === 0 || !onDeleteDates) {
      console.warn('ClassAttendanceTab - No dates selected or onDeleteDates prop missing');
      return;
    }
    setIsDeletingSelectedDates(true);
    try {
      await onDeleteDates(selectedDates);
      setSelectedDates([]);
    } finally {
      setIsDeletingSelectedDates(false);
    }
  };

  const getMarkAllPresentStudentIds = (dateStr: string) =>
    displayStudents
      .filter((student) => {
        const attendance = attendanceByCell.get(attendanceCellKey(student.id, dateStr));
        if (attendance?.status === 'present') return false;
        if (attendance?.status === 'absent' || attendance?.status === 'late') return true;
        return (
          (eligibilityByStudent.get(student.id)?.(dateStr, fallbackTermScope.classId) ??
            'eligible') === 'eligible'
        );
      })
      .map((student) => student.id);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 gap-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() =>
              setSelectedMonth(
                new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1)
              )
            }
            className="p-2 hover:bg-white rounded-lg transition-colors border border-slate-100 shadow-sm"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="font-bold text-slate-900 min-w-[150px] text-center">
            {formatVN(selectedMonth, 'MMMM yyyy')}
          </h3>
          <button
            onClick={() =>
              setSelectedMonth(
                new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1)
              )
            }
            className="p-2 hover:bg-white rounded-lg transition-colors border border-slate-100 shadow-sm"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnLeave}
              onChange={(e) => setShowOnLeave(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-600 font-medium">
              {t.classAttendanceTab.showOnLeave}
            </span>
          </label>
          <div className="flex items-center space-x-4 text-xs font-bold uppercase tracking-wider">
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 bg-emerald-500 rounded-full" />
              <span className="text-emerald-600">{t.classAttendanceTab.present}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 bg-red-500 rounded-full" />
              <span className="text-red-600">{t.classAttendanceTab.absentFull}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 bg-amber-500 rounded-full" />
              <span className="text-amber-600">{t.classAttendanceTab.lateFull}</span>
            </div>
          </div>
          {selectedDates.length > 0 && onDeleteDates && (
            <button
              onClick={handleDeleteSelected}
              disabled={isDeletingSelectedDates}
              className="px-4 py-2 bg-red-50 text-red-600 text-sm font-bold rounded-lg hover:bg-red-100 transition-colors border border-red-200 flex items-center space-x-2 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeletingSelectedDates ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              <span>
                {isDeletingSelectedDates
                  ? t.classAttendanceTab.deleting
                  : t.classAttendanceTab.deleteDays.replace(
                      '{count}',
                      String(selectedDates.length)
                    )}
              </span>
            </button>
          )}
          <button
            onClick={onExportReport}
            disabled={isExportingReport}
            aria-busy={isExportingReport}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm flex items-center space-x-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExportingReport ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{isExportingReport ? 'Exporting...' : t.classAttendanceTab.exportReport}</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="sticky left-0 z-10 bg-white p-4 text-left text-xs font-bold text-slate-400 uppercase border-b border-r border-slate-100 min-w-[200px]">
                {t.classAttendanceTab.studentName}
              </th>
              {classDates.map((date) => {
                const dateStr = toVNDateStr(date);
                const todayStr = toVNDateStr(new Date());
                const isSelected = selectedDates.includes(dateStr);
                const isOutOfSchedule = !daysOfWeek.includes(getDayFromStr(dateStr));
                const isToday = dateStr === todayStr;
                const isFuture = dateStr > todayStr;
                const markAllPresentStudentIds = getMarkAllPresentStudentIds(dateStr);

                return (
                  <th
                    key={date.toISOString()}
                    className={cn(
                      'p-3 text-center text-xs font-bold uppercase border-b border-slate-100 min-w-[112px] transition-colors relative group cursor-pointer select-none',
                      isSelected
                        ? 'bg-red-50/50'
                        : isOutOfSchedule
                          ? 'bg-amber-50/20'
                          : 'text-slate-400 hover:bg-slate-100'
                    )}
                    onClick={() => toggleDateSelection(dateStr)}
                  >
                    <div className="flex flex-col items-center gap-1 pointer-events-none">
                      <div
                        className={cn(
                          'absolute top-2 right-2 w-4 h-4 rounded border transition-all flex items-center justify-center',
                          isSelected
                            ? 'bg-red-500 border-red-500 text-white'
                            : 'bg-white border-slate-100 text-transparent group-hover:border-red-400'
                        )}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                      </div>

                      <div className={cn(isOutOfSchedule ? 'text-amber-600' : 'text-slate-400')}>
                        {formatVN(date, 'EEE')}
                      </div>
                      <div
                        className={cn(
                          'text-sm font-bold mt-0.5',
                          isToday
                            ? 'text-blue-600'
                            : isOutOfSchedule
                              ? 'text-amber-700'
                              : 'text-slate-900'
                        )}
                      >
                        {date.getDate()}
                      </div>
                    </div>

                    {/* Session Status */}
                    <div className="mt-2 mb-2">
                      {(() => {
                        const session = classSessions.find((s) => s.date === dateStr);
                        if (session) {
                          if (session.status === 'taught')
                            return (
                              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                                {t.classAttendanceTab.taught}
                              </span>
                            );
                          if (session.status === 'cancelled')
                            return (
                              <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                {t.classAttendanceTab.absent}
                              </span>
                            );
                          if (session.status === 'makeup')
                            return (
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                {t.classAttendanceTab.makeup}
                              </span>
                            );
                        }
                        return <span className="text-[10px] text-slate-300">-</span>;
                      })()}
                    </div>

                    {!isFuture && !isArchived && !isPaused && (
                      <div className="mt-2 flex flex-col items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onNotifyAbsence(dateStr);
                          }}
                          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title={t.classAttendanceTab.notifyAbsence}
                        >
                          <MessageSquare className="w-4 h-4 mx-auto" />
                        </button>
                        {onMarkAllPresent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (markAllPresentStudentIds.length === 0) return;
                              void Promise.resolve(
                                onMarkAllPresent(dateStr, markAllPresentStudentIds)
                              ).catch(onMarkAllPresentError);
                            }}
                            disabled={
                              isAttendanceWritePending || markAllPresentStudentIds.length === 0
                            }
                            className={cn(
                              'inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold normal-case transition disabled:cursor-not-allowed disabled:opacity-50',
                              markAllPresentStudentIds.length === 0
                                ? 'bg-slate-100 text-slate-400'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            )}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>{t.classAttendanceTab.markAllPresent}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}
              {classDates.length === 0 && (
                <th className="p-8 text-center text-slate-400 italic font-medium">
                  {t.classAttendanceTab.noSessions}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {displayStudents.map((student) => (
              <tr
                key={student.id}
                className={cn(
                  'hover:bg-slate-50/50 transition-colors',
                  (student.enrollmentStatus === 'on_leave' || isArchived) && 'opacity-50'
                )}
              >
                <td className="sticky left-0 z-10 bg-white p-4 font-bold text-slate-900 border-b border-r border-slate-100">
                  <button
                    type="button"
                    onClick={() => onOpenStudent(student)}
                    aria-label={t.classAttendanceTab.quickProfile.openProfileFor.replace(
                      '{name}',
                      student.name
                    )}
                    className="text-left font-bold text-slate-900 underline decoration-transparent underline-offset-4 transition-colors hover:text-blue-600 hover:decoration-blue-300 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {student.name}
                  </button>
                  {student.enrollmentStatus === 'on_leave' && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                      {t.classAttendanceTab.onLeave}
                    </span>
                  )}
                </td>
                {classDates.map((date) => {
                  const dateStr = toVNDateStr(date);
                  const attendance = attendanceByCell.get(attendanceCellKey(student.id, dateStr));
                  const eligibility =
                    eligibilityByStudent.get(student.id)?.(dateStr, fallbackTermScope.classId) ??
                    'eligible';
                  const cellStatus = resolveClassAttendanceCell({
                    studentId: student.id,
                    date: dateStr,
                    classId: fallbackTermScope.classId,
                    attendanceByCell,
                    eligibilityByStudent,
                  });

                  const todayStr = toVNDateStr(new Date());
                  const isFuture = dateStr > todayStr;
                  const isIneligibleEmpty = !attendance && eligibility !== 'eligible';
                  const isLocked = isFuture || isArchived || isPaused || isIneligibleEmpty;
                  const isHistoricalReadOnly = Boolean((isArchived || isPaused) && attendance);
                  const isSavingAttendance = isAttendancePending?.(student.id, dateStr) ?? false;

                  const statusText =
                    cellStatus === 'present'
                      ? t.classAttendanceTab.present
                      : cellStatus === 'absent'
                        ? t.classAttendanceTab.absentFull
                        : cellStatus === 'late'
                          ? t.classAttendanceTab.lateFull
                          : cellStatus === 'not_enrolled'
                            ? t.classAttendanceTab.notEnrolled
                            : cellStatus === 'on_leave'
                              ? t.classAttendanceTab.onLeave
                              : t.classAttendanceTab.unmarked;

                  const cellAriaLabel = `${student.name} - ${formatVN(date, 'dd/MM/yyyy')} - ${statusText}`;
                  const overrideAriaLabel = `${t.classAttendanceTab.attendanceOverride} - ${student.name} - ${formatVN(date, 'dd/MM/yyyy')}`;

                  return (
                    <td key={dateStr} className="p-2 border-b border-slate-100 text-center">
                      <div className="relative group/cell">
                        <button
                          type="button"
                          onClick={() =>
                            !isLocked &&
                            !isAttendanceWritePending &&
                            onAttendanceToggle(student.id, dateStr)
                          }
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (attendance && !isArchived) onOpenDetail(attendance);
                          }}
                          disabled={isLocked || isAttendanceWritePending}
                          aria-busy={isSavingAttendance}
                          aria-label={cellAriaLabel}
                          className={cn(
                            'w-10 h-10 rounded-xl flex items-center justify-center transition-all mx-auto border-2',
                            !attendance &&
                              eligibility === 'eligible' &&
                              'bg-white border-slate-100 text-slate-300 hover:border-blue-200',
                            isIneligibleEmpty &&
                              'bg-slate-50 border-slate-100 text-slate-300 opacity-40',
                            attendance?.status === 'present' &&
                              'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-100',
                            attendance?.status === 'absent' &&
                              'bg-red-500 border-red-500 text-white shadow-lg shadow-red-100',
                            attendance?.status === 'late' &&
                              'bg-amber-500 border-amber-500 text-white shadow-lg shadow-amber-100',
                            isSavingAttendance &&
                              'bg-blue-50 border-blue-300 text-blue-600 shadow-lg shadow-blue-100',
                            isLocked &&
                              !isIneligibleEmpty &&
                              (isHistoricalReadOnly
                                ? 'cursor-not-allowed'
                                : 'opacity-20 cursor-not-allowed grayscale border-slate-50'),
                            isAttendanceWritePending &&
                              !isSavingAttendance &&
                              'cursor-not-allowed opacity-40'
                          )}
                        >
                          {isSavingAttendance ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <>
                              {attendance?.status === 'present' && (
                                <CheckCircle2 className="w-5 h-5" />
                              )}
                              {attendance?.status === 'absent' && <X className="w-5 h-5" />}
                              {attendance?.status === 'late' && <Clock className="w-5 h-5" />}
                              {!attendance && !isFuture && eligibility === 'eligible' && (
                                <div className="w-1.5 h-1.5 bg-slate-200 rounded-full" />
                              )}
                              {isIneligibleEmpty && (
                                <span className="text-[10px] font-medium text-slate-400">
                                  {cellStatus === 'not_enrolled' ? '-' : 'L'}
                                </span>
                              )}
                              {isFuture && <Lock className="w-3.5 h-3.5 text-slate-300" />}
                            </>
                          )}
                        </button>

                        {isIneligibleEmpty &&
                          onAttendanceOverrideRequested &&
                          !isFuture &&
                          !isArchived &&
                          !isPaused && (
                            <button
                              type="button"
                              aria-label={overrideAriaLabel}
                              onClick={() =>
                                onAttendanceOverrideRequested(student.id, dateStr, eligibility)
                              }
                              className="absolute -top-1 -right-1 w-5 h-5 bg-amber-50 border border-amber-200 rounded-full flex items-center justify-center text-amber-600 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100 transition-opacity shadow-sm hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                            >
                              <AlertTriangle className="w-3 h-3" />
                            </button>
                          )}

                        {attendance && !isArchived && !isPaused && (
                          <button
                            type="button"
                            onClick={() => onOpenDetail(attendance)}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-white border border-slate-100 rounded-full flex items-center justify-center text-slate-400 opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm hover:text-blue-600"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
