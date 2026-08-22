import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Class, DailyReport, Student, UserProfile } from '../types';
import { useInvalidationRefresh } from './useInvalidationRefresh';
import {
  classAssignmentsQueryOptions,
  classDailyReportsQueryOptions,
  classEvaluationsQueryOptions,
  classMetadataQueryOptions,
  classRosterQueryOptions,
  classSessionsQueryOptions,
  classSubmissionsQueryOptions,
  readClassRoster,
} from '../lib/classes/classDetailQueries';
import { officeHolidaysQueryOptions } from '../lib/office/officeReferenceQueries';
import { officeQueryKeys } from '../lib/office/officeQueryKeys';

export function getClassDetailStudentScope(
  classId: string,
  profile: Pick<UserProfile, 'role'> | null,
  uid: string
) {
  if (profile?.role === 'admin' || profile?.role === 'office') return { classId };
  return { classId, teacherId: uid };
}

export function canReadClassTeachingData(
  profile: Pick<UserProfile, 'role'> | null,
  isSubstituteTeacher: boolean
) {
  return (
    profile?.role === 'admin' ||
    profile?.role === 'teacher' ||
    profile?.role === 'office' ||
    isSubstituteTeacher
  );
}

export type RefreshAttendanceStudentsOptions = { attendanceTermStart: string };

export function useClassData(
  classId: string | undefined,
  profile: UserProfile | null,
  isSubstituteTeacher: boolean = false
) {
  const queryClient = useQueryClient();
  const identity = useMemo(
    () => ({ uid: profile?.uid || '', role: profile?.role || '' }),
    [profile?.uid, profile?.role]
  );
  const enabled = Boolean(
    classId && identity.uid && canReadClassTeachingData(profile, isSubstituteTeacher)
  );
  const hasFullAccess =
    profile?.role === 'admin' || profile?.role === 'office' || isSubstituteTeacher;

  const metaQuery = useQuery(classMetadataQueryOptions(identity, classId || '', enabled));
  const rosterQuery = useQuery(classRosterQueryOptions(identity, classId || '', undefined, enabled));
  const evaluationsQuery = useQuery(
    classEvaluationsQueryOptions(identity, classId || '', enabled)
  );
  const assignmentsQuery = useQuery(classAssignmentsQueryOptions(identity, classId || '', enabled));
  const submissionsQuery = useQuery(classSubmissionsQueryOptions(identity, classId || '', enabled));
  const sessionsQuery = useQuery(classSessionsQueryOptions(identity, classId || '', enabled));
  const reportsQuery = useQuery(classDailyReportsQueryOptions(identity, classId || '', enabled));
  const holidaysQuery = useQuery(officeHolidaysQueryOptions(identity, enabled));

  const [classData, setClassData] = useState<Class | null>(null);
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);
  const [attendanceStudentsOverride, setAttendanceStudentsOverride] = useState<Student[] | null>(
    null
  );
  const lastAttendanceTermStartRef = useRef<string | null>(null);

  useEffect(() => {
    if (metaQuery.data) setClassData(metaQuery.data);
  }, [metaQuery.data]);

  useEffect(() => {
    if (reportsQuery.data) setDailyReports(reportsQuery.data);
  }, [reportsQuery.data]);

  const refreshStudents = useCallback(async () => {
    if (!classId) return;
    await queryClient.invalidateQueries({
      queryKey: officeQueryKeys.classRoster(identity, classId),
    });
  }, [classId, identity, queryClient]);

  const refreshAttendanceStudents = useCallback(
    async (options?: RefreshAttendanceStudentsOptions) => {
      if (!classId) return;
      const termStart = options?.attendanceTermStart ?? lastAttendanceTermStartRef.current;
      if (options?.attendanceTermStart) {
        lastAttendanceTermStartRef.current = options.attendanceTermStart;
      }
      try {
        const list = await readClassRoster(classId, termStart || undefined);
        setAttendanceStudentsOverride(list);
      } catch (err) {
        console.error('Error refreshing attendance students through read API:', err);
      }
    },
    [classId]
  );

  const onInvalidateAll = useCallback(() => {
    if (!classId) return;
    const keys = [
      officeQueryKeys.classMetadata(identity, classId),
      officeQueryKeys.classRoster(identity, classId),
      officeQueryKeys.classEvaluations(identity, classId),
      officeQueryKeys.classAssignments(identity, classId),
      officeQueryKeys.classSubmissions(identity, classId),
      officeQueryKeys.classSessions(identity, classId),
      officeQueryKeys.classDailyReports(identity, classId),
      officeQueryKeys.holidays(identity),
    ];
    for (const queryKey of keys) {
      void queryClient.invalidateQueries({ queryKey });
    }
    void refreshAttendanceStudents();
  }, [classId, identity, queryClient, refreshAttendanceStudents]);

  useInvalidationRefresh({
    channelKey: `class-detail:${classId || ''}`,
    enabled,
    onInvalidate: onInvalidateAll,
  });

  const evaluations = (evaluationsQuery.data || []).filter(
    (evaluation) => hasFullAccess || evaluation.teacherId === identity.uid
  );
  const assignments = assignmentsQuery.data || [];
  const submissions = submissionsQuery.data || [];
  const students = rosterQuery.data || [];
  const attendanceStudents = attendanceStudentsOverride || students;
  const classSessions = sessionsQuery.data || [];
  const holidays = holidaysQuery.data || [];
  const loading = enabled && metaQuery.isPending && !classData;
  const error = metaQuery.error
    ? metaQuery.error instanceof Error
      ? metaQuery.error.message
      : 'Class not found'
    : null;

  return {
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
  };
}
