import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '../../lib/auth/sessionAuth';
import type { Class, SafeStudent } from '../../types';
import { ApiError } from '../api/apiClient';
import {
  fetchStudentAdminReport,
  type StudentAdminReportResponse,
} from '../api/studentAdminReportApi';
import { getStudentDirectory } from '../api/studentDirectoryApi';
import { loadStudentProfileSupportData } from './studentActionReferenceData';
import { studentProfileReportQueryOptions } from './studentProfileQueries';
import {
  officeClassListQueryOptions,
  officeStudentIndexQueryOptions,
  officeTeacherReferencesQueryOptions,
} from '../office/officeReferenceQueries';

export type ParentLoginInfo = { updatedAt: string | null };

export interface StudentProfileData {
  loading: boolean;
  error: string | null;
  notFound: boolean;
  report: StudentAdminReportResponse | null;
  student: SafeStudent | null;
  classes: Class[];
  teachers: { uid: string; displayName: string }[];
  parentLoginInfo: ParentLoginInfo | null | undefined;
  siblings: SafeStudent[];
  siblingCandidates: SafeStudent[];
  reload: () => Promise<void>;
}

type UseStudentProfileDataArgs = {
  studentId: string;
  role: string | undefined;
  seedStudent?: SafeStudent | null;
  seedParentLogin?: ParentLoginInfo | null;
};

const STRING_OPTIONAL_FIELDS = [
  'faceImage',
  'faceImageStoragePath',
  'admissionStatus',
  'trialReviewStatus',
  'trialStartedAt',
  'trialClassId',
  'trialTeacherId',
  'admittedAt',
  'admittedBy',
  'trialDecisionAt',
  'trialDecisionBy',
  'trialDecisionNote',
  'archiveReason',
  'statusNote',
  'statusChangedAt',
  'statusChangedBy',
  'enrollmentDate',
  'leaveUntil',
  'siblingGroupId',
] as const;

const BOOLEAN_OPTIONAL_FIELDS = [
  'customLoginPasswordSet',
  'parentPasswordSet',
  'forcePasswordChange',
  'parentForcePasswordChange',
  'isRevoked',
] as const;

const NUMBER_OPTIONAL_FIELDS = ['trialSessionCount', 'trialRequiredSessions', 'grade'] as const;

const ENUM_VALUES = {
  gender: ['male', 'female', 'other'],
  enrollmentStatus: ['active', 'on_leave', 'dropped', 'promoted'],
  studentLifecycle: ['pending', 'lead', 'trial', 'enrolled', 'archived'],
} as const;

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function coerceSafeStudent(record: Record<string, unknown>): SafeStudent {
  const student: SafeStudent = {
    id: stringField(record.id),
    name: stringField(record.name),
    studentId: stringField(record.studentId),
    dob: stringField(record.dob),
    contact: stringField(record.contact),
    classId: stringField(record.classId),
    teacherId: stringField(record.teacherId),
    createdAt: stringField(record.createdAt),
    code: stringField(record.code),
  };

  for (const field of STRING_OPTIONAL_FIELDS) {
    if (typeof record[field] === 'string') {
      (student as Record<string, unknown>)[field] = record[field];
    }
  }
  for (const field of BOOLEAN_OPTIONAL_FIELDS) {
    if (typeof record[field] === 'boolean') {
      (student as Record<string, unknown>)[field] = record[field];
    }
  }
  for (const field of NUMBER_OPTIONAL_FIELDS) {
    if (typeof record[field] === 'number') {
      (student as Record<string, unknown>)[field] = record[field];
    }
  }
  if (
    typeof record.gender === 'string' &&
    (ENUM_VALUES.gender as readonly string[]).includes(record.gender)
  ) {
    student.gender = record.gender as SafeStudent['gender'];
  }
  if (
    typeof record.enrollmentStatus === 'string' &&
    (ENUM_VALUES.enrollmentStatus as readonly string[]).includes(record.enrollmentStatus)
  ) {
    student.enrollmentStatus = record.enrollmentStatus as SafeStudent['enrollmentStatus'];
  }
  if (
    typeof record.studentLifecycle === 'string' &&
    (ENUM_VALUES.studentLifecycle as readonly string[]).includes(record.studentLifecycle)
  ) {
    student.studentLifecycle = record.studentLifecycle as SafeStudent['studentLifecycle'];
  }
  return student;
}

