import { useCallback, useEffect, useRef, useState } from 'react';
import type { CourseClosingSnapshot } from '../../../../shared/courseClosing';
import { ApiError, apiRequest } from '../../../lib/api/apiClient';
import { useInvalidationRefresh } from '../../../hooks/useInvalidationRefresh';

export interface UseCourseClosingResult {
  snapshot: CourseClosingSnapshot | null;
  loading: boolean;
  approving: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  approve: (reason?: string) => Promise<CourseClosingSnapshot>;
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(error instanceof Error ? error.message : String(error), 0, error);
}

export function useCourseClosing(classId?: string): UseCourseClosingResult {
  const [snapshot, setSnapshot] = useState<CourseClosingSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(classId));
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    if (!classId) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<{
        success: true;
        courseClosing: CourseClosingSnapshot;
      }>(`/api/v1/classes/course-closing-status?classId=${encodeURIComponent(classId)}`);
      if (requestVersion !== requestVersionRef.current) return;
      setSnapshot(response.courseClosing);
      setError(null);
    } catch (refreshError) {
      if (requestVersion !== requestVersionRef.current) return;
      setError(asApiError(refreshError));
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false);
    }
  }, [classId]);

  const approve = useCallback(
    async (reason?: string) => {
      if (!classId) throw new ApiError('Missing classId', 400, null);
      setApproving(true);
      try {
        const trimmedReason = reason?.trim();
        const response = await apiRequest<{
          success: true;
          courseClosing: CourseClosingSnapshot;
        }>('/api/v1/classes/approve-course-closing', {
          method: 'POST',
          body: { classId, ...(trimmedReason ? { reason: trimmedReason } : {}) },
        });
        setSnapshot(response.courseClosing);
        setError(null);
        return response.courseClosing;
      } catch (approvalError) {
        const normalized = asApiError(approvalError);
        setError(normalized);
        throw normalized;
      } finally {
        setApproving(false);
      }
    },
    [classId]
  );

  useEffect(() => {
    setSnapshot(null);
    void refresh();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [refresh]);

  useInvalidationRefresh({
    channelKey: `course-closing:${classId || ''}`,
    enabled: Boolean(classId),
    onInvalidate: refresh,
  });

  return { snapshot, loading, approving, error, refresh, approve };
}

export default useCourseClosing;
