import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { auth } from '../../../lib/auth/sessionAuth';
import { Attendance } from '../../../types';
import { getVNTodayStr, formatVN } from '../../../lib/core/utils';
import { ApiError, apiRequest } from '../../../lib/api/apiClient';
import type { CourseClosingSnapshot } from '../../../../shared/courseClosing';
import {
  FRONTEND_READ_POLL_INTERVAL_MS,
  readCalendarReferences,
} from '../../../lib/api/frontendReadApi';

interface UseClassDetailMiscParams {
  classId: string | undefined;
  classData: any;
  setClassData?: React.Dispatch<React.SetStateAction<any>>;
  profile: any;
  todayStr: string;
  todayAttendanceMap: Map<string, Attendance>;
  isAttendancePending: (studentId: string, date: string) => boolean;
  onCourseClosingRefresh?: () => Promise<void>;
  t: any;
}

type ResetCourseResponse = {
  startDate?: string;
  endDate?: string;
  terms?: any[];
  holidays?: string[];
};

export type ResetCourseError = {
  message: string;
  errorCode?: string;
  courseClosing?: CourseClosingSnapshot;
};

/**
 * The server validates `operationId` as an RFC 4122 UUID, so the fallback has to
 * satisfy the same shape when `crypto.randomUUID` is unavailable.
 */
function createOperationId(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoRef?.getRandomValues === 'function') cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toResetCourseError(error: unknown, fallbackMessage: string): ResetCourseError {
  if (error instanceof ApiError) {
    const data = error.data;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      return {
        message: error.message || fallbackMessage,
        errorCode: typeof record.errorCode === 'string' ? record.errorCode : undefined,
        courseClosing: (record.courseClosing as CourseClosingSnapshot | undefined) ?? undefined,
      };
    }
    return { message: error.message || fallbackMessage };
  }
  return { message: fallbackMessage };
}