function getMatchingSeed(args: UseStudentProfileDataArgs): SafeStudent | null {
  return args.seedStudent?.id === args.studentId ? args.seedStudent : null;
}

/**
 * Siblings share the student's non-empty `siblingGroupId`; candidates are
 * every other student, but only offered to roles that can actually edit the link.
 */
export function deriveSiblingProfileLists(
  student: SafeStudent,
  indexStudents: SafeStudent[],
  canEdit: boolean
): { siblings: SafeStudent[]; candidates: SafeStudent[] } {
  const pool = indexStudents;
  const others = pool.filter((row) => row.id !== student.id);
  const groupId = String(student.siblingGroupId || '').trim();
  const siblings = groupId
    ? others.filter((row) => String(row.siblingGroupId || '').trim() === groupId)
    : [];
  return { siblings, candidates: canEdit ? others : [] };
}

export function useStudentProfileData(args: UseStudentProfileDataArgs): StudentProfileData {
  const queryClient = useQueryClient();
  const matchingSeed = useMemo(() => getMatchingSeed(args), [args.seedStudent, args.studentId]);
  const parentSeed = matchingSeed && 'seedParentLogin' in args ? args.seedParentLogin : undefined;

  // Student Profile is a shared Office/Admin route served by the same app
  // bridge, so both read it from the cache; every other role reads directly.
  const usesCachedPath = args.role === 'office' || args.role === 'admin';
  const identity = useMemo(
    () => ({ uid: auth.currentUser?.uid || 'user', role: args.role || '' }),
    [args.role]
  );
  const cachedEnabled = Boolean(args.studentId && identity.uid && usesCachedPath);

  // TanStack queries for the cached Office/Admin path
  const reportQuery = useQuery(
    studentProfileReportQueryOptions(identity, args.studentId, cachedEnabled)
  );
  const classesQuery = useQuery(officeClassListQueryOptions(identity, cachedEnabled));
  const teachersQuery = useQuery(officeTeacherReferencesQueryOptions(identity, cachedEnabled));
  const studentIndexQuery = useQuery(officeStudentIndexQueryOptions(identity, cachedEnabled));

  // Legacy state for Non-Office roles
  const [legacyLoading, setLegacyLoading] = useState(true);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [legacyNotFound, setLegacyNotFound] = useState(false);
  const [legacyReport, setLegacyReport] = useState<StudentAdminReportResponse | null>(null);
  const [legacyStudent, setLegacyStudent] = useState<SafeStudent | null>(matchingSeed);
  const [legacyClasses, setLegacyClasses] = useState<Class[]>([]);
  const [legacyTeachers, setLegacyTeachers] = useState<{ uid: string; displayName: string }[]>([]);
  const [parentLoginInfo, setParentLoginInfo] = useState<ParentLoginInfo | null | undefined>(
    parentSeed
  );
  const [legacySiblings, setLegacySiblings] = useState<SafeStudent[]>([]);
  const [legacySiblingCandidates, setLegacySiblingCandidates] = useState<SafeStudent[]>([]);
  const requestIdRef = useRef(0);

  const resetForRoute = useCallback(() => {
    setLegacyReport(null);
    setLegacyError(null);
    setLegacyNotFound(false);
    setLegacyStudent(matchingSeed);
    setParentLoginInfo(parentSeed);
    setLegacyClasses([]);
    setLegacyTeachers([]);
    setLegacySiblings([]);
    setLegacySiblingCandidates([]);
    setLegacyLoading(true);
  }, [matchingSeed, parentSeed]);

  const loadProfile = useCallback(
    async (forceDirectoryRefresh = false) => {
      const requestId = ++requestIdRef.current;
      setLegacyLoading(true);
      setLegacyError(null);
      setLegacyNotFound(false);

      try {
        const [nextReport, support] = await Promise.all([
          fetchStudentAdminReport({ studentId: args.studentId }),
          loadStudentProfileSupportData(args.role),
        ]);
        if (requestId !== requestIdRef.current) return;
        const nextStudent = coerceSafeStudent(nextReport.student);
        if (!nextStudent) throw new Error('Invalid student payload');
        setLegacyReport(nextReport);
        setLegacyStudent(nextStudent);
        setLegacyClasses(support.classes);
        setLegacyTeachers(support.teachers);
        setLegacyError(null);
        setLegacyNotFound(false);

        try {
          const directory = await getStudentDirectory({ revalidate: forceDirectoryRefresh });
          if (requestId !== requestIdRef.current) return;
          const indexStudents = directory.students
            .map((row) => coerceSafeStudent(row))
            .filter((row): row is SafeStudent => Boolean(row));
          const nextSiblingLists = deriveSiblingProfileLists(
            nextStudent,
            indexStudents,
            args.role === 'admin' || args.role === 'office'
          );
          setLegacySiblings(nextSiblingLists.siblings);
          setLegacySiblingCandidates(nextSiblingLists.candidates);
        } catch {
          if (requestId !== requestIdRef.current) return;
          setLegacySiblings([]);
          setLegacySiblingCandidates([]);
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setLegacyReport(null);
        setLegacySiblings([]);
        setLegacySiblingCandidates([]);
        if (err instanceof ApiError && err.status === 404) {
          setLegacyNotFound(true);
          setLegacyError(null);
          setLegacyStudent(null);
        } else {
          setLegacyNotFound(false);
          setLegacyError(err instanceof Error ? err.message : 'Failed to load student profile');
        }
      } finally {
        if (requestId === requestIdRef.current) setLegacyLoading(false);
      }
    },
    [args.role, args.studentId]
  );

  useEffect(() => {
    if (cachedEnabled) return;
    resetForRoute();
    void loadProfile(false);
    return () => {
      requestIdRef.current += 1;
    };
  }, [args.studentId, args.role, resetForRoute, loadProfile, cachedEnabled]);

  const reload = useCallback(async () => {
    if (cachedEnabled) {
      await Promise.all([reportQuery.refetch(), studentIndexQuery.refetch()]);
      return;
    }
    await loadProfile(true);
  }, [cachedEnabled, reportQuery, studentIndexQuery, loadProfile]);

  // Derived outputs
  const report = cachedEnabled ? reportQuery.data || null : legacyReport;
  const student = cachedEnabled
    ? report
      ? coerceSafeStudent(report.student)
      : matchingSeed
    : legacyStudent;
  const classes = cachedEnabled ? classesQuery.data || [] : legacyClasses;
  const teachers = cachedEnabled ? teachersQuery.data || [] : legacyTeachers;

  const siblingLists = useMemo(() => {
    if (cachedEnabled) {
      if (!student || !studentIndexQuery.data) {
        return { siblings: [], candidates: [] };
      }
      const indexStudents = studentIndexQuery.data
        .map((row) => coerceSafeStudent(row))
        .filter((row): row is SafeStudent => Boolean(row));
      return deriveSiblingProfileLists(student, indexStudents, true);
    }
    return { siblings: legacySiblings, candidates: legacySiblingCandidates };
  }, [cachedEnabled, student, studentIndexQuery.data, legacySiblings, legacySiblingCandidates]);

  const loading = cachedEnabled ? reportQuery.isPending && !reportQuery.data : legacyLoading;
  const notFound = cachedEnabled
    ? reportQuery.error instanceof ApiError && reportQuery.error.status === 404
    : legacyNotFound;
  const error = cachedEnabled
    ? reportQuery.error
      ? reportQuery.error instanceof ApiError && reportQuery.error.status === 404
        ? null
        : reportQuery.error.message
      : null
    : legacyError;

  return {
    loading,
    error,
    notFound,
    report,
    student,
    classes,
    teachers,
    parentLoginInfo,
    siblings: siblingLists.siblings,
    siblingCandidates: siblingLists.candidates,
    reload,
  };
}
