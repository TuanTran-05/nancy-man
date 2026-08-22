import { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Class, ClassStatus, SubstituteRequest } from '../../../types';
import { apiRequest } from '../../../lib/api/apiClient';
import { getStudentDirectory } from '../../../lib/api/studentDirectoryApi';
import { getVNTodayStr, normalizeUserTimeInput } from '../../../lib/core/utils';
import { getWeeklyClassSessions } from '../../../../shared/classSchedule';
import toast from 'react-hot-toast';
import {
  buildClassStudentCounts,
  type ClassStudentCount,
} from '../../../lib/student/classStudentCounts';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../../shared/classVisibility';
import {
  officeClassListQueryOptions,
  officeHolidaysQueryOptions,
  officeStudentIndexQueryOptions,
  officeTeacherReferencesQueryOptions,
} from '../../../lib/office/officeReferenceQueries';
import { officeQueryKeyPrefixes, officeQueryKeys } from '../../../lib/office/officeQueryKeys';
import {
  FRONTEND_READ_POLL_INTERVAL_MS,
  readCalendarReferences,
  readClassesData,
} from '../../../lib/api/frontendReadApi';
import { readChannel } from '../../../lib/api/readApi';

export function useClassesData(profile: any) {
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === 'admin';
  const isOffice = profile?.role === 'office';
  const hasFullAcademicAccess = isAdmin || isOffice;

  const identity = useMemo(
    () => ({ uid: profile?.uid || '', role: profile?.role || '' }),
    [profile?.uid, profile?.role]
  );
  const cachedEnabled = Boolean(identity.uid && hasFullAcademicAccess);

  // Cached branch queries
  const classesQuery = useQuery(officeClassListQueryOptions(identity, cachedEnabled));
  const teachersQuery = useQuery(officeTeacherReferencesQueryOptions(identity, cachedEnabled));
  const holidaysQuery = useQuery(officeHolidaysQueryOptions(identity, cachedEnabled));
  const studentIndexQuery = useQuery(officeStudentIndexQueryOptions(identity, cachedEnabled));

  // Legacy fallback states (used for Teacher / substitute teacher)
  const [legacyClasses, setLegacyClasses] = useState<Class[]>([]);
  const [legacyStudentCounts, setLegacyStudentCounts] = useState<Record<string, ClassStudentCount>>(
    {}
  );
  const [legacyTeachers, setLegacyTeachers] = useState<
    { uid: string; displayName: string; email: string }[]
  >([]);
  const [substituteClasses, setSubstituteClasses] = useState<
    (Class & { _substituteRequest: SubstituteRequest })[]
  >([]);
  const [legacySystemHolidays, setLegacySystemHolidays] = useState<string[]>([]);
  const [legacyLoading, setLegacyLoading] = useState(true);

  // UI mutation states
  const [changingStatusClassId, setChangingStatusClassId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const refreshStudentCounts = useCallback(async () => {
    if (cachedEnabled) {
      await queryClient.invalidateQueries({
        queryKey: officeQueryKeys.studentIndex(identity),
      });
      return;
    }
    try {
      const data = await getStudentDirectory({ revalidate: true });
      setLegacyStudentCounts(buildClassStudentCounts(data.students || []));
    } catch (error) {
      console.error('Error refreshing student counts in classes list:', error);
    }
  }, [cachedEnabled, identity, queryClient]);

  // HTTP-backed reference data for teacher/substitute-teacher views.
  useEffect(() => {
    if (!profile?.uid || hasFullAcademicAccess) return;
    let cancelled = false;

    const loadTeacherReferences = async () => {
      try {
        const [classPayload, directory, holidayPayload, substitutePayload] = await Promise.all([
          readClassesData(),
          getStudentDirectory(),
          readCalendarReferences(),
          readChannel<{ requests: SubstituteRequest[]; classes?: Class[] }>('substitute-requests', {
            status: 'accepted',
            date: getVNTodayStr(),
          }),
        ]);
        if (cancelled) return;

        const classRows = filterClassesForRoleOutsideAdminDashboard(
          classPayload.classes || [],
          profile.role
        );
        setLegacyClasses(classRows);
        setLegacyStudentCounts(buildClassStudentCounts(directory.students || []));
        setLegacySystemHolidays(holidayPayload.systemHolidays || []);
        setLegacyTeachers([
          {
            uid: profile.uid,
            displayName: profile.displayName || 'GV',
            email: profile.email || '',
          },
        ]);

        const classById = new Map(
          [...classRows, ...(substitutePayload.classes || [])].map((row) => [row.id, row])
        );
        const substituteRows = (substitutePayload.requests || [])
          .filter((request) => request.substituteTeacherId === profile.uid)
          .flatMap((request) => {
            const classRow = classById.get(request.classId);
            return classRow ? [{ ...classRow, _substituteRequest: request }] : [];
          });
        setSubstituteClasses(
          filterClassesForRoleOutsideAdminDashboard(substituteRows, profile.role)
        );
      } catch (error) {
        if (!cancelled) console.error('Error loading teacher class references:', error);
      } finally {
        if (!cancelled) setLegacyLoading(false);
      }
    };

    void loadTeacherReferences();
    const interval = window.setInterval(
      () => void loadTeacherReferences(),
      FRONTEND_READ_POLL_INTERVAL_MS
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasFullAcademicAccess, profile]);

  // Derive final values
  const classes = cachedEnabled ? classesQuery.data || [] : legacyClasses;
  const studentCounts = cachedEnabled
    ? buildClassStudentCounts(studentIndexQuery.data || [])
    : legacyStudentCounts;
  const teachers = cachedEnabled
    ? (teachersQuery.data || []).filter((teacher) => !teacher.blockedTeacher)
    : legacyTeachers;
  const systemHolidays = cachedEnabled ? holidaysQuery.data || [] : legacySystemHolidays;
  const teacherReferencesLoading = cachedEnabled
    ? teachersQuery.isPending && !teachersQuery.data
    : legacyLoading;
  const loadingDetails = cachedEnabled
    ? teacherReferencesLoading ||
      (holidaysQuery.isPending && !holidaysQuery.data) ||
      (studentIndexQuery.isPending && !studentIndexQuery.data)
    : legacyLoading;
  // Classes are the primary payload. Teacher names, counts and holidays can
  // continue loading without holding the entire page behind a spinner.
  const loading = cachedEnabled ? classesQuery.isPending && !classesQuery.data : legacyLoading;

  const handleQuickStatusChange = async (cls: Class, newStatus: ClassStatus, tMsg: any) => {
    setChangingStatusClassId(cls.id);
    const previous = cachedEnabled
      ? queryClient.getQueryData<Class[]>(officeQueryKeys.classList(identity))
      : null;

    if (cachedEnabled) {
      queryClient.setQueryData(
        officeQueryKeys.classList(identity),
        (current: Class[] | undefined) =>
          (current || []).map((c) => (c.id === cls.id ? { ...c, status: newStatus } : c))
      );
    }

    try {
      await apiRequest('/api/v1/classes/status', {
        method: 'PUT',
        body: { id: cls.id, status: newStatus },
      });
      toast.success(
        `${tMsg.changedStatus}${newStatus === 'active' ? tMsg.filterActive : newStatus === 'paused' ? tMsg.filterPaused : tMsg.filterArchived}`
      );
    } catch (err) {
      if (cachedEnabled && previous) {
        queryClient.setQueryData(officeQueryKeys.classList(identity), previous);
      }
      console.error('Error updating class status:', err);
      toast.error(tMsg.permissionError);
    } finally {
      setChangingStatusClassId(null);
      if (cachedEnabled) {
        void queryClient.invalidateQueries({
          queryKey: officeQueryKeyPrefixes.classList,
        });
      }
    }
  };

  const handleDelete = async (classToDeleteId: string, successMsg: string, errorMsg: string) => {
    if (isDeleting) return;
    setIsDeleting(true);

    const previous = cachedEnabled
      ? queryClient.getQueryData<Class[]>(officeQueryKeys.classList(identity))
      : null;

    if (cachedEnabled) {
      queryClient.setQueryData(
        officeQueryKeys.classList(identity),
        (current: Class[] | undefined) => (current || []).filter((c) => c.id !== classToDeleteId)
      );
    }

    try {
      await apiRequest(`/api/v1/classes/delete?id=${encodeURIComponent(classToDeleteId)}`, {
        method: 'DELETE',
      });
      toast.success(successMsg);
      return true;
    } catch (err) {
      if (cachedEnabled && previous) {
        queryClient.setQueryData(officeQueryKeys.classList(identity), previous);
      }
      console.error('Error deleting class:', err);
      toast.error(errorMsg);
      return false;
    } finally {
      setIsDeleting(false);
      if (cachedEnabled) {
        void queryClient.invalidateQueries({
          queryKey: officeQueryKeyPrefixes.classList,
        });
      }
    }
  };

  const handleSaveClass = async (
    editingClass: Class | null,
    formData: any,
    importSourceClassId: string,
    tMsg: any
  ) => {
    if (!profile?.uid || isSaving) return;
    setIsSaving(true);

    const normalizedWeeklySessions = Array.isArray(formData.weeklySessions)
      ? formData.weeklySessions
          .filter((session: any) => session && session.startTime && session.endTime)
          .map((session: any) => ({
            dayOfWeek: Number(session.dayOfWeek),
            startTime: normalizeUserTimeInput(session.startTime),
            endTime: normalizeUserTimeInput(session.endTime),
            ...(session.room ? { room: String(session.room).trim() } : {}),
          }))
      : [];
    const resolvedSessions = getWeeklyClassSessions({
      weeklySessions: normalizedWeeklySessions,
      room: formData.room || '',
      daysOfWeek: formData.daysOfWeek || [],
      startTime: formData.startTime || '',
      schedule: formData.schedule || '',
    });
    const firstSession = resolvedSessions[0];

    const data: Record<string, any> = {
      name: formData.name,
      schedule: firstSession?.schedule || formData.schedule || '',
      daysOfWeek:
        normalizedWeeklySessions.length > 0
          ? normalizedWeeklySessions.map((session) => session.dayOfWeek).sort((a, b) => a - b)
          : formData.daysOfWeek || [],
      description: formData.description || '',
      startDate: formData.startDate || '',
      endDate: formData.endDate || '',
      startTime: firstSession?.startTime
        ? normalizeUserTimeInput(firstSession.startTime)
        : formData.startTime
          ? normalizeUserTimeInput(formData.startTime)
          : '',
      room: formData.room || '',
      teacherId: hasFullAcademicAccess
        ? formData.teacherId
        : editingClass?.teacherId || profile.uid,
      status: formData.status,
      salaryPerSession: Number(formData.salaryPerSession) || 0,
      tuitionFee: Number(formData.tuitionFee) || 0,
      weeklySessions: normalizedWeeklySessions,
    };
    if (!formData.grade) {
      delete data.grade;
    } else {
      data.grade = Number(formData.grade);
    }

    try {
      if (editingClass) {
        await apiRequest('/api/v1/classes/update', {
          method: 'PUT',
          body: { id: editingClass.id, ...data },
        });
        toast.success(tMsg.successUpdate);
      } else {
        if (!hasFullAcademicAccess) {
          toast.error(tMsg.onlyAdmin);
          setIsSaving(false);
          return false;
        }

        if (importSourceClassId) setIsImporting(true);
        const result = await apiRequest<{ importedCount?: number }>('/api/v1/classes/create', {
          method: 'POST',
          body: { ...data, importSourceClassId },
        });
        if (importSourceClassId && result.importedCount) {
          const msg = tMsg.importSuccess.replace('{count}', String(result.importedCount));
          toast.success(tMsg.successAdd + ' - ' + msg);
          if (cachedEnabled) {
            void queryClient.invalidateQueries({
              queryKey: officeQueryKeys.studentIndex(identity),
            });
          }
        } else {
          toast.success(tMsg.successAdd);
        }
      }

      if (cachedEnabled) {
        void queryClient.invalidateQueries({
          queryKey: officeQueryKeyPrefixes.classList,
        });
      }
      return true;
    } catch (err: any) {
      console.error('Error saving class:', err);
      toast.error(err?.message?.includes('already exists') ? tMsg.classExists : tMsg.saveError);
      return false;
    } finally {
      setIsSaving(false);
      setIsImporting(false);
    }
  };

  return {
    classes,
    studentCounts,
    teachers,
    substituteClasses,
    systemHolidays,
    loading,
    loadingDetails,
    teacherReferencesLoading,
    changingStatusClassId,
    isSaving,
    isDeleting,
    isImporting,
    refreshStudentCounts,
    handleQuickStatusChange,
    handleDelete,
    handleSaveClass,
  };
}