export function useClassDetailMisc({
  classId,
  classData,
  setClassData,
  profile,
  todayStr,
  todayAttendanceMap,
  isAttendancePending,
  onCourseClosingRefresh,
  t,
}: UseClassDetailMiscParams) {
  // ─── System holidays listener ───
  const [systemHolidays, setSystemHolidays] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadHolidays = async () => {
      try {
        const data = await readCalendarReferences();
        if (!cancelled) setSystemHolidays(data.systemHolidays || []);
      } catch (error) {
        if (!cancelled) console.error('Error loading system holidays through read API:', error);
      }
    };
    void loadHolidays();
    const interval = window.setInterval(
      () => void loadHolidays(),
      FRONTEND_READ_POLL_INTERVAL_MS
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // ─── Online/offline listener ───
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ─── Course period initialization ───
  const [coursePeriod, setCoursePeriod] = useState({ start: '', end: '' });
  const coursePeriodInitialized = useRef(false);

  // Initialize course period once classData is loaded
  useEffect(() => {
    if (classData && !coursePeriodInitialized.current) {
      coursePeriodInitialized.current = true;
      const today = getVNTodayStr();
      setCoursePeriod({
        start: classData.startDate,
        end: classData.endDate > today ? classData.endDate : today,
      });
    }
  }, [classData]);

  // ─── Reset class logic ───
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetDates, setResetDates] = useState({ startDate: '', endDate: '' });
  const [isResettingClass, setIsResettingClass] = useState(false);
  const [resetError, setResetError] = useState<ResetCourseError | null>(null);
  // Held across failed retries so a timed-out reset can be replayed safely, and
  // cleared once the operation logically finishes.
  const resetOperationIdRef = useRef('');

  const clearResetOperation = () => {
    resetOperationIdRef.current = '';
    setResetError(null);
  };

  const handleResetClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !auth.currentUser || !classData || isResettingClass) return;

    if (!resetOperationIdRef.current) resetOperationIdRef.current = createOperationId();

    setIsResettingClass(true);
    setResetError(null);
    try {
      const result = await apiRequest<ResetCourseResponse>('/api/v1/classes/reset-course', {
        method: 'POST',
        body: {
          classId,
          startDate: resetDates.startDate,
          endDate: resetDates.endDate,
          operationId: resetOperationIdRef.current,
        },
      });
      const nextStartDate = result.startDate || resetDates.startDate;
      const nextEndDate = result.endDate || resetDates.endDate;
      const nextTerms = Array.isArray(result.terms) ? result.terms : classData.terms;
      const nextHolidays = Array.isArray(result.holidays) ? result.holidays : [];
      const today = getVNTodayStr();

      setClassData?.((prev: any) =>
        prev
          ? {
              ...prev,
              startDate: nextStartDate,
              endDate: nextEndDate,
              terms: nextTerms,
              holidays: nextHolidays,
            }
          : prev
      );
      setCoursePeriod({
        start: nextStartDate,
        end: nextEndDate > today ? nextEndDate : today,
      });
      setResetDates({ startDate: nextStartDate, endDate: nextEndDate });
      toast.success(t.courseResetSuccess);
      setIsResetModalOpen(false);
      clearResetOperation();
      await onCourseClosingRefresh?.();
    } catch (err) {
      console.error('Error resetting class:', err);
      // Show the real API message and error code rather than a generic toast, so
      // the user learns exactly which sends are still outstanding.
      const normalized = toResetCourseError(err, t.courseResetError);
      setResetError(normalized);
      toast.error(normalized.message);
    } finally {
      setIsResettingClass(false);
    }
  };

  // ─── Holidays updated handler ───
  const handleHolidaysUpdated = async (update: { endDate?: string }) => {
    if (!classData || !update.endDate || update.endDate === classData.endDate) return;
    const message =
      update.endDate > classData.endDate
        ? t.courseEndDateExtended.replace('{date}', formatVN(update.endDate, 'dd/MM/yyyy'))
        : t.courseEndDateUpdated.replace('{date}', formatVN(update.endDate, 'dd/MM/yyyy'));
    toast.success(message);
  };

  // ─── Attendance detail modal state ───
  const [selectedAttendanceForDetail, setSelectedAttendanceForDetail] = useState<Attendance | null>(
    null
  );
  const [isSavingAttendanceDetail, setIsSavingAttendanceDetail] = useState(false);
  const [savingAbsencePermissionStudentId, setSavingAbsencePermissionStudentId] = useState<
    string | null
  >(null);
  const [confirmingDeleteAttendanceId, setConfirmingDeleteAttendanceId] = useState<string | null>(
    null
  );
  const [deletingAttendanceRecordId, setDeletingAttendanceRecordId] = useState<string | null>(null);
  const [confirmingSessionDate, setConfirmingSessionDate] = useState<string | null>(null);

  const handleUpdateAttendanceDetail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAttendanceForDetail || isSavingAttendanceDetail) return;
    setIsSavingAttendanceDetail(true);
    try {
      await apiRequest('/api/v1/attendance/update-detail', {
        method: 'POST',
        body: {
          attendanceId: selectedAttendanceForDetail.id,
          permission: selectedAttendanceForDetail.permission || false,
          minutesLate: selectedAttendanceForDetail.minutesLate || 0,
        },
      });
      toast.success(t.attendanceDetailUpdated);
      setSelectedAttendanceForDetail(null);
    } catch (err) {
      console.error('Error updating attendance detail:', err);
      toast.error(t.attendanceDetailError);
    } finally {
      setIsSavingAttendanceDetail(false);
    }
  };

  const handleToggleAbsencePermission = async (studentId: string) => {
    const attendance = todayAttendanceMap.get(studentId);
    if (
      !attendance ||
      attendance.status !== 'absent' ||
      savingAbsencePermissionStudentId ||
      isAttendancePending(studentId, todayStr)
    ) {
      return;
    }
    setSavingAbsencePermissionStudentId(studentId);
    try {
      await apiRequest('/api/v1/attendance/toggle-permission', {
        method: 'POST',
        body: { attendanceId: attendance.id, permission: !attendance.permission },
      });
      toast.success(attendance.permission ? t.permissionRemoved : t.permissionGranted);
    } catch (err) {
      console.error('Error updating absence permission:', err);
      toast.error(t.permissionError);
    } finally {
      setSavingAbsencePermissionStudentId(null);
    }
  };

  const openTodayAttendanceDetail = (studentId: string) => {
    const attendance = todayAttendanceMap.get(studentId);
    if (!attendance) {
      toast.error(t.markAttendanceFirst);
      return;
    }
    setSelectedAttendanceForDetail(attendance);
  };

  const handleConfirmSession = async (date: string, status: 'taught' | 'cancelled' | 'makeup') => {
    if (!classData || !auth.currentUser || confirmingSessionDate) return;
    setConfirmingSessionDate(date);
    try {
      await apiRequest('/api/v1/edu/evaluation-confirm-session', {
        method: 'POST',
        body: { classId: classData.id, date, status },
      });
      const statusLabel =
        status === 'taught'
          ? t.statusTaught
          : status === 'cancelled'
            ? t.statusCancelled
            : t.statusMakeup;
      toast.success(t.sessionConfirmed.replace('{status}', statusLabel));
    } catch (err) {
      console.error('Error confirming session:', err);
      toast.error(t.sessionConfirmError);
    } finally {
      setConfirmingSessionDate(null);
    }
  };

  // ─── Export and UI state ───
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'students' | 'attendance' | 'reports'>(
    profile?.role === 'admin' ? 'reports' : 'students'
  );
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [isFaceModalOpen, setIsFaceModalOpen] = useState(false);
  const [notifyAbsenceDate, setNotifyAbsenceDate] = useState<string | null>(null);

  return {
    // System holidays
    systemHolidays,

    // Online/offline
    isOnline,

    // Course period
    coursePeriod,
    setCoursePeriod,

    // Reset class
    isResetModalOpen,
    setIsResetModalOpen,
    resetDates,
    setResetDates,
    isResettingClass,
    handleResetClass,
    resetError,
    clearResetOperation,

    // Holidays updated
    handleHolidaysUpdated,

    // Attendance detail modal
    selectedAttendanceForDetail,
    setSelectedAttendanceForDetail,
    isSavingAttendanceDetail,
    savingAbsencePermissionStudentId,
    confirmingDeleteAttendanceId,
    setConfirmingDeleteAttendanceId,
    deletingAttendanceRecordId,
    setDeletingAttendanceRecordId,
    confirmingSessionDate,
    handleUpdateAttendanceDetail,
    handleToggleAbsencePermission,
    openTodayAttendanceDetail,
    handleConfirmSession,

    // Export and UI state
    isExporting,
    setIsExporting,
    activeTab,
    setActiveTab,
    selectedMonth,
    setSelectedMonth,
    isFaceModalOpen,
    setIsFaceModalOpen,
    notifyAbsenceDate,
    setNotifyAbsenceDate,
  };
}
