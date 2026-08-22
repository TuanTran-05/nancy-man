import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../lib/auth/sessionAuth';
import { Attendance, UserProfile } from '../types';
import { getVNTodayStr } from '../lib/core/utils';
import { apiRequest } from '../lib/api/apiClient';
import {
  FRONTEND_READ_POLL_INTERVAL_MS,
  readClassDetailData,
} from '../lib/api/frontendReadApi';

export interface AbsentMarkedEvent {
  studentId: string;
  date: string;
  classId: string;
}

export type AttendanceOverrideOptions = {
  eligibilityOverride: true;
  overrideReason: string;
};

export type BulkAttendanceResult = {
  updatedCount: number;
  studentIds: string[];
  status: Attendance['status'];
  skipped: { not_enrolled: string[]; on_leave: string[] };
};

export type AttendanceReadRange = { from: string; to: string };

type AttendanceStatus = Attendance['status'];

const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'late'];

const getPendingToggleKey = (studentId: string, date: string) => `${studentId}_${date}`;

export function canReadClassAttendance(profile: Pick<UserProfile, 'role'> | null): boolean {
  return profile?.role === 'admin' || profile?.role === 'teacher' || profile?.role === 'office';
}

export function useAttendanceManager(
  classId: string | undefined,
  profile: UserProfile | null,
  onAbsentMarked?: (event: AbsentMarkedEvent) => void
) {
  const [attendanceData, setAttendanceData] = useState<Attendance[]>([]);
  const [pendingToggleKeys, setPendingToggleKeys] = useState<string[]>([]);
  const [pendingToggleStatuses, setPendingToggleStatuses] = useState<
    Record<string, AttendanceStatus>
  >({});
  const pendingToggles = useRef<Set<string>>(new Set());
  const hasAttendanceAccess = canReadClassAttendance(profile);

  const [attendanceReadRange, setAttendanceReadRange] = useState<AttendanceReadRange | null>(null);
  const [isAttendanceRangeLoading, setIsAttendanceRangeLoading] = useState(false);

  const loadAttendance = useCallback(async () => {
    if (!classId || !auth.currentUser || !hasAttendanceAccess) return;
    setIsAttendanceRangeLoading(Boolean(attendanceReadRange));
    try {
      const payload = await readClassDetailData(classId);
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const sixtyDaysAgoStr = sixtyDaysAgo.toISOString().split('T')[0];
      const rows = (payload.attendance || []).filter((row) => {
        if ((row as Attendance & { isVoided?: boolean }).isVoided === true) return false;
        if (row.date >= sixtyDaysAgoStr) return true;
        return Boolean(
          attendanceReadRange &&
            row.date >= attendanceReadRange.from &&
            row.date <= attendanceReadRange.to
        );
      });

      setAttendanceData((current) => {
        const combined = new Map(
          rows.map((row) => [row.id || `${row.classId}_${row.studentId}_${row.date}`, row])
        );
        for (const row of current) {
          const key = getPendingToggleKey(row.studentId, row.date);
          if (pendingToggles.current.has(key)) {
            combined.set(row.id || `${row.classId}_${row.studentId}_${row.date}`, row);
          }
        }
        return [...combined.values()];
      });
    } catch (error) {
      console.error('Attendance read API refresh failed:', error);
    } finally {
      setIsAttendanceRangeLoading(false);
    }
  }, [attendanceReadRange, classId, hasAttendanceAccess]);

  useEffect(() => {
    if (!classId || !auth.currentUser || !hasAttendanceAccess) {
      setAttendanceData([]);
      setIsAttendanceRangeLoading(false);
      return;
    }

    void loadAttendance();
    const interval = window.setInterval(() => void loadAttendance(), FRONTEND_READ_POLL_INTERVAL_MS);
    const refresh = () => void loadAttendance();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [classId, hasAttendanceAccess, loadAttendance]);

  const toggleAttendance = useCallback(
    async (
      studentId: string,
      date: string,
      explicitStatus?: 'present' | 'absent' | 'late',
      overrideOptions?: AttendanceOverrideOptions
    ) => {
      if (!auth.currentUser || !classId || !hasAttendanceAccess) return;
      if (date > getVNTodayStr()) return;

      const key = getPendingToggleKey(studentId, date);
      if (pendingToggles.current.has(key)) return;

      // 1. Compute optimistic next state
      const existing = attendanceData.find((a) => a.studentId === studentId && a.date === date);
      const currentStatus = (existing?.status as string | undefined) ?? null;
      const nextStatus: AttendanceStatus =
        explicitStatus ??
        (currentStatus
          ? STATUS_CYCLE[
              (STATUS_CYCLE.indexOf(currentStatus as (typeof STATUS_CYCLE)[number]) + 1) % 3
            ]
          : 'present');

      pendingToggles.current.add(key);
      setPendingToggleKeys((curr) => (curr.includes(key) ? curr : [...curr, key]));
      setPendingToggleStatuses((curr) => ({ ...curr, [key]: nextStatus }));

      // 2. Snapshot for rollback, then optimistic update
      const prev = attendanceData;
      setAttendanceData((curr) => {
        const filtered = curr.filter((a) => !(a.studentId === studentId && a.date === date));
        const optimistic: Attendance = {
          id: existing?.id ?? `${classId}_${studentId}_${date}`,
          classId,
          studentId,
          date,
          status: nextStatus,
          teacherId: auth.currentUser!.uid,
        } as Attendance;
        return [...filtered, optimistic];
      });

      // 3. API call in background
      try {
        const result = await apiRequest<{ status: string }>(
          explicitStatus ? '/api/v1/attendance/toggle' : '/api/v1/attendance/cycle',
          {
            method: 'POST',
            body: {
              classId,
              studentId,
              date,
              ...(explicitStatus ? { status: explicitStatus } : {}),
              ...(overrideOptions ? { ...overrideOptions } : {}),
            },
          }
        );
        if (result.status === 'absent' && onAbsentMarked && classId) {
          onAbsentMarked({ studentId, date, classId });
        }
      } catch (err) {
        // 4. Roll back only this cell so concurrent bulk updates keep their successful records.
        setAttendanceData((curr) => {
          const filtered = curr.filter((a) => !(a.studentId === studentId && a.date === date));
          const previousAttendance = prev.find((a) => a.studentId === studentId && a.date === date);
          return previousAttendance ? [...filtered, previousAttendance] : filtered;
        });
        console.error('Attendance toggle failed, rolled back:', err);
        throw err;
      } finally {
        pendingToggles.current.delete(key);
        setPendingToggleKeys((curr) => curr.filter((pendingKey) => pendingKey !== key));
        setPendingToggleStatuses((curr) => {
          const { [key]: _removed, ...rest } = curr;
          return rest;
        });
      }
    },
    [attendanceData, classId, hasAttendanceAccess, onAbsentMarked]
  );

  const bulkSetAttendance = useCallback(
    async (
      studentIds: string[],
      date: string,
      status: 'present' | 'absent' | 'late'
    ): Promise<BulkAttendanceResult | undefined> => {
      if (!auth.currentUser || !classId || !hasAttendanceAccess) return;
      if (date > getVNTodayStr()) return;

      const uniqueStudentIds = [...new Set(studentIds)].filter(Boolean);
      if (uniqueStudentIds.length === 0) return;

      const keys = uniqueStudentIds.map((studentId) => getPendingToggleKey(studentId, date));
      if (keys.some((key) => pendingToggles.current.has(key))) return;

      keys.forEach((key) => pendingToggles.current.add(key));
      setPendingToggleKeys((curr) => [...new Set([...curr, ...keys])]);
      setPendingToggleStatuses((curr) => ({
        ...curr,
        ...Object.fromEntries(keys.map((key) => [key, status])),
      }));

      const prev = attendanceData;
      setAttendanceData((curr) => {
        const targetIds = new Set(uniqueStudentIds);
        const filtered = curr.filter((a) => !(targetIds.has(a.studentId) && a.date === date));
        const optimistic = uniqueStudentIds.map(
          (studentId) =>
            ({
              id: `${classId}_${studentId}_${date}`,
              classId,
              studentId,
              date,
              status,
              teacherId: auth.currentUser!.uid,
            }) as Attendance
        );
        return [...filtered, ...optimistic];
      });

      try {
        const result = await apiRequest<BulkAttendanceResult>('/api/v1/attendance/bulk-toggle', {
          method: 'POST',
          body: { classId, date, status, studentIds: uniqueStudentIds },
        });

        const skippedIds = new Set([
          ...(result.skipped?.not_enrolled || []),
          ...(result.skipped?.on_leave || []),
        ]);
        if (skippedIds.size > 0) {
          setAttendanceData((curr) => {
            const filtered = curr.filter((a) => !(skippedIds.has(a.studentId) && a.date === date));
            const restoredPrev = prev.filter((a) => skippedIds.has(a.studentId) && a.date === date);
            return [...filtered, ...restoredPrev];
          });
        }
        return result;
      } catch (err) {
        setAttendanceData(prev);
        console.error('Bulk attendance failed, rolled back:', err);
        throw err;
      } finally {
        keys.forEach((key) => pendingToggles.current.delete(key));
        setPendingToggleKeys((curr) => curr.filter((key) => !keys.includes(key)));
        setPendingToggleStatuses((curr) => {
          const next = { ...curr };
          keys.forEach((key) => delete next[key]);
          return next;
        });
      }
    },
    [attendanceData, classId, hasAttendanceAccess]
  );

  const isAttendancePending = useCallback(
    (studentId: string, date: string) =>
      pendingToggleKeys.includes(getPendingToggleKey(studentId, date)),
    [pendingToggleKeys]
  );

  const getPendingAttendanceStatus = useCallback(
    (studentId: string, date: string) =>
      pendingToggleStatuses[getPendingToggleKey(studentId, date)],
    [pendingToggleStatuses]
  );

  return {
    attendanceData,
    isToggling: pendingToggleKeys.length > 0,
    isAttendancePending,
    getPendingAttendanceStatus,
    toggleAttendance,
    bulkSetAttendance,
    setAttendanceReadRange,
    isAttendanceRangeLoading,
  };
}
