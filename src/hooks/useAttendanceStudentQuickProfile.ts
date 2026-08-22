import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceStudentQuickProfileResponse } from '../../shared/attendanceStudentQuickProfile';
import { fetchAttendanceStudentQuickProfile } from '../lib/api/attendanceStudentQuickProfileApi';

function quickProfileErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Failed to load student profile';
}

export function useAttendanceStudentQuickProfile(args: {
  studentId: string;
  classId: string;
  enabled: boolean;
}) {
  const [data, setData] = useState<AttendanceStudentQuickProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!args.enabled || !args.studentId || !args.classId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAttendanceStudentQuickProfile({
        studentId: args.studentId,
        classId: args.classId,
      });
      if (requestId === requestIdRef.current) setData(next);
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setData(null);
        setError(quickProfileErrorMessage(reason));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [args.classId, args.enabled, args.studentId]);

  useEffect(() => {
    requestIdRef.current += 1;
    setData(null);
    setError(null);
    if (args.enabled) {
      void load();
    } else {
      setLoading(false);
    }
    return () => {
      requestIdRef.current += 1;
    };
  }, [args.enabled, args.studentId, args.classId, load]);

  return { data, loading, error, reload: load };
}
